import type { LiveLineCountCache } from '@/lib/tools/tool-input-sanitizer'
import {
  appendRuntimeTextDelta,
  appendRuntimeThinkingDelta,
  updateRuntimeToolUseInput
} from '@/lib/agent/task-runtime-router'

// Constants

/** Keep foreground response streaming visibly real-time while still batching tiny chunks. */
export const STREAM_DELTA_FLUSH_MS = 16
export const BACKGROUND_STREAM_DELTA_FLUSH_MS = 200
export const TOOL_INPUT_FLUSH_MS = 300
export const AGENT_TOOL_INPUT_FLUSH_MS = 60
export const BACKGROUND_TOOL_INPUT_FLUSH_MS = 600

// Interfaces

export interface StreamDeltaBuffer {
  pushThinking: (chunk: string) => void
  pushText: (chunk: string) => void
  setToolInput: (toolUseId: string, input: Record<string, unknown>) => void
  flushNow: () => void
  dispose: () => void
}

export interface LiveToolInputThrottleEntry {
  lastChatFlush: number
  lastAgentFlush: number
  pendingRaw?: Record<string, unknown>
  pendingSummary?: Record<string, unknown>
  pendingSignature?: string
  chatTimer?: ReturnType<typeof setTimeout>
  agentTimer?: ReturnType<typeof setTimeout>
  lastChatSent?: string
  lastAgentSent?: string
  lineCountCache: LiveLineCountCache
}

// Factory

export function createStreamDeltaBuffer(
  taskId: string,
  assistantMsgId: string,
  flushIntervalMs = STREAM_DELTA_FLUSH_MS,
  toolInputFlushIntervalMs = TOOL_INPUT_FLUSH_MS
): StreamDeltaBuffer {
  let thinkingBuffer = ''
  let textBuffer = ''
  const toolInputBuffer = new Map<string, Record<string, unknown>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let toolInputTimer: ReturnType<typeof setTimeout> | null = null

  const flushToolInputs = (): void => {
    if (toolInputTimer) {
      clearTimeout(toolInputTimer)
      toolInputTimer = null
    }
    if (toolInputBuffer.size === 0) return
    for (const [toolUseId, input] of toolInputBuffer) {
      updateRuntimeToolUseInput(taskId, assistantMsgId, toolUseId, input)
    }
    toolInputBuffer.clear()
  }

  const flushNow = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    if (!thinkingBuffer && !textBuffer && toolInputBuffer.size === 0) return

    if (thinkingBuffer) {
      appendRuntimeThinkingDelta(taskId, assistantMsgId, thinkingBuffer)
      thinkingBuffer = ''
    }

    if (textBuffer) {
      appendRuntimeTextDelta(taskId, assistantMsgId, textBuffer)
      textBuffer = ''
    }

    flushToolInputs()
  }

  const scheduleFlush = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      // Only flush text/thinking here; tool inputs follow their own cadence.
      if (thinkingBuffer) {
        appendRuntimeThinkingDelta(taskId, assistantMsgId, thinkingBuffer)
        thinkingBuffer = ''
      }
      if (textBuffer) {
        appendRuntimeTextDelta(taskId, assistantMsgId, textBuffer)
        textBuffer = ''
      }
    }, flushIntervalMs)
  }

  const scheduleToolInputFlush = (): void => {
    if (toolInputTimer) return
    toolInputTimer = setTimeout(() => {
      toolInputTimer = null
      flushToolInputs()
    }, toolInputFlushIntervalMs)
  }

  return {
    pushThinking: (chunk: string) => {
      if (!chunk) return
      thinkingBuffer += chunk
      scheduleFlush()
    },
    pushText: (chunk: string) => {
      if (!chunk) return
      textBuffer += chunk
      scheduleFlush()
    },
    setToolInput: (toolUseId: string, input: Record<string, unknown>) => {
      toolInputBuffer.set(toolUseId, input)
      scheduleToolInputFlush()
    },
    flushNow,
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (toolInputTimer) {
        clearTimeout(toolInputTimer)
        toolInputTimer = null
      }
      thinkingBuffer = ''
      textBuffer = ''
      toolInputBuffer.clear()
    }
  }
}
