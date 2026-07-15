import { nanoid } from 'nanoid'
import type {
  UnifiedMessage,
  ContentBlock,
  ToolUseBlock,
  ToolCallExtraContent
} from '../api/types'
import { createProvider } from '../api/provider'
import type { AgentEvent, AgentLoopConfig, ToolCallState } from './types'
import type { ToolContext } from '../tools/tool-types'
import { summarizeToolInputForHistory, sanitizeMessagesForToolReplay } from '../tools/tool-input-sanitizer'
import {
  shouldCompress,
  shouldPreCompress,
  preCompressMessages
} from './compression'
import { createLogger } from '@/lib/logger'
import { ProviderRequestError, isAccountFailoverCandidate, getRetryDelay, delayWithAbort } from './loop/retry-logic'
import { safeParseToolInput } from './loop/block-utils'
import { parseToolInputSnapshot } from './loop/tool-input-parsing'
import { executeToolCalls } from './loop/tool-execution'
import { handleStreamEvent, type StreamContext } from './loop/stream-parsing'
import { agentEvents } from './events/event-bus'

const log = createLogger('AgentLoop')

const MAX_PROVIDER_RETRIES = 3

function readContextUsage(usage?: UnifiedMessage['usage']): number {
  return usage?.contextTokens ?? 0
}

function findRecentContextUsage(messages: UnifiedMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = readContextUsage(messages[i]?.usage)
    if (tokens > 0) return tokens
  }
  return 0
}

/**
 * Core Agentic Loop - an AsyncGenerator that yields AgentEvents.
 *
 * Flow: Send to LLM -> Parse Stream -> If tool calls -> Execute -> Append results -> Loop
 * UI layer consumes events and updates stores accordingly.
 */
export async function* runAgentLoop(
  messages: UnifiedMessage[],
  config: AgentLoopConfig,
  toolCtx: ToolContext
): AsyncGenerator<AgentEvent> {
  yield { type: 'loop_start' }
  agentEvents.dispatch({
    type: 'loop:start',
    taskId: toolCtx.taskId ?? '',
    timestamp: Date.now()
  })

  let conversationMessages = [...messages]
  let iteration = 0
  let fullCompressionApplied = false
  let lastInputTokens = config.contextCompression ? findRecentContextUsage(messages) : 0
  const hasIterationLimit = Number.isFinite(config.maxIterations) && config.maxIterations > 0
  const buildLoopEndEvent = (
    reason: 'completed' | 'max_iterations' | 'aborted' | 'error'
  ): AgentEvent => {
    agentEvents.dispatch({
      type: 'loop:end',
      taskId: toolCtx.taskId ?? '',
      reason,
      iterations: iteration,
      timestamp: Date.now()
    })
    return {
      type: 'loop_end',
      reason,
      ...(fullCompressionApplied ? { messages: [...conversationMessages] } : {})
    }
  }

  try {
    while (!hasIterationLimit || iteration < config.maxIterations) {
      if (config.signal.aborted) {
        yield buildLoopEndEvent('aborted')
        return
      }

      // --- Context management (between iterations) ---
      if (lastInputTokens > 0 && config.contextCompression) {
        const cc = config.contextCompression
        if (shouldCompress(lastInputTokens, cc.config)) {
          if (config.signal.aborted) {
            yield buildLoopEndEvent('aborted')
            return
          }
          yield { type: 'context_compression_start' }
          if (config.signal.aborted) {
            yield buildLoopEndEvent('aborted')
            return
          }
          try {
            const originalCount = conversationMessages.length
            const compressedMessages = await cc.compressFn(conversationMessages)
            conversationMessages = [...compressedMessages]
            fullCompressionApplied = true
            yield {
              type: 'context_compressed',
              originalCount,
              newCount: conversationMessages.length,
              messages: [...conversationMessages]
            }
            agentEvents.dispatch({
              type: 'context:compression',
              taskId: toolCtx.taskId ?? '',
              originalCount,
              newCount: conversationMessages.length,
              timestamp: Date.now()
            })
            lastInputTokens = 0
          } catch (compErr) {
            log.error('Context compression failed:', compErr)
          }
        } else if (shouldPreCompress(lastInputTokens, cc.config)) {
          conversationMessages = [...preCompressMessages(conversationMessages)]
        }
      }
      if (config.signal.aborted) {
        yield buildLoopEndEvent('aborted')
        return
      }

      // Drain message queue
      if (config.messageQueue) {
        const injected = config.messageQueue.drain()
        for (const msg of injected) {
          conversationMessages.push(msg)
        }
      }

      iteration++
      log.debug('iteration start', { iteration, messageCount: conversationMessages.length, lastInputTokens })
      yield { type: 'iteration_start', iteration }
      agentEvents.dispatch({
        type: 'iteration:start',
        taskId: toolCtx.taskId ?? '',
        iteration,
        timestamp: Date.now()
      })

      // 1. Send to LLM and collect streaming events (with retries)
      let assistantContentBlocks: ContentBlock[] = []
      let toolCalls: ToolCallState[] = []
      let sendAttempt = 0
      const accountFailoverUsed = false
      let providerResponseId: string | undefined
      let assistantUsage: UnifiedMessage['usage']

      while (sendAttempt < MAX_PROVIDER_RETRIES) {
        assistantContentBlocks = []
        toolCalls = []
        const toolArgBufferById = new Map<string, string>()
        const toolNamesById = new Map<string, string>()
        const toolExtraContentById = new Map<string, ToolCallExtraContent>()
        let currentToolId = ''
        let currentToolName = ''
        const streamedContent = false

        try {
          const resolvedProviderConfig = config.resolveProvider
            ? await config.resolveProvider(conversationMessages)
            : config.provider
          const provider = createProvider(resolvedProviderConfig)

          // Send all registered tool schemas to the model.
          const activeTools = config.tools

          const stream = provider.sendMessage(
            conversationMessages,
            activeTools,
            resolvedProviderConfig,
            config.signal
          )

          const streamCtx: StreamContext = {
            assistantContentBlocks,
            toolArgBufferById,
            toolNamesById,
            toolExtraContentById,
            currentToolId,
            currentToolName,
            config,
            toolCtx,
            toolCalls,
            streamedContent,
            resolvedProviderConfig: {
              providerId: resolvedProviderConfig.providerId,
              providerBuiltinId: resolvedProviderConfig.providerBuiltinId,
              model: resolvedProviderConfig.model
            }
          }

          for await (const event of stream) {
            if (config.signal.aborted) {
              yield buildLoopEndEvent('aborted')
              return
            }

            switch (event.type) {
              case 'message_end':
                if (event.usage) {
                  assistantUsage = event.usage
                  lastInputTokens = readContextUsage(event.usage)
                  agentEvents.dispatch({
                    type: 'token:usage',
                    taskId: toolCtx.taskId ?? '',
                    inputTokens: event.usage.inputTokens ?? 0,
                    outputTokens: event.usage.outputTokens ?? 0,
                    cacheReadTokens: event.usage.cacheReadTokens ?? 0,
                    cacheWriteTokens: (event.usage.cacheCreationTokens ?? 0) + (event.usage.cacheCreation5mTokens ?? 0) + (event.usage.cacheCreation1hTokens ?? 0),
                    timestamp: Date.now()
                  })
                }
                if (event.providerResponseId) {
                  providerResponseId = event.providerResponseId
                }
                // Emit message_end via stream handler
                yield* handleStreamEvent(event, streamCtx)
                break

              case 'request_debug':
                // Update streamCtx before delegating so resolvedProviderConfig is available
                streamCtx.resolvedProviderConfig = {
                  providerId: resolvedProviderConfig.providerId,
                  providerBuiltinId: resolvedProviderConfig.providerBuiltinId,
                  model: resolvedProviderConfig.model
                }
                yield* handleStreamEvent(event, streamCtx)
                break

              case 'error': {
                const errorType = event.error?.type
                const statusFromType =
                  typeof errorType === 'string'
                    ? Number(/^http_(\d{3})$/i.exec(errorType)?.[1] ?? Number.NaN)
                    : Number.NaN
                throw new ProviderRequestError(event.error?.message ?? 'Unknown API error', {
                  type: errorType,
                  ...(Number.isFinite(statusFromType) ? { statusCode: statusFromType } : {})
                })
              }

              default:
                yield* handleStreamEvent(event, streamCtx)
                break
            }

            // Sync mutable state back from streamCtx
            currentToolId = streamCtx.currentToolId
            currentToolName = streamCtx.currentToolName
          }

          // Defensive: finalize dangling tool calls
          if (toolArgBufferById.size > 0) {
            for (const [danglingToolId, argsText] of toolArgBufferById) {
              const danglingName = toolNamesById.get(danglingToolId) || currentToolName
              const danglingInput =
                parseToolInputSnapshot(argsText, danglingName) ?? safeParseToolInput(argsText)
              const historyDanglingInput = summarizeToolInputForHistory(danglingName, danglingInput)
              const toolUseBlock: ToolUseBlock = {
                type: 'tool_use',
                id: danglingToolId,
                name: danglingName,
                input: historyDanglingInput,
                extraContent: toolExtraContentById.get(danglingToolId)
              }
              assistantContentBlocks.push(toolUseBlock)
              toolCalls.push({
                id: danglingToolId,
                name: danglingName,
                input: danglingInput,
                status: 'running'
              })
              yield {
                type: 'tool_use_generated',
                toolUseBlock: {
                  id: danglingToolId,
                  name: danglingName,
                  input: historyDanglingInput
                }
              }
            }
            toolArgBufferById.clear()
            toolNamesById.clear()
          }

          log.debug('llm response received', {
            iteration,
            sendAttempt,
            contentBlockCount: assistantContentBlocks.length,
            toolCallCount: toolCalls.length,
            usage: assistantUsage
          })
          break
        } catch (err) {
          if (config.signal.aborted) {
            yield buildLoopEndEvent('aborted')
            return
          }
          if (!accountFailoverUsed && isAccountFailoverCandidate(err)) {
            // No fallback available
          }
          const delay = getRetryDelay(err, sendAttempt, streamedContent)
          if (delay === null || sendAttempt === MAX_PROVIDER_RETRIES - 1) {
            yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) }
            yield buildLoopEndEvent('error')
            return
          }
          sendAttempt++
          log.debug('retrying llm request', { sendAttempt, maxRetries: MAX_PROVIDER_RETRIES, iteration })
          try {
            await delayWithAbort(delay, config.signal)
          } catch {
            yield buildLoopEndEvent('aborted')
            return
          }
          continue
        }
      }

      // Push assistant message to conversation
      const assistantMsg: UnifiedMessage = {
        id: nanoid(),
        role: 'assistant',
        content: assistantContentBlocks.length > 0 ? assistantContentBlocks : '',
        createdAt: Date.now(),
        ...(assistantUsage ? { usage: assistantUsage } : {}),
        ...(providerResponseId ? { providerResponseId } : {})
      }
      conversationMessages.push(assistantMsg)
      conversationMessages = sanitizeMessagesForToolReplay(conversationMessages)

      // 2. No tool calls -> done
      if (toolCalls.length === 0) {
        yield buildLoopEndEvent('completed')
        return
      }

      // 3. Execute tool calls
      const { shouldStopForUserReview, toolResults } =
        yield* executeToolCalls(toolCalls, config, toolCtx, buildLoopEndEvent)

      // 4. Append tool results as user message and loop
      const toolResultMsg: UnifiedMessage = {
        id: nanoid(),
        role: 'user',
        content: toolResults.filter((block): block is ContentBlock => Boolean(block)),
        createdAt: Date.now()
      }
      conversationMessages.push(toolResultMsg)

      // Notify UI about tool results
      yield {
        type: 'iteration_end',
        stopReason: 'tool_use',
        toolResults: toolResults
          .filter(
            (block): block is Extract<ContentBlock, { type: 'tool_result' }> =>
              block !== undefined && block.type === 'tool_result'
          )
          .map((block) => ({
            toolUseId: block.toolUseId,
            content: block.content,
            isError: block.isError
          }))
      }
      agentEvents.dispatch({
        type: 'iteration:end',
        taskId: toolCtx.taskId ?? '',
        iteration,
        toolCallCount: toolCalls.length,
        timestamp: Date.now()
      })

      if (shouldStopForUserReview) {
        yield buildLoopEndEvent('completed')
        return
      }
    }

    if (hasIterationLimit) {
      yield buildLoopEndEvent('max_iterations')
    } else {
      yield buildLoopEndEvent('completed')
    }
  } finally {
    try {
      config.captureFinalMessages?.([...conversationMessages])
    } catch (captureErr) {
      log.error('captureFinalMessages hook threw:', captureErr)
    }
  }
}

// Re-export for external consumers
export { ProviderRequestError } from './loop/retry-logic'
