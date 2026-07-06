import type {
  APIProvider,
  ProviderConfig,
  StreamEvent,
  ToolDefinition,
  UnifiedMessage,
  ContentBlock,
  TokenUsage,
  ToolCallExtraContent
} from './types'
import {
  ApiStreamError,
  streamApiRequestViaTauri,
  maskHeaders
} from '@/services/tauri-api/api-stream'
import { useProviderStore, isProviderAuthReady } from '@/stores/provider-store'
import { buildMoonshotCommonHeaders, isMoonshotProviderConfig } from './moonshot-headers'
import { getGlobalPromptCacheKey, registerProvider } from './provider'
import { sanitizeMessagesForToolReplay } from '../tools/tool-input-sanitizer'
import {
  summarizeOpenAITextAndImages,
  supportsOpenAIImageParts
} from '@/protocols/openai-message-support'
import {
  extractOpenAIChatToolCallFragments,
  type OpenAIChatToolCallArgumentsSource
} from '@/protocols/openai-chat-completions'
import { sanitizeSchemaForCompat } from './openai/tool-format'
import { createLogger } from '@/lib/logger'

const log = createLogger('OpenAIChat')

function resolveHeaderTemplate(value: string, config: ProviderConfig): string {
  return value
    .replace(/\{\{\s*taskId\s*\}\}/g, config.taskId ?? '')
    .replace(/\{\{\s*model\s*\}\}/g, config.model ?? '')
}

function applyHeaderOverrides(
  headers: Record<string, string>,
  config: ProviderConfig
): Record<string, string> {
  const overrides = config.requestOverrides?.headers
  if (!overrides) return headers
  for (const [key, rawValue] of Object.entries(overrides)) {
    const value = resolveHeaderTemplate(String(rawValue), config).trim()
    if (value) headers[key] = value
  }
  return headers
}

function applyBodyOverrides(body: Record<string, unknown>, config: ProviderConfig): void {
  const overrides = config.requestOverrides
  if (overrides?.body) {
    for (const [key, value] of Object.entries(overrides.body)) {
      body[key] = value
    }
  }
  if (overrides?.omitBodyKeys) {
    for (const key of overrides.omitBodyKeys) {
      delete body[key]
    }
  }
}

function isRefreshableAuthError(error: unknown): boolean {
  if (error instanceof ApiStreamError) {
    if (error.statusCode === 401 || error.statusCode === 403) return true
    if (/^http_(401|403)$/i.test(error.errorType ?? '')) return true
  }

  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  ) {
    const statusCode = (error as { statusCode: number }).statusCode
    if (statusCode === 401 || statusCode === 403) return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return /\bHTTP\s+(401|403)\b/i.test(message)
}

function resolveModelContextLength(config: ProviderConfig): number | undefined {
  if (!config.providerId) return undefined
  const provider = useProviderStore
    .getState()
    .providers.find((item) => item.id === config.providerId)
  const model = provider?.models.find((item) => item.id === config.model)
  return typeof model?.contextLength === 'number' && model.contextLength > 0
    ? model.contextLength
    : undefined
}

interface TokenUsageData {
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

function buildTokenUsage(data: TokenUsageData, config: ProviderConfig): TokenUsage {
  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0
  const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0
  const contextLength = resolveModelContextLength(config)

  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens > 0
      ? {
          billableInputTokens: Math.max(0, inputTokens - cachedTokens),
          cacheReadTokens: cachedTokens
        }
      : {}),
    contextTokens: inputTokens,
    ...(contextLength ? { contextLength } : {}),
    ...(data.usage?.completion_tokens_details?.reasoning_tokens
      ? { reasoningTokens: data.usage.completion_tokens_details.reasoning_tokens }
      : {})
  }
}

const OPENAI_COMPAT_TERMINAL_GRACE_MS = 1500

function mergeOpenAIChatToolArguments(
  buffer: { args: string },
  argumentsText: string,
  source?: OpenAIChatToolCallArgumentsSource
): string {
  if (source === 'message') {
    const previousArgs = buffer.args
    buffer.args = argumentsText
    return argumentsText.startsWith(previousArgs)
      ? argumentsText.slice(previousArgs.length)
      : argumentsText
  }

  buffer.args += argumentsText
  return argumentsText
}

function buildOpenAIChatImagePart(block: Extract<ContentBlock, { type: 'image' }>): unknown | null {
  const url =
    block.source.type === 'base64'
      ? `data:${block.source.mediaType || 'image/png'};base64,${block.source.data}`
      : block.source.url || ''
  return url ? { type: 'image_url', image_url: { url } } : null
}

function formatOpenAIChatToolResultContent(
  content: Extract<ContentBlock, { type: 'tool_result' }>['content']
): unknown {
  if (!Array.isArray(content)) return content

  const textParts = content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
  const imageBlocks = content.filter(
    (block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image'
  )

  // Chat-compatible tool messages are text-only on many OpenAI-compatible backends.
  if (imageBlocks.length > 0 && !supportsOpenAIImageParts('chat-completions', 'tool')) {
    return summarizeOpenAITextAndImages(textParts, imageBlocks.length)
  }

  return [
    ...textParts.map((text) => ({ type: 'text', text })),
    ...imageBlocks.map((block) => buildOpenAIChatImagePart(block)).filter(Boolean)
  ]
}

class OpenAIChatProvider implements APIProvider {
  readonly name = 'OpenAI Chat Completions'
  readonly type = 'openai-chat' as const

  async *sendMessage(
    messages: UnifiedMessage[],
    tools: ToolDefinition[],
    config: ProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamEvent> {
    log.debug('sendMessage starting', {
      providerId: config.providerId,
      model: config.model,
      baseUrl: config.baseUrl,
      messageCount: messages.length,
      toolCount: tools.length
    })
    let runtimeConfig = config

    const syncRuntimeConfig = (): boolean => {
      if (!config.providerId) {
        runtimeConfig = config
        return true
      }

      const provider = useProviderStore
        .getState()
        .providers.find((item) => item.id === config.providerId)
      if (!isProviderAuthReady(provider)) return false

      const latest = useProviderStore
        .getState()
        .providers.find((item) => item.id === config.providerId)
      if (!latest) return false

      runtimeConfig = {
        ...config,
        apiKey: latest.apiKey || config.apiKey,
        baseUrl: latest.baseUrl || config.baseUrl,
        userAgent: latest.userAgent ?? config.userAgent
      }
      return true
    }

    if (!syncRuntimeConfig()) {
      yield {
        type: 'error',
        error: { type: 'auth_error', message: 'Provider authentication is not ready' }
      }
      return
    }

    const requestStartedAt = Date.now()
    let firstTokenAt: number | null = null
    let outputTokens = 0
    const baseUrl = (runtimeConfig.baseUrl || 'https://api.openai.com/v1')
      .trim()
      .replace(/\/+$/, '')

    const body: Record<string, unknown> = {
      model: runtimeConfig.model,
      messages: this.formatMessages(messages, runtimeConfig.systemPrompt, runtimeConfig),
      stream: true
    }

    // Data-driven: only providers that declare supportsStreamOptions get this field
    if (runtimeConfig.supportsStreamOptions) {
      body.stream_options = { include_usage: true }
    }

    // Data-driven: only send tools when the model supports function calling
    if (tools.length > 0 && runtimeConfig.supportsFunctionCalling !== false) {
      body.tools = this.formatTools(tools, runtimeConfig.supportsStrictSchemas)
      // Data-driven: tool_choice is optional per OpenAI spec (defaults to "auto")
      if (runtimeConfig.supportsToolChoice) {
        body.tool_choice = 'auto'
      }
    }
    if (runtimeConfig.temperature !== undefined) body.temperature = runtimeConfig.temperature
    if (runtimeConfig.serviceTier) body.service_tier = runtimeConfig.serviceTier
    if (runtimeConfig.maxTokens) {
      // OpenAI o-series reasoning models use max_completion_tokens instead of max_tokens
      const isReasoningModel = /^(o[1-9]|o\d+-mini)/.test(runtimeConfig.model)
      if (isReasoningModel) {
        body.max_completion_tokens = runtimeConfig.maxTokens
      } else {
        body.max_tokens = runtimeConfig.maxTokens
      }
    }

    // Merge thinking/reasoning params when enabled; explicit disable params when off
    if (runtimeConfig.thinkingEnabled && runtimeConfig.thinkingConfig) {
      Object.assign(body, runtimeConfig.thinkingConfig.bodyParams)
      if (runtimeConfig.thinkingConfig.reasoningEffortLevels && runtimeConfig.reasoningEffort) {
        body.reasoning_effort = runtimeConfig.reasoningEffort
      }
      if (runtimeConfig.thinkingConfig.forceTemperature !== undefined) {
        body.temperature = runtimeConfig.thinkingConfig.forceTemperature
      }
    } else if (!runtimeConfig.thinkingEnabled && runtimeConfig.thinkingConfig?.disabledBodyParams) {
      Object.assign(body, runtimeConfig.thinkingConfig.disabledBodyParams)
    }

    // Data-driven: only providers that declare supportsPromptCacheKey get this field
    if (runtimeConfig.supportsPromptCacheKey) {
      body.prompt_cache_key = getGlobalPromptCacheKey(runtimeConfig)
    }

    applyBodyOverrides(body, runtimeConfig)

    const url = `${baseUrl}/chat/completions`

    const bodyStr = JSON.stringify(body)

    const buildRequestHeaders = async (): Promise<Record<string, string>> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtimeConfig.apiKey}`
      }
      if (runtimeConfig.userAgent) headers['User-Agent'] = runtimeConfig.userAgent
      if (runtimeConfig.serviceTier) headers.service_tier = runtimeConfig.serviceTier
      if (isMoonshotProviderConfig(runtimeConfig)) {
        const moonshotDeviceId = useProviderStore
          .getState()
          .providers.find((item) => item.id === config.providerId)?.oauth?.deviceId
        Object.assign(headers, await buildMoonshotCommonHeaders(moonshotDeviceId))
      }
      if (runtimeConfig.accountId) headers['Chatgpt-Account-Id'] = runtimeConfig.accountId
      applyHeaderOverrides(headers, runtimeConfig)
      return headers
    }

    const toolBuffers = new Map<
      number,
      {
        id: string
        name: string
        args: string
        started: boolean
        extraContent?: ToolCallExtraContent
      }
    >()
    const streamAbortController = new AbortController()
    let compatTerminalTimer: ReturnType<typeof setTimeout> | null = null
    const clearCompatTerminalTimer = (): void => {
      if (compatTerminalTimer) {
        clearTimeout(compatTerminalTimer)
        compatTerminalTimer = null
      }
    }
    const scheduleCompatTerminalClose = (): void => {
      if (compatTerminalTimer) return
      compatTerminalTimer = setTimeout(() => {
        streamAbortController.abort()
      }, OPENAI_COMPAT_TERMINAL_GRACE_MS)
    }
    const abortRelay = (): void => {
      clearCompatTerminalTimer()
      streamAbortController.abort()
    }
    signal?.addEventListener('abort', abortRelay, { once: true })

    let authRefreshRetryUsed = false

    try {
      while (true) {
        const headers = await buildRequestHeaders()
        yield {
          type: 'request_debug',
          debugInfo: {
            url,
            method: 'POST',
            headers: maskHeaders(headers),
            body: bodyStr,
            timestamp: Date.now()
          }
        }

        try {
          log.debug('Starting stream request', { url, model: runtimeConfig.model })
          streamLoop: for await (const sse of streamApiRequestViaTauri({
            url,
            method: 'POST',
            headers,
            body: bodyStr,
            signal: streamAbortController.signal,
            allowInsecureTls: runtimeConfig.allowInsecureTls ?? true,
            providerId: runtimeConfig.providerId,
            providerBuiltinId: runtimeConfig.providerBuiltinId
          })) {
            clearCompatTerminalTimer()
            if (!sse.data || sse.data === '[DONE]') break
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let data: any
            try {
              data = JSON.parse(sse.data)
            } catch {
              continue
            }
            const choice = data.choices?.[0]

            if (!choice) {
              if (data.usage) {
                outputTokens = data.usage.completion_tokens ?? outputTokens
                const requestCompletedAt = Date.now()
                yield {
                  type: 'message_end',
                  usage: buildTokenUsage(data, runtimeConfig),
                  timing: {
                    totalMs: requestCompletedAt - requestStartedAt,
                    ttftMs: firstTokenAt ? firstTokenAt - requestStartedAt : undefined,
                    tps: computeTps(outputTokens, firstTokenAt, requestCompletedAt)
                  }
                }
              }
              continue
            }

            const delta = choice.delta

            if (delta?.reasoning_content) {
              if (firstTokenAt === null) firstTokenAt = Date.now()
              yield { type: 'thinking_delta', thinking: delta.reasoning_content }
            }

            if (delta?.content) {
              if (firstTokenAt === null) firstTokenAt = Date.now()
              yield { type: 'text_delta', text: delta.content }
            }

            for (const tc of extractOpenAIChatToolCallFragments(choice)) {
              let buf = toolBuffers.get(tc.index)

              if (!buf) {
                buf = {
                  id: '',
                  name: '',
                  args: '',
                  started: false,
                  extraContent: undefined as ToolCallExtraContent | undefined
                }
                toolBuffers.set(tc.index, buf)
              }

              if (tc.id) buf.id = tc.id
              if (tc.name) buf.name = tc.name
              if (!buf.started && buf.id && buf.name) {
                buf.started = true
                yield {
                  type: 'tool_call_start',
                  toolCallId: buf.id,
                  toolName: buf.name
                }
              }

              if (tc.argumentsText !== undefined) {
                const argumentsDelta = mergeOpenAIChatToolArguments(
                  buf,
                  tc.argumentsText,
                  tc.argumentsSource
                )
                if (argumentsDelta) {
                  yield {
                    type: 'tool_call_delta',
                    toolCallId: buf.id || undefined,
                    argumentsDelta
                  }
                }
              }
            }

            const finishReason = choice.finish_reason as string | null | undefined

            if (finishReason === 'tool_calls' || finishReason === 'function_call') {
              for (const [, buf] of toolBuffers) {
                if (!buf.id) continue
                try {
                  yield {
                    type: 'tool_call_end',
                    toolCallId: buf.id,
                    toolName: buf.name,
                    toolCallInput: JSON.parse(buf.args)
                  }
                } catch {
                  yield {
                    type: 'tool_call_end',
                    toolCallId: buf.id,
                    toolName: buf.name,
                    toolCallInput: {},
                    ...(buf.extraContent ? { toolCallExtraContent: buf.extraContent } : {})
                  }
                }
              }
              toolBuffers.clear()
              // Some OpenAI-compatible providers never close SSE after a terminal chunk.
              // Give them a short grace window to send a follow-up usage chunk, then end locally.
              if (data.usage) break streamLoop
                scheduleCompatTerminalClose()
            }

            // Compatibility fallback:
            // Some providers incorrectly return stop/length while still buffering tool args.
            if (
              finishReason &&
              finishReason !== 'tool_calls' &&
              finishReason !== 'function_call' &&
              toolBuffers.size > 0
            ) {
              for (const [, buf] of toolBuffers) {
                if (!buf.id) continue
                try {
                  yield {
                    type: 'tool_call_end',
                    toolCallId: buf.id,
                    toolName: buf.name,
                    toolCallInput: JSON.parse(buf.args)
                  }
                } catch {
                  yield {
                    type: 'tool_call_end',
                    toolCallId: buf.id,
                    toolName: buf.name,
                    toolCallInput: {}
                  }
                }
              }
              toolBuffers.clear()
              if (data.usage) break streamLoop
                scheduleCompatTerminalClose()
            }

            if (finishReason === 'stop') {
              const requestCompletedAt = Date.now()
              if (data.usage) {
                outputTokens = data.usage.completion_tokens ?? outputTokens
              }
              // Some providers include usage in the same chunk as finish_reason:'stop'
              yield {
                type: 'message_end',
                stopReason: 'stop',
                ...(data.usage
                  ? {
                      usage: buildTokenUsage(data, runtimeConfig)
                    }
                  : {}),
                timing: {
                  totalMs: requestCompletedAt - requestStartedAt,
                  ttftMs: firstTokenAt ? firstTokenAt - requestStartedAt : undefined,
                  tps: computeTps(outputTokens, firstTokenAt, requestCompletedAt)
                }
              }
              // OpenAI-compatible providers may keep connection open after stop.
              // Keep a brief window for a trailing usage chunk, then close locally.
              if (data.usage) break streamLoop
                scheduleCompatTerminalClose()
            }

            if (finishReason === 'length' || finishReason === 'content_filter') {
              if (data.usage) break streamLoop
                scheduleCompatTerminalClose()
            }
          }
          break
        } catch (err) {
          if (
            !authRefreshRetryUsed &&
            config.providerId &&
            firstTokenAt === null &&
            isRefreshableAuthError(err)
          ) {
            if (syncRuntimeConfig()) {
              authRefreshRetryUsed = true
              toolBuffers.clear()
              clearCompatTerminalTimer()
              continue
            }
          }

          throw err
        }
      }

      // Flush remaining tool buffers for providers that don't send finish_reason:'tool_calls'
      if (toolBuffers.size > 0) {
        for (const [, buf] of toolBuffers) {
          if (!buf.id) continue
          try {
            yield {
              type: 'tool_call_end',
              toolCallId: buf.id,
              toolName: buf.name,
              toolCallInput: JSON.parse(buf.args),
              ...(buf.extraContent ? { toolCallExtraContent: buf.extraContent } : {})
            }
          } catch {
            yield {
              type: 'tool_call_end',
              toolCallId: buf.id,
              toolName: buf.name,
              toolCallInput: {},
              ...(buf.extraContent ? { toolCallExtraContent: buf.extraContent } : {})
            }
          }
        }
        toolBuffers.clear()
      }
    } finally {
      clearCompatTerminalTimer()
      signal?.removeEventListener('abort', abortRelay)
    }
  }

  formatMessages(
    messages: UnifiedMessage[],
    systemPrompt?: string,
    config?: ProviderConfig
  ): unknown[] {
    const formatted: unknown[] = []
    const normalizedMessages = this.normalizeMessagesForOpenAI(
      sanitizeMessagesForToolReplay(messages)
    )

    if (systemPrompt) {
      formatted.push({ role: 'system', content: systemPrompt })
    }

    for (const m of normalizedMessages) {
      if (m.role === 'system') continue

      if (typeof m.content === 'string') {
        if (m.role === 'assistant' && !m.content.trim()) continue
        formatted.push({ role: m.role, content: m.content })
        continue
      }

      const blocks = m.content as ContentBlock[]

      // Handle user messages with images or text-only ContentBlock[]
      if (m.role === 'user') {
        const hasImages = blocks.some((b) => b.type === 'image')
        const userToolResults = blocks.filter((b) => b.type === 'tool_result')

        // Always emit tool results first (as role: "tool" messages) so they
        // appear directly after the preceding assistant's tool_calls.
        if (userToolResults.length > 0) {
          for (const tr of userToolResults) {
            if (tr.type !== 'tool_result') continue

            formatted.push({
              role: 'tool',
              tool_call_id: tr.toolUseId,
              content: formatOpenAIChatToolResultContent(tr.content)
            })
          }
        }

        // Then emit any text/image content as a user message.
        const nonToolBlocks = blocks.filter((b) => b.type !== 'tool_result')
        if (hasImages && nonToolBlocks.length > 0) {
          const parts: unknown[] = []
          for (const b of nonToolBlocks) {
            if (b.type === 'image') {
              if (supportsOpenAIImageParts('chat-completions', 'user')) {
                const imagePart = buildOpenAIChatImagePart(b)
                if (imagePart) parts.push(imagePart)
              }
            } else if (b.type === 'text') {
              parts.push({ type: 'text', text: b.text })
            }
          }
          if (parts.length > 0) {
            formatted.push({ role: 'user', content: parts })
          }
        } else {
          const userTextBlocks = nonToolBlocks.filter((b) => b.type === 'text')
          if (userTextBlocks.length > 0) {
            const parts = userTextBlocks.map((b) => ({
              type: 'text',
              text: (b as Extract<ContentBlock, { type: 'text' }>).text
            }))
            formatted.push({ role: 'user', content: parts })
          }
        }
        continue
      }

      const toolResults = blocks.filter((b) => b.type === 'tool_result')
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          if (tr.type !== 'tool_result') continue

          formatted.push({
            role: 'tool',
            tool_call_id: tr.toolUseId,
            content: formatOpenAIChatToolResultContent(tr.content)
          })
        }
        continue
      }

      // Handle assistant with tool_use blocks
      const toolUses = blocks.filter((b) => b.type === 'tool_use')
      const textBlocks = blocks.filter((b) => b.type === 'text')
      const thinkingBlocks = blocks.filter((b) => b.type === 'thinking')
      const textContent = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
      const reasoningContent = thinkingBlocks
        .map((b) => (b.type === 'thinking' ? b.thinking : ''))
        .join('')

      const hasAssistantPayload =
        textContent.length > 0 ||
        reasoningContent.length > 0 ||
        toolUses.length > 0
      if (!hasAssistantPayload) continue

      const msg: Record<string, unknown> = {
        role: 'assistant',
        content: textContent.length > 0 ? textContent : null
      }
      if (reasoningContent) msg.reasoning_content = reasoningContent

      if (toolUses.length > 0) {
        msg.tool_calls = toolUses
          .map((tu) => {
            if (tu.type !== 'tool_use') return null
            return {
              id: tu.id,
              type: 'function',
              function: { name: tu.name, arguments: JSON.stringify(tu.input) }
            }
          })
          .filter(Boolean)
      }
      formatted.push(msg)
    }

    return formatted
  }

  private normalizeMessagesForOpenAI(messages: UnifiedMessage[]): UnifiedMessage[] {
    const normalized: UnifiedMessage[] = []
    const validToolUseIds = new Set<string>()

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (message.role === 'system' || typeof message.content === 'string') {
        normalized.push(message)
        continue
      }

      const blocks = message.content as ContentBlock[]
      const replayableToolUseIds = new Set(
        blocks
          .filter(
            (block): block is Extract<ContentBlock, { type: 'tool_use' }> =>
              block.type === 'tool_use'
          )
          .map((block) => block.id)
      )

      const pairedToolUseIds = new Set<string>()
      if (replayableToolUseIds.size > 0) {
        for (let j = index + 1; j < messages.length; j++) {
          const candidateMsg = messages[j]
          if (candidateMsg.role !== 'user' || !Array.isArray(candidateMsg.content)) break
          const candidateBlocks = candidateMsg.content as ContentBlock[]
          if (!candidateBlocks.some((b) => b.type === 'tool_result')) break
          for (const block of candidateBlocks) {
            if (block.type !== 'tool_result' || !replayableToolUseIds.has(block.toolUseId)) continue
            pairedToolUseIds.add(block.toolUseId)
            validToolUseIds.add(block.toolUseId)
          }
        }
      }

      const sanitizedBlocks = blocks.filter((block) => {
        if (block.type === 'tool_use') {
          return pairedToolUseIds.has(block.id)
        }
        if (block.type !== 'tool_result') return true
        return validToolUseIds.has(block.toolUseId)
      })

      if (sanitizedBlocks.length === 0) continue
      normalized.push({ ...message, content: sanitizedBlocks })
    }

    return normalized
  }

  formatTools(tools: ToolDefinition[], supportsStrictSchemas?: boolean): unknown[] {
    return tools.map((t) => {
      if (typeof t.description !== 'string') {
        throw new Error(
          `[OpenAIChat] Tool "${t.name}" has non-string description ` +
          `(type=${typeof t.description}). This must be resolved before reaching formatTools.`
        )
      }
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: this.normalizeToolSchema(t.inputSchema, supportsStrictSchemas)
        }
      }
    })
  }

  /**
   * OpenAI Chat Completions expects a root object schema with `properties`.
   * Our SpawnAgent tool uses `oneOf` at the root, so collapse it into a single
   * object schema for compatibility.
   *
   * @param supportsStrictSchemas - When true, `additionalProperties: false` is
   *   preserved (for `properties` schemas) or added (for `oneOf` schemas).
   *   When false/undefined, `additionalProperties: false` is stripped/omitted
   *   for compatibility with third-party providers that reject strict schemas.
   */
  private normalizeToolSchema(
    schema: ToolDefinition['inputSchema'],
    supportsStrictSchemas?: boolean
  ): Record<string, unknown> {
    if ('properties' in schema) {
      // For simple object schemas: preserve or strip additionalProperties: false
      if (supportsStrictSchemas) {
        return schema as Record<string, unknown>
      }
      return sanitizeSchemaForCompat(schema as Record<string, unknown>)
    }

    const mergedProperties: Record<string, unknown> = {}
    let requiredIntersection: string[] | null = null

    for (const variant of schema.oneOf) {
      for (const [key, value] of Object.entries(variant.properties ?? {})) {
        if (!(key in mergedProperties)) {
          mergedProperties[key] = supportsStrictSchemas
            ? value
            : value && typeof value === 'object' && !Array.isArray(value)
              ? sanitizeSchemaForCompat(value as Record<string, unknown>)
              : value
        }
      }

      const required = variant.required ?? []
      if (requiredIntersection === null) {
        requiredIntersection = [...required]
      } else {
        requiredIntersection = requiredIntersection.filter((key) => required.includes(key))
      }
    }

    const normalized: Record<string, unknown> = {
      type: 'object',
      properties: mergedProperties
    }

    if (supportsStrictSchemas) {
      normalized.additionalProperties = false
    }

    if (requiredIntersection && requiredIntersection.length > 0) {
      normalized.required = requiredIntersection
    }

    return normalized
  }
}

function computeTps(
  outputTokens: number,
  firstTokenAt: number | null,
  completedAt: number
): number | undefined {
  if (!firstTokenAt || outputTokens <= 0) return undefined
  const durationMs = completedAt - firstTokenAt
  if (durationMs <= 0) return undefined
  return outputTokens / (durationMs / 1000)
}

export function registerOpenAIChatProvider(): void {
  registerProvider('openai-chat', () => new OpenAIChatProvider())
}
