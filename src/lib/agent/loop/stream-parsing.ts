import { nanoid } from 'nanoid'
import type {
  ContentBlock,
  ToolUseBlock,
  ToolCallExtraContent,
  StreamEvent
} from '../../api/types'
import type { AgentEvent, AgentLoopConfig, ToolCallState } from '../types'
import type { ToolContext } from '../../tools/tool-types'
import { summarizeToolInputForHistory } from '../../tools/tool-input-sanitizer'
import { appendThinkingToBlocks, appendThinkingEncryptedToBlocks, appendTextToBlocks, safeParseToolInput } from './block-utils'
import { parseToolInputSnapshot, mergeToolInputs } from './tool-input-parsing'
import { agentEvents } from '../events/event-bus'

export interface StreamContext {
  assistantContentBlocks: ContentBlock[]
  toolArgBufferById: Map<string, string>
  toolNamesById: Map<string, string>
  toolExtraContentById: Map<string, ToolCallExtraContent>
  currentToolId: string
  currentToolName: string
  config: AgentLoopConfig
  toolCtx: ToolContext
  toolCalls: ToolCallState[]
  streamedContent: boolean
  resolvedProviderConfig?: {
    providerId?: string
    providerBuiltinId?: string
    model?: string
  }
}

export async function* handleStreamEvent(
  event: StreamEvent,
  ctx: StreamContext
): AsyncGenerator<AgentEvent> {
  switch (event.type) {
    case 'thinking_delta':
      ctx.streamedContent = true
      yield { type: 'thinking_delta', thinking: event.thinking! }
      appendThinkingToBlocks(ctx.assistantContentBlocks, event.thinking!)
      agentEvents.dispatch({
        type: 'thinking:delta',
        taskId: ctx.toolCtx.taskId ?? '',
        timestamp: Date.now()
      })
      break

    case 'thinking_encrypted':
      if (event.thinkingEncryptedContent && event.thinkingEncryptedProvider) {
        ctx.streamedContent = true
        yield {
          type: 'thinking_encrypted',
          thinkingEncryptedContent: event.thinkingEncryptedContent,
          thinkingEncryptedProvider: event.thinkingEncryptedProvider
        }
        appendThinkingEncryptedToBlocks(
          ctx.assistantContentBlocks,
          event.thinkingEncryptedContent,
          event.thinkingEncryptedProvider
        )
      }
      break

    case 'text_delta':
      ctx.streamedContent = true
      yield { type: 'text_delta', text: event.text! }
      appendTextToBlocks(ctx.assistantContentBlocks, event.text!)
      agentEvents.dispatch({
        type: 'text:delta',
        taskId: ctx.toolCtx.taskId ?? '',
        timestamp: Date.now()
      })
      break

    case 'image_generation_started':
      ctx.streamedContent = true
      yield { type: 'image_generation_started' }
      break

    case 'image_generation_partial':
      ctx.streamedContent = true
      if (event.imageBlock) {
        yield {
          type: 'image_generation_partial',
          imageBlock: event.imageBlock,
          ...(event.partialImageIndex !== undefined
            ? { partialImageIndex: event.partialImageIndex }
            : {})
        }
      }
      break

    case 'image_generated':
      ctx.streamedContent = true
      if (event.imageBlock) {
        ctx.assistantContentBlocks.push(event.imageBlock)
        yield { type: 'image_generated', imageBlock: event.imageBlock }
      }
      break

    case 'image_error':
      ctx.streamedContent = true
      if (event.imageError) {
        ctx.assistantContentBlocks.push({
          type: 'image_error',
          code: event.imageError.code,
          message: event.imageError.message
        })
        yield { type: 'image_error', imageError: event.imageError }
      }
      break

    case 'tool_call_start':
      ctx.streamedContent = true
      ctx.currentToolId = event.toolCallId!
      ctx.currentToolName = event.toolName!
      if (ctx.currentToolId) {
        ctx.toolArgBufferById.set(ctx.currentToolId, '')
        ctx.toolNamesById.set(ctx.currentToolId, ctx.currentToolName)
        if (event.toolCallExtraContent) {
          ctx.toolExtraContentById.set(ctx.currentToolId, event.toolCallExtraContent)
        }
      }
      yield {
        type: 'tool_use_streaming_start',
        toolCallId: ctx.currentToolId,
        toolName: ctx.currentToolName,
        ...(event.toolCallExtraContent
          ? { toolCallExtraContent: event.toolCallExtraContent }
          : {})
      }
      break

    case 'tool_call_delta':
      ctx.streamedContent = true
      {
        const targetToolId = event.toolCallId || ctx.currentToolId
        if (!targetToolId) break
        const delta = event.argumentsDelta ?? ''
        const prev = ctx.toolArgBufferById.get(targetToolId)
        const buffer = prev !== undefined ? prev + delta : delta
        ctx.toolArgBufferById.set(targetToolId, buffer)

        const targetToolName = ctx.toolNamesById.get(targetToolId) || ctx.currentToolName

        const partialInput = parseToolInputSnapshot(buffer, targetToolName)
        if (partialInput && Object.keys(partialInput).length > 0) {
          yield {
            type: 'tool_use_args_delta',
            toolCallId: targetToolId,
            partialInput
          }
        }
      }
      break

    case 'tool_call_end': {
      ctx.streamedContent = true
      const endToolId = event.toolCallId || ctx.currentToolId || nanoid()
      const endToolName = event.toolName || ctx.currentToolName
      const rawToolArgs = ctx.toolArgBufferById.get(endToolId) ?? ''
      const streamedToolInput = parseToolInputSnapshot(rawToolArgs, endToolName)
      const mergedToolInput = mergeToolInputs(streamedToolInput, event.toolCallInput)
      const toolInput =
        Object.keys(mergedToolInput).length > 0
          ? mergedToolInput
          : safeParseToolInput(rawToolArgs)
      const historyToolInput = summarizeToolInputForHistory(endToolName, toolInput)
      const toolUseBlock: ToolUseBlock = {
        type: 'tool_use',
        id: endToolId,
        name: endToolName,
        input: historyToolInput,
        extraContent: event.toolCallExtraContent ?? ctx.toolExtraContentById.get(endToolId)
      }
      ctx.assistantContentBlocks.push(toolUseBlock)
      ctx.toolArgBufferById.delete(endToolId)
      ctx.toolNamesById.delete(endToolId)
      ctx.toolExtraContentById.delete(endToolId)

      const tc: ToolCallState = {
        id: toolUseBlock.id,
        name: endToolName,
        input: toolInput,
        status: 'running',
        ...(toolUseBlock.extraContent ? { extraContent: toolUseBlock.extraContent } : {})
      }
      ctx.toolCalls.push(tc)
      yield {
        type: 'tool_use_generated',
        toolUseBlock: {
          id: toolUseBlock.id,
          name: endToolName,
          input: historyToolInput,
          ...(toolUseBlock.extraContent
            ? { extraContent: toolUseBlock.extraContent }
            : {})
        },
      }
      agentEvents.dispatch({
        type: 'tool:start',
        taskId: ctx.toolCtx.taskId ?? '',
        toolName: endToolName,
        toolCallId: endToolId,
        timestamp: Date.now()
      })
      break
    }

    case 'message_end':
      // Note: usage/providerResponseId tracking is handled by the caller
      if (event.usage || event.timing || event.providerResponseId || event.stopReason) {
        yield {
          type: 'message_end',
          usage: event.usage,
          timing: event.timing,
          providerResponseId: event.providerResponseId,
          stopReason: event.stopReason
        }
      }
      break

    case 'request_debug':
      if (event.debugInfo && ctx.resolvedProviderConfig) {
        yield {
          type: 'request_debug',
          debugInfo: {
            ...event.debugInfo,
            providerId: ctx.resolvedProviderConfig.providerId,
            providerBuiltinId: ctx.resolvedProviderConfig.providerBuiltinId,
            model: ctx.resolvedProviderConfig.model
          }
        }
      }
      break

    case 'error':
      // Errors are thrown by the caller, not handled here
      break
  }
}
