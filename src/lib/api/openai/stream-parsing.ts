import type {
  StreamEvent,
  ProviderConfig
} from '../types'
import { streamApiRequestViaTauri } from '@/services/tauri-api/api-stream'
import { extractResponsesImageBlocks, extractResponsesPartialImageBlock, getResponsesImageGenerationErrorMessage } from '../responses-image-generation'
import { buildComputerUseToolEvents } from './computer-use'

function extractReasoningSummaryText(summary: unknown): string {
  if (typeof summary === 'string') return summary
  if (!Array.isArray(summary)) return ''
  return summary
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

function tryBuildThinkingDeltaEvent(
  thinking: unknown,
  emittedThinkingDeltaRef: { value: boolean }
): StreamEvent | null {
  if (typeof thinking !== 'string' || !thinking) return null
  emittedThinkingDeltaRef.value = true
  return { type: 'thinking_delta', thinking }
}

function tryBuildThinkingEncryptedEvent(
  encryptedContent: unknown,
  emittedThinkingEncrypted: Set<string>
): StreamEvent | null {
  if (typeof encryptedContent !== 'string') return null
  const trimmed = encryptedContent.trim()
  if (!trimmed || emittedThinkingEncrypted.has(trimmed)) return null
  emittedThinkingEncrypted.add(trimmed)
  return {
    type: 'thinking_encrypted',
    thinkingEncryptedContent: trimmed,
    thinkingEncryptedProvider: 'openai-responses'
  }
}

function getImageGenerationItemId(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const record = item as { id?: unknown; item_id?: unknown; call_id?: unknown }
  if (typeof record.id === 'string' && record.id.trim()) return record.id
  if (typeof record.item_id === 'string' && record.item_id.trim()) return record.item_id
  if (typeof record.call_id === 'string' && record.call_id.trim()) return record.call_id
  return null
}

function tryBuildImageGenerationStartedEvent(
  item: unknown,
  emittedImageGenerationStartIds: Set<string>,
  firstTokenAtRef: { value: number | null },
  imageGenerationStartedRef: { value: boolean }
): StreamEvent | null {
  const itemId = getImageGenerationItemId(item)
  if (itemId && emittedImageGenerationStartIds.has(itemId)) return null
  if (itemId) emittedImageGenerationStartIds.add(itemId)
  if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
  imageGenerationStartedRef.value = true
  return { type: 'image_generation_started' }
}

async function buildImageGenerationEvents(
  item: unknown,
  emittedImageOutputItemIds: Set<string>,
  firstTokenAtRef: { value: number | null },
  imageGenerationStartedRef: { value: boolean },
  outputFormat: ProviderConfig['responsesImageGeneration'] extends { outputFormat?: infer F } ? F : string | undefined
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  if (!item || typeof item !== 'object' || Array.isArray(item)) return events
  const record = item as { type?: unknown }
  if (record.type !== 'image_generation_call') return events

  const itemId = getImageGenerationItemId(item)
  if (itemId && emittedImageOutputItemIds.has(itemId)) return events

  const imageBlocks = await extractResponsesImageBlocks(
    item,
    outputFormat
  )
  if (imageBlocks.length > 0) {
    if (itemId) emittedImageOutputItemIds.add(itemId)
    if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
    imageGenerationStartedRef.value = false
    for (const imageBlock of imageBlocks) {
      events.push({ type: 'image_generated', imageBlock })
    }
    return events
  }

  const errorMessage = getResponsesImageGenerationErrorMessage(item)
  if (errorMessage) {
    if (itemId) emittedImageOutputItemIds.add(itemId)
    if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
    imageGenerationStartedRef.value = false
    events.push({
      type: 'image_error',
      imageError: {
        code: 'api_error',
        message: errorMessage
      }
    })
  }

  return events
}

function tryBuildTerminalImageErrorEvent(
  payload: unknown,
  imageGenerationStartedRef: { value: boolean }
): StreamEvent | null {
  if (!imageGenerationStartedRef.value) return null
  const message =
    getResponsesImageGenerationErrorMessage(payload) ??
    (typeof payload === 'string' && payload.trim() ? payload.trim() : 'Image generation failed')
  imageGenerationStartedRef.value = false
  return {
    type: 'image_error',
    imageError: {
      code: 'api_error',
      message
    }
  }
}

export interface StreamParseContext {
  url: string
  headers: Record<string, string>
  signal?: AbortSignal
  config: ProviderConfig
  requestStartedAt: number
  model: string
}

export interface StreamParseState {
  firstTokenAt: number | null
  outputTokens: number
  argBuffers: Map<string, string>
  emittedThinkingEncrypted: Set<string>
  emittedComputerCallIds: Set<string>
  emittedImageGenerationStartIds: Set<string>
  emittedImageOutputItemIds: Set<string>
  emittedThinkingDelta: boolean
  imageGenerationStarted: boolean
}

export async function* parseOpenAIResponseStream(
  httpBodyStr: string,
  ctx: StreamParseContext
): AsyncIterable<StreamEvent> {
  const state: StreamParseState = {
    firstTokenAt: null,
    outputTokens: 0,
    argBuffers: new Map(),
    emittedThinkingEncrypted: new Set(),
    emittedComputerCallIds: new Set(),
    emittedImageGenerationStartIds: new Set(),
    emittedImageOutputItemIds: new Set(),
    emittedThinkingDelta: false,
    imageGenerationStarted: false
  }

  const firstTokenAtRef = { value: state.firstTokenAt }
  const imageGenerationStartedRef = { value: state.imageGenerationStarted }
  const outputFormat = ctx.config.responsesImageGeneration?.outputFormat

  function computeTpsLocal(
    outputTokens: number,
    firstTokenAt: number | null,
    completedAt: number
  ): number | undefined {
    if (!firstTokenAt || outputTokens <= 0) return undefined
    const durationMs = completedAt - firstTokenAt
    if (durationMs <= 0) return undefined
    return outputTokens / (durationMs / 1000)
  }

  for await (const sse of streamApiRequestViaTauri({
    url: ctx.url,
    method: 'POST',
    headers: ctx.headers,
    body: httpBodyStr,
    signal: ctx.signal,
    allowInsecureTls: ctx.config.allowInsecureTls ?? true,
    providerId: ctx.config.providerId,
    providerBuiltinId: ctx.config.providerBuiltinId,
    providerType: ctx.config.type,
    model: ctx.model,
    taskId: ctx.config.taskId,
    responsesTaskScope: ctx.config.responsesTaskScope,
    websocketUrl: ctx.config.websocketUrl,
    websocketMode: ctx.config.websocketMode
  })) {
    if (!sse.data || sse.data === '[DONE]') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any
    try {
      data = JSON.parse(sse.data)
    } catch {
      continue
    }

    switch (sse.event) {
      case '__request_debug':
        yield {
          type: 'request_debug',
          debugInfo: data
        }
        break

      case 'response.output_text.delta':
        if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
        yield { type: 'text_delta', text: data.delta }
        break

      case 'response.reasoning_summary_text.delta': {
        if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
        const thinkingEvent = tryBuildThinkingDeltaEvent(data.delta, { value: state.emittedThinkingDelta })
        if (thinkingEvent) {
          yield thinkingEvent
        }
        break
      }

      case 'response.reasoning_summary_text.done': {
        if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
        if (!state.emittedThinkingDelta) {
          const thinkingEvent = tryBuildThinkingDeltaEvent(
            data.text ?? data.delta ?? extractReasoningSummaryText(data.summary),
            { value: state.emittedThinkingDelta }
          )
          if (thinkingEvent) {
            yield thinkingEvent
          }
        }
        break
      }

      case 'response.output_item.added':
        if (data.item?.type === 'function_call') {
          state.argBuffers.set(data.item.id, '')
          yield {
            type: 'tool_call_start',
            toolCallId: data.item.call_id,
            toolName: data.item.name
          }
        } else if (data.item?.type === 'computer_call') {
          for (const event of buildComputerUseToolEvents(data.item, state.emittedComputerCallIds)) {
            yield event
          }
        } else if (data.item?.type === 'reasoning') {
          const thinkingEncryptedEvent = tryBuildThinkingEncryptedEvent(
            data.item.encrypted_content ?? data.item.reasoning?.encrypted_content,
            state.emittedThinkingEncrypted
          )
          if (thinkingEncryptedEvent) {
            yield thinkingEncryptedEvent
          }
        } else if (data.item?.type === 'image_generation_call') {
          const imageEvent = tryBuildImageGenerationStartedEvent(
            data.item,
            state.emittedImageGenerationStartIds,
            firstTokenAtRef,
            imageGenerationStartedRef
          )
          if (imageEvent) {
            yield imageEvent
          }
        }
        break

      case 'response.output_item.done': {
        if (data.item?.type === 'computer_call') {
          for (const event of buildComputerUseToolEvents(data.item, state.emittedComputerCallIds)) {
            yield event
          }
        }

        if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
        if (!state.emittedThinkingDelta) {
          const thinkingEvent = tryBuildThinkingDeltaEvent(
            extractReasoningSummaryText(data.item?.summary ?? data.item?.reasoning?.summary),
            { value: state.emittedThinkingDelta }
          )
          if (thinkingEvent) {
            yield thinkingEvent
          }
        }

        const thinkingEncryptedEvent = tryBuildThinkingEncryptedEvent(
          data.item?.encrypted_content ?? data.item?.reasoning?.encrypted_content,
          state.emittedThinkingEncrypted
        )
        if (thinkingEncryptedEvent) {
          yield thinkingEncryptedEvent
        }
        for (const imageEvent of await buildImageGenerationEvents(
          data.item,
          state.emittedImageOutputItemIds,
          firstTokenAtRef,
          imageGenerationStartedRef,
          outputFormat
        )) {
          yield imageEvent
        }
        break
      }

      case 'response.image_generation_call.partial_image': {
        const startEvent = tryBuildImageGenerationStartedEvent(
          data,
          state.emittedImageGenerationStartIds,
          firstTokenAtRef,
          imageGenerationStartedRef
        )
        if (startEvent) {
          yield startEvent
        }
        const imageBlock = await extractResponsesPartialImageBlock(
          data,
          ctx.config.responsesImageGeneration?.outputFormat
        )
        if (imageBlock) {
          if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
          yield {
            type: 'image_generation_partial',
            imageBlock,
            ...(typeof data.partial_image_index === 'number'
              ? { partialImageIndex: data.partial_image_index }
              : {})
          }
        }
        break
      }

      case 'response.function_call_arguments.delta': {
        yield { type: 'tool_call_delta', toolCallId: data.call_id, argumentsDelta: data.delta }
        const key = data.item_id
        state.argBuffers.set(key, (state.argBuffers.get(key) ?? '') + data.delta)
        break
      }

      case 'response.function_call_arguments.done':
        state.argBuffers.delete(data.item_id)
        try {
          yield {
            type: 'tool_call_end',
            toolCallId: data.call_id,
            toolName: data.name,
            toolCallInput: JSON.parse(data.arguments)
          }
        } catch {
          yield {
            type: 'tool_call_end',
            toolCallId: data.call_id,
            toolName: data.name,
            toolCallInput: {}
          }
        }
        break

      case 'response.completed': {
        const requestCompletedAt = Date.now()
        const responseOutput = data.response?.output
        if (Array.isArray(responseOutput)) {
          for (const item of responseOutput) {
            if (item?.type === 'computer_call') {
              for (const event of buildComputerUseToolEvents(item, state.emittedComputerCallIds)) {
                yield event
              }
            }

            if (!state.emittedThinkingDelta) {
              const thinkingEvent = tryBuildThinkingDeltaEvent(
                extractReasoningSummaryText(item?.summary ?? item?.reasoning?.summary),
                { value: state.emittedThinkingDelta }
              )
              if (thinkingEvent) {
                if (firstTokenAtRef.value === null) firstTokenAtRef.value = Date.now()
                yield thinkingEvent
              }
            }

            const thinkingEncryptedEvent = tryBuildThinkingEncryptedEvent(
              item?.encrypted_content ?? item?.reasoning?.encrypted_content,
              state.emittedThinkingEncrypted
            )
            if (thinkingEncryptedEvent) {
              yield thinkingEncryptedEvent
            }
            for (const imageEvent of await buildImageGenerationEvents(
              item,
              state.emittedImageOutputItemIds,
              firstTokenAtRef,
              imageGenerationStartedRef,
              outputFormat
            )) {
              yield imageEvent
            }
          }
        }
        if (data.response?.usage?.output_tokens !== undefined) {
          state.outputTokens = data.response.usage.output_tokens ?? state.outputTokens
        }
        const cachedTokens = data.response?.usage?.input_tokens_details?.cached_tokens ?? 0
        const rawInputTokens = data.response?.usage?.input_tokens ?? 0
        const billableInputTokens = Math.max(0, rawInputTokens - cachedTokens)
        yield {
          type: 'message_end',
          stopReason: data.response.status,
          providerResponseId: data.response?.id,
          usage: data.response.usage
            ? {
                inputTokens: rawInputTokens,
                outputTokens: data.response.usage.output_tokens ?? 0,
                billableInputTokens,
                contextTokens: rawInputTokens,
                ...(cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {}),
                ...(data.response.usage.output_tokens_details?.reasoning_tokens
                  ? {
                      reasoningTokens:
                        data.response.usage.output_tokens_details.reasoning_tokens
                    }
                  : {})
              }
            : undefined,
          timing: {
            totalMs: requestCompletedAt - ctx.requestStartedAt,
            ttftMs: firstTokenAtRef.value ? firstTokenAtRef.value - ctx.requestStartedAt : undefined,
            tps: computeTpsLocal(state.outputTokens, firstTokenAtRef.value, requestCompletedAt)
          }
        }
        break
      }

      case 'response.failed':
        {
          const imageErrorEvent = tryBuildTerminalImageErrorEvent(data, imageGenerationStartedRef)
          if (imageErrorEvent) {
            yield imageErrorEvent
          }
        }
        yield { type: 'error', error: { type: 'api_error', message: JSON.stringify(data) } }
        break

      case 'error':
        {
          const imageErrorEvent = tryBuildTerminalImageErrorEvent(data, imageGenerationStartedRef)
          if (imageErrorEvent) {
            yield imageErrorEvent
          }
        }
        yield { type: 'error', error: { type: 'api_error', message: JSON.stringify(data) } }
        break
    }
  }
}
