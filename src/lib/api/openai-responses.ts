import type {
  APIProvider,
  ProviderConfig,
  StreamEvent,
  ToolDefinition,
  UnifiedMessage,
} from './types'

import { useProviderStore, isProviderAuthReady } from '@/stores/provider-store'
import { loadPrompt } from '../prompt-loader/prompt-loader'
import { getGlobalPromptCacheKey, registerProvider } from './provider'
import { createLogger } from '@/lib/logger'
import { formatMessages as formatOpenAIMessages } from './openai/message-format'
import { buildToolsPayload } from './openai/tool-format'
import { parseOpenAIResponseStream, type StreamParseContext } from './openai/stream-parsing'

const log = createLogger('OpenAI')

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

class OpenAIResponsesProvider implements APIProvider {
  readonly name = 'OpenAI Responses'
  readonly type = 'openai-responses' as const

  formatMessages(
    messages: UnifiedMessage[],
    systemPrompt?: string,
    thinkingEnabled?: boolean
  ): unknown {
    return formatOpenAIMessages(messages, systemPrompt, !!thinkingEnabled)
  }

  formatTools(tools: ToolDefinition[], config?: ProviderConfig): unknown {
    return buildToolsPayload(tools, config ?? ({} as ProviderConfig))
  }

  async *sendMessage(
    messages: UnifiedMessage[],
    tools: ToolDefinition[],
    config: ProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamEvent> {
    let runtimeConfig = config
    if (config.providerId) {
      const provider = useProviderStore
        .getState()
        .providers.find((item) => item.id === config.providerId)
      if (!provider || !isProviderAuthReady(provider)) {
        yield {
          type: 'error',
          error: { type: 'auth_error', message: 'Provider authentication is not ready' }
        }
        return
      }
      const latest = useProviderStore
        .getState()
        .providers.find((item) => item.id === config.providerId)
      if (latest) {
        runtimeConfig = {
          ...config,
          apiKey: latest.apiKey || config.apiKey,
          baseUrl: latest.baseUrl || config.baseUrl,
          userAgent: latest.userAgent ?? config.userAgent
        }
      }
    }

    const requestStartedAt = Date.now()
    const baseUrl = (runtimeConfig.baseUrl || 'https://api.openai.com/v1')
      .trim()
      .replace(/\/+$/, '')
    const fullInput = formatOpenAIMessages(
      messages,
      runtimeConfig.systemPrompt,
      !!runtimeConfig.thinkingEnabled
    )

    const body: Record<string, unknown> = {
      model: runtimeConfig.model,
      input: fullInput,
      stream: true
    }

    const formattedTools = buildToolsPayload(tools, runtimeConfig)
    if (formattedTools.length > 0) {
      body.tools = formattedTools
    }
    if (runtimeConfig.temperature !== undefined) body.temperature = runtimeConfig.temperature
    if (runtimeConfig.serviceTier) body.service_tier = runtimeConfig.serviceTier
    if (runtimeConfig.maxTokens) body.max_output_tokens = runtimeConfig.maxTokens

    if (runtimeConfig.thinkingEnabled && runtimeConfig.thinkingConfig) {
      Object.assign(body, runtimeConfig.thinkingConfig.bodyParams)

      const reasoning =
        typeof body.reasoning === 'object' && body.reasoning !== null
          ? { ...(body.reasoning as Record<string, unknown>) }
          : {}

      if (runtimeConfig.thinkingConfig.reasoningEffortLevels && runtimeConfig.reasoningEffort) {
        reasoning.effort = runtimeConfig.reasoningEffort
      }

      if (body.model !== 'gpt-5.3-codex-spark') {
        reasoning.summary = runtimeConfig.responseSummary ?? 'auto'
      }
      if (Object.keys(reasoning).length > 0) {
        body.reasoning = reasoning
      }

      const include = Array.isArray(body.include)
        ? (body.include as unknown[]).filter((item): item is string => typeof item === 'string')
        : []
      if (!include.includes('reasoning.encrypted_content')) {
        include.push('reasoning.encrypted_content')
      }
      body.include = include

      if (runtimeConfig.thinkingConfig.forceTemperature !== undefined) {
        body.temperature = runtimeConfig.thinkingConfig.forceTemperature
      }
    } else if (!runtimeConfig.thinkingEnabled && runtimeConfig.thinkingConfig?.disabledBodyParams) {
      Object.assign(body, runtimeConfig.thinkingConfig.disabledBodyParams)
    }

    const overridesBody = runtimeConfig.requestOverrides?.body
    const hasInstructionsOverride =
      !!overridesBody && Object.prototype.hasOwnProperty.call(overridesBody, 'instructions')

    if (!hasInstructionsOverride && runtimeConfig.instructionsPrompt) {
      const instructions = await loadPrompt(runtimeConfig.instructionsPrompt)
      if (instructions === null) {
        yield {
          type: 'error',
          error: {
            type: 'config_error',
            message: `Instructions prompt "${runtimeConfig.instructionsPrompt}" not found`
          }
        }
        return
      }
      body.instructions = instructions
    }

    // Data-driven: only providers that declare supportsPromptCacheKey get this field
    if (runtimeConfig.supportsPromptCacheKey) {
      body.prompt_cache_key = getGlobalPromptCacheKey(runtimeConfig)
    }

    applyBodyOverrides(body, runtimeConfig)
    delete body.previous_response_id
    delete body.previousResponseId

    const url = `${baseUrl}/responses`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtimeConfig.apiKey}`
    }
    if (runtimeConfig.userAgent) headers['User-Agent'] = runtimeConfig.userAgent
    if (runtimeConfig.serviceTier) headers.service_tier = runtimeConfig.serviceTier
    applyHeaderOverrides(headers, runtimeConfig)

    const httpBodyStr = JSON.stringify(body)

    log.debug('model selected', { model: runtimeConfig.model })

    const streamCtx: StreamParseContext = {
      url,
      headers,
      signal,
      config: runtimeConfig,
      requestStartedAt,
      model: runtimeConfig.model
    }

    for await (const event of parseOpenAIResponseStream(httpBodyStr, streamCtx)) {
      yield event
    }
  }
}

export function registerOpenAIResponsesProvider(): void {
  registerProvider('openai-responses', () => new OpenAIResponsesProvider())
}
