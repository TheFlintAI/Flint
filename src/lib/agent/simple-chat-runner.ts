import { createProvider } from '@/lib/api/provider'
import { useChatStore } from '@/stores/chat-store'
import { useInboxStore } from '@/stores/inbox-store'
import type { ProviderConfig, RequestDebugInfo, UnifiedMessage, ContentBlock } from '@/lib/api/types'
import { ApiStreamError } from '@/services/tauri-api/api-stream'
import i18n from '@/locales'
import { createStreamDeltaBuffer } from '@/lib/chat/stream-delta-buffer'
import { findProviderModel } from '@/lib/chat/provider-utils'
import {
  appendRuntimeContentBlock,
  appendRuntimeTextDelta,
  completeRuntimeThinking,
  isTaskForeground,
  mergeRuntimeMessageUsage,
  setRuntimeThinkingEncryptedContent,
  updateRuntimeMessage
} from '@/lib/agent/task-runtime-router'
import { setLastDebugInfo, setRequestTraceInfo } from '@/lib/debug-store'
import {
  buildStreamingContextUsage,
  estimateContextTokensForRequest,
  estimateContextTokensFromDebugInfo,
  normalizeUsageWithEstimatedContext,
  requestPreciseResponsesContextTokens,
  shouldRequestPreciseResponsesContextTokens,
  shouldUseEstimatedContextTokens
} from '@/lib/agent/context-estimation'
import { resolveCompressionContextLength } from '@/lib/agent/compression'
import {
  shouldSuppressTransientRuntimeError
} from '@/lib/chat/message-utils'
import { notifyTaskError } from '@/services/notifications'

import { toast } from 'sonner'
import { createLogger } from '@/lib/logger'

const log = createLogger('SimpleChatRunner')

// ── Functions imported from main file scope ──
let _setGeneratingImageWithSync: ((messageId: string, generating: boolean) => void) | null = null
let _setGeneratingImagePreviewWithSync: ((messageId: string, preview: ContentBlock | null) => void) | null = null
let _ensureRequestContainsExpectedUserMessage: ((messages: UnifiedMessage[], expected?: UnifiedMessage | null) => UnifiedMessage[]) | null = null
let _clearRequestRetryState: ((taskId: string) => void) | null = null
let _setStreamingNull: ((taskId: string) => void) | null = null

export function registerSimpleChatDeps(deps: {
  setGeneratingImageWithSync: (messageId: string, generating: boolean) => void
  setGeneratingImagePreviewWithSync: (messageId: string, preview: ContentBlock | null) => void
  ensureRequestContainsExpectedUserMessage: (messages: UnifiedMessage[], expected?: UnifiedMessage | null) => UnifiedMessage[]
  clearRequestRetryState: (taskId: string) => void
  setStreamingNull: (taskId: string) => void
}): void {
  _setGeneratingImageWithSync = deps.setGeneratingImageWithSync
  _setGeneratingImagePreviewWithSync = deps.setGeneratingImagePreviewWithSync
  _ensureRequestContainsExpectedUserMessage = deps.ensureRequestContainsExpectedUserMessage
  _clearRequestRetryState = deps.clearRequestRetryState
  _setStreamingNull = deps.setStreamingNull
}

/**
 * Chat fallback path: single API call with streaming text and no tool loop.
 */
export async function runSimpleChat(
  taskId: string,
  assistantMsgId: string,
  config: ProviderConfig,
  signal: AbortSignal,
  options?: {
    includeTrailingAssistantPlaceholder?: boolean
    expectedUserMessage?: UnifiedMessage | null
  }
): Promise<void> {
  const chatStore = useChatStore.getState()
  const chatModelConfig = findProviderModel(config.providerId, config.model).modelConfig
  const requestContextMaxMessages = chatModelConfig?.contextLength ? null : undefined
  const requestMessages = _ensureRequestContainsExpectedUserMessage!(
    await chatStore.getTaskMessagesForRequest(taskId, {
      includeTrailingAssistantPlaceholder: options?.includeTrailingAssistantPlaceholder ?? false,
      requestContextMaxMessages
    }),
    options?.expectedUserMessage
  )
  const streamDeltaBuffer = createStreamDeltaBuffer(taskId, assistantMsgId)

  setRequestTraceInfo(assistantMsgId, {
    executionPath: 'frontend'
  })

  try {
    const provider = createProvider(config)
    const stream = provider.sendMessage(requestMessages, [], config, signal)

    let thinkingDone = false
    let hasThinkingDelta = false
    let lastRequestDebugInfo: RequestDebugInfo | undefined
    let preciseContextTokens: number | null = null
    let preciseContextTokenRequestSeq = 0
    for await (const event of stream) {
      if (signal.aborted) break

      if (event.type !== 'request_debug') {
        _clearRequestRetryState?.(taskId)
      }

      switch (event.type) {
        case 'thinking_delta':
          hasThinkingDelta = true
          streamDeltaBuffer.pushThinking(event.thinking!)
          break
        case 'thinking_encrypted':
          if (event.thinkingEncryptedContent && event.thinkingEncryptedProvider) {
            setRuntimeThinkingEncryptedContent(
              taskId,
              assistantMsgId,
              event.thinkingEncryptedContent,
              event.thinkingEncryptedProvider
            )
          }
          break
        case 'text_delta':
          if (!thinkingDone) {
            const chunk = event.text ?? ''
            const closeThinkTagMatch = hasThinkingDelta ? chunk.match(/<\s*\/\s*think\s*>/i) : null
            if (closeThinkTagMatch && closeThinkTagMatch.index !== undefined) {
              const beforeClose = chunk.slice(0, closeThinkTagMatch.index)
              const afterClose = chunk.slice(
                closeThinkTagMatch.index + closeThinkTagMatch[0].length
              )
              if (beforeClose) {
                streamDeltaBuffer.pushThinking(beforeClose)
              }
              streamDeltaBuffer.flushNow()
              thinkingDone = true
              completeRuntimeThinking(taskId, assistantMsgId)
              if (afterClose) {
                streamDeltaBuffer.pushText(afterClose)
              }
              break
            }
            thinkingDone = true
            streamDeltaBuffer.flushNow()
            completeRuntimeThinking(taskId, assistantMsgId)
          }
          streamDeltaBuffer.pushText(event.text!)
          break
        case 'image_generation_started':
          _setGeneratingImageWithSync?.(assistantMsgId, true)
          break
        case 'image_generation_partial':
          if (event.imageBlock) {
            _setGeneratingImageWithSync?.(assistantMsgId, true)
            _setGeneratingImagePreviewWithSync?.(assistantMsgId, event.imageBlock)
          }
          break
        case 'image_generated':
          streamDeltaBuffer.flushNow()
          if (!thinkingDone) {
            thinkingDone = true
            completeRuntimeThinking(taskId, assistantMsgId)
          }
          if (event.imageBlock) {
            appendRuntimeContentBlock(taskId, assistantMsgId, event.imageBlock)
          }
          _setGeneratingImagePreviewWithSync?.(assistantMsgId, null)
          _setGeneratingImageWithSync?.(assistantMsgId, false)
          break
        case 'image_error':
          streamDeltaBuffer.flushNow()
          if (!thinkingDone) {
            thinkingDone = true
            completeRuntimeThinking(taskId, assistantMsgId)
          }
          if (event.imageError) {
            appendRuntimeContentBlock(taskId, assistantMsgId, {
              type: 'image_error',
              code: event.imageError.code,
              message: event.imageError.message
            })
          }
          _setGeneratingImagePreviewWithSync?.(assistantMsgId, null)
          _setGeneratingImageWithSync?.(assistantMsgId, false)
          break
        case 'message_end': {
          streamDeltaBuffer.flushNow()
          if (!thinkingDone) {
            thinkingDone = true
            completeRuntimeThinking(taskId, assistantMsgId)
          }
          _setGeneratingImageWithSync?.(assistantMsgId, false)
          if (event.usage) {
            const debugContextEstimate = shouldUseEstimatedContextTokens(lastRequestDebugInfo)
              ? estimateContextTokensFromDebugInfo(lastRequestDebugInfo)
              : null
            const contextTokensOverride =
              preciseContextTokens && preciseContextTokens > 0
                ? preciseContextTokens
                : debugContextEstimate
                  ? debugContextEstimate.tokenCount ||
                    estimateContextTokensForRequest({
                      messages: requestMessages,
                      tools: [],
                      providerConfig: config
                    })
                  : 0
            const normalizedUsage = normalizeUsageWithEstimatedContext({
              usage: event.usage,
              contextLength: chatModelConfig?.contextLength
                ? resolveCompressionContextLength(chatModelConfig)
                : undefined,
              debugInfo: lastRequestDebugInfo,
              estimatedContextTokens: contextTokensOverride,
              preferEstimatedContextTokens: debugContextEstimate?.hadBase64Payload ?? false
            })
            const messageUsage = event.timing
              ? {
                  ...normalizedUsage,
                  totalDurationMs: event.timing.totalMs,
                  requestTimings: [event.timing]
                }
              : normalizedUsage
            updateRuntimeMessage(taskId, assistantMsgId, {
              usage: messageUsage,
              ...(event.providerResponseId ? { providerResponseId: event.providerResponseId } : {})
            })
          }
          break
        }
        case 'request_debug': {
          streamDeltaBuffer.flushNow()
          if (event.debugInfo) {
            lastRequestDebugInfo = {
              ...event.debugInfo,
              providerId: config.providerId,
              providerBuiltinId: config.providerBuiltinId,
              model: config.model
            }
            setLastDebugInfo(assistantMsgId, {
              ...lastRequestDebugInfo
            })
            updateRuntimeMessage(taskId, assistantMsgId, {
              debugInfo: lastRequestDebugInfo
            })
            if (shouldUseEstimatedContextTokens(lastRequestDebugInfo)) {
              const debugContextEstimate = estimateContextTokensFromDebugInfo(lastRequestDebugInfo)
              const provisionalUsage = buildStreamingContextUsage(
                debugContextEstimate.tokenCount ||
                  estimateContextTokensForRequest({
                    messages: requestMessages,
                    tools: [],
                    providerConfig: config
                  }),
                chatModelConfig?.contextLength
                  ? resolveCompressionContextLength(chatModelConfig)
                  : undefined
              )
              if (provisionalUsage) {
                updateRuntimeMessage(taskId, assistantMsgId, { usage: provisionalUsage })
              }
            }

            if (
              shouldRequestPreciseResponsesContextTokens({
                debugInfo: lastRequestDebugInfo,
                providerConfig: config
              })
            ) {
              const requestSeq = ++preciseContextTokenRequestSeq
              void requestPreciseResponsesContextTokens({
                debugInfo: lastRequestDebugInfo,
                providerConfig: config
              })
                .then((exactContextTokens) => {
                  if (requestSeq !== preciseContextTokenRequestSeq || exactContextTokens <= 0) {
                    return
                  }
                  preciseContextTokens = exactContextTokens
                  mergeRuntimeMessageUsage(taskId, assistantMsgId, {
                    contextTokens: exactContextTokens,
                    ...(chatModelConfig?.contextLength
                      ? { contextLength: resolveCompressionContextLength(chatModelConfig) }
                      : {})
                  })
                })
                .catch((error) => {
                  log.warn(
                    '[SimpleChatRunner] Failed to fetch precise Responses context tokens',
                    error
                  )
                })
            }
          }
          break
        }
        case 'error': {
          streamDeltaBuffer.flushNow()
          const errorMessage = event.error?.message ?? i18n.t('chat:errors.unknownError')
          log.error('Chat error', event.error)
          if (shouldSuppressTransientRuntimeError(errorMessage)) {
            break
          }
          toast.error(i18n.t('chat:errors.chatError'), { description: errorMessage })
          if (!isTaskForeground(taskId)) {
            const taskTitle =
              useChatStore.getState().tasks.find((item) => item.id === taskId)?.title ??
              i18n.t('chat:errors.backgroundTask')
            useInboxStore.getState().addInboxItem({
              taskId,
              type: 'error',
              title: i18n.t('chat:errors.runtimeError'),
              description: `${taskTitle} · ${errorMessage}`
            })
          }
          // Notify regardless of task foreground — notify() gates on app focus internally
          {
            const taskTitle =
              useChatStore.getState().tasks.find((item) => item.id === taskId)?.title ??
              i18n.t('chat:errors.backgroundTask')
            notifyTaskError(
              taskId,
              i18n.t('chat:notifications.taskErrorTitle'),
              i18n.t('chat:notifications.taskErrorBody', { title: taskTitle }),
            )
          }
          break
        }
      }
    }
  } catch (err) {
    streamDeltaBuffer.flushNow()
    if (!signal.aborted) {
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error('Chat exception', err)
      if (!shouldSuppressTransientRuntimeError(errMsg)) {
        toast.error('Chat failed', { description: errMsg })
        if (!isTaskForeground(taskId)) {
          const taskTitle =
            useChatStore.getState().tasks.find((item) => item.id === taskId)?.title ??
            'Background task'
          useInboxStore.getState().addInboxItem({
            taskId,
            type: 'error',
            title: 'Runtime error',
            description: `${taskTitle} · ${errMsg}`
          })
        }
        // Notify regardless of task foreground — notify() gates on app focus internally
        {
          const taskTitle =
            useChatStore.getState().tasks.find((item) => item.id === taskId)?.title ??
            'Background task'
          notifyTaskError(
            taskId,
            i18n.t('chat:notifications.taskErrorTitle'),
            i18n.t('chat:notifications.taskErrorBody', { title: taskTitle }),
          )
        }
        appendRuntimeTextDelta(taskId, assistantMsgId, `\n\n> **Error:** ${errMsg}`)
      }
      if (err instanceof ApiStreamError) {
        const debugInfo = {
          ...(err.debugInfo as RequestDebugInfo),
          providerId: config.providerId,
          providerBuiltinId: config.providerBuiltinId,
          model: config.model
        }
        setLastDebugInfo(assistantMsgId, debugInfo)
        updateRuntimeMessage(taskId, assistantMsgId, { debugInfo })
      }
    }
  } finally {
    streamDeltaBuffer.flushNow()
    streamDeltaBuffer.dispose()
    _setGeneratingImageWithSync?.(assistantMsgId, false)
    _setStreamingNull?.(taskId)
  }
}
