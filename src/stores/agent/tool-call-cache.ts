import type { ToolCallState } from '@/lib/agent/types'
import type { ToolResultContent } from '@/lib/api/types'
import { compactBashToolResultContent } from '@/lib/tools/bash-output'
import { summarizeToolInputForHistory } from '@/lib/tools/tool-input-sanitizer'
import { isAgentRuntimeSyncSuppressed, emitAgentRuntimeSync } from '@/lib/agent/runtime-sync'
import type { AgentStoreInternals, TaskToolCallCache } from './types'

const MAX_TRACKED_TOOL_CALLS = 200
const MAX_TOOL_INPUT_PREVIEW_CHARS = 6_000
const MAX_TOOL_OUTPUT_TEXT_CHARS = 8_000
const MAX_TOOL_ERROR_CHARS = 2_000
const MAX_IMAGE_BASE64_CHARS = 4_096

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n... [truncated, ${value.length} chars total]`
}

function normalizeToolInput(
  input: Record<string, unknown>,
  toolName?: string
): Record<string, unknown> {
  const summarized = toolName ? summarizeToolInputForHistory(toolName, input) : input
  try {
    const serialized = JSON.stringify(summarized)
    if (serialized.length <= MAX_TOOL_INPUT_PREVIEW_CHARS) return summarized
    return {
      _truncated: true,
      preview: truncateText(serialized, MAX_TOOL_INPUT_PREVIEW_CHARS)
    }
  } catch {
    return { _truncated: true, preview: '[unserializable input]' }
  }
}

function normalizeToolCallInput(
  toolName: string | undefined,
  input: Record<string, unknown>
): Record<string, unknown> {
  return normalizeToolInput(input, toolName)
}

function limitToolResultContent(
  output: ToolResultContent | undefined
): ToolResultContent | undefined {
  if (output === undefined) return undefined
  if (typeof output === 'string') {
    return truncateText(output, MAX_TOOL_OUTPUT_TEXT_CHARS)
  }

  const normalized: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image'
        source: {
          type: 'base64' | 'url'
          mediaType?: string
          data?: string
          url?: string
          filePath?: string
        }
      }
  > = []
  let totalChars = 0

  for (const block of output) {
    if (block.type === 'text') {
      const text = truncateText(block.text, MAX_TOOL_OUTPUT_TEXT_CHARS)
      totalChars += text.length
      normalized.push({ ...block, text })
      if (totalChars >= MAX_TOOL_OUTPUT_TEXT_CHARS) {
        normalized.push({
          type: 'text',
          text: `[tool output truncated after ${MAX_TOOL_OUTPUT_TEXT_CHARS} chars]`
        })
        break
      }
      continue
    }

    if (
      block.type === 'image' &&
      block.source.data &&
      block.source.data.length > MAX_IMAGE_BASE64_CHARS
    ) {
      const sourceWithoutData = { ...block.source }
      delete sourceWithoutData.data
      if (sourceWithoutData.filePath || sourceWithoutData.url) {
        normalized.push({
          type: 'image',
          source: sourceWithoutData
        })
        continue
      }

      normalized.push({
        type: 'text',
        text: `[image data omitted, ${block.source.data.length} base64 chars]`
      })
      continue
    }

    normalized.push(block)
  }

  return normalized
}

function normalizeToolOutput(
  toolName: string | undefined,
  output: ToolResultContent | undefined
): ToolResultContent | undefined {
  if (output === undefined) return undefined
  const compacted = toolName === 'Bash' ? compactBashToolResultContent(output) : output
  return limitToolResultContent(compacted)
}

export function normalizeToolCall(tc: ToolCallState): ToolCallState {
  return {
    ...tc,
    input: normalizeToolCallInput(tc.name, tc.input),
    output: normalizeToolOutput(tc.name, tc.output),
    error: tc.error ? truncateText(tc.error, MAX_TOOL_ERROR_CHARS) : tc.error
  }
}

function normalizeToolCallPatch(
  patch: Partial<ToolCallState>,
  toolName?: string
): Partial<ToolCallState> {
  return {
    ...patch,
    ...(patch.input ? { input: normalizeToolCallInput(patch.name ?? toolName, patch.input) } : {}),
    ...(patch.output !== undefined
      ? { output: normalizeToolOutput(patch.name ?? toolName, patch.output) }
      : {}),
    ...(patch.error ? { error: truncateText(patch.error, MAX_TOOL_ERROR_CHARS) } : {})
  }
}

function toolCallPatchHasChanges(existing: ToolCallState, patch: Partial<ToolCallState>): boolean {
  for (const [key, nextValue] of Object.entries(patch)) {
    const currentValue = (existing as unknown as Record<string, unknown>)[key]
    if (Object.is(currentValue, nextValue)) continue

    // For object-like fields (input/output), callers may pass new objects with the
    // same content frequently. Avoid forcing a rerender when nothing actually changed.
    if (typeof currentValue === 'object' && typeof nextValue === 'object') {
      try {
        const a = JSON.stringify(currentValue)
        const b = JSON.stringify(nextValue)
        if (a === b) continue
      } catch {
        // If either value can't be stringified, treat it as changed.
      }
    }

    return true
  }
  return false
}

export function trimToolCallArray(toolCalls: ToolCallState[]): void {
  if (toolCalls.length <= MAX_TRACKED_TOOL_CALLS) return
  toolCalls.splice(0, toolCalls.length - MAX_TRACKED_TOOL_CALLS)
}

function cloneToolCallArray(toolCalls: ToolCallState[]): ToolCallState[] {
  return toolCalls.map((toolCall) => ({ ...toolCall }))
}

export function applyToolCallToBuckets(
  pending: ToolCallState[],
  executed: ToolCallState[],
  tc: ToolCallState
): void {
  const normalizedTc = normalizeToolCall(tc)
  const execIdx = executed.findIndex((item) => item.id === normalizedTc.id)
  if (execIdx !== -1) {
    if (normalizedTc.status === 'pending_approval') {
      const [moved] = executed.splice(execIdx, 1)
      const updated = { ...moved, ...normalizedTc }
      pending.push(updated)
    } else {
      executed[execIdx] = { ...executed[execIdx], ...normalizedTc }
    }
    trimToolCallArray(executed)
    trimToolCallArray(pending)
    return
  }

  const pendingIdx = pending.findIndex((item) => item.id === normalizedTc.id)
  if (pendingIdx !== -1) {
    if (normalizedTc.status !== 'pending_approval') {
      const [moved] = pending.splice(pendingIdx, 1)
      const updated = { ...moved, ...normalizedTc }
      executed.push(updated)
    } else {
      pending[pendingIdx] = { ...pending[pendingIdx], ...normalizedTc }
    }
    trimToolCallArray(executed)
    trimToolCallArray(pending)
    return
  }

  if (normalizedTc.status === 'pending_approval') {
    pending.push(normalizedTc)
  } else {
    executed.push(normalizedTc)
  }
  trimToolCallArray(executed)
  trimToolCallArray(pending)
}

export function applyToolCallPatchToBuckets(
  pending: ToolCallState[],
  executed: ToolCallState[],
  id: string,
  patch: Partial<ToolCallState>
): boolean {
  const pendingToolCall = pending.find((item) => item.id === id)
  const executedToolCall = executed.find((item) => item.id === id)
  const normalizedPatch = normalizeToolCallPatch(
    patch,
    pendingToolCall?.name ?? executedToolCall?.name
  )
  if (pendingToolCall) {
    if (!toolCallPatchHasChanges(pendingToolCall, normalizedPatch)) return false
    const updated = { ...pendingToolCall, ...normalizedPatch }
    if (normalizedPatch.status && normalizedPatch.status !== 'pending_approval') {
      const index = pending.findIndex((item) => item.id === id)
      if (index !== -1) {
        pending.splice(index, 1)
        executed.push(updated)
      }
    } else {
      const index = pending.findIndex((item) => item.id === id)
      if (index !== -1) {
        pending[index] = updated
      }
    }
    trimToolCallArray(executed)
    trimToolCallArray(pending)
    return true
  }

  if (executedToolCall) {
    if (!toolCallPatchHasChanges(executedToolCall, normalizedPatch)) return false
    const index = executed.findIndex((item) => item.id === id)
    if (index !== -1) {
      executed[index] = { ...executedToolCall, ...normalizedPatch }
    }
    trimToolCallArray(executed)
    return true
  }

  return false
}

function ensureTaskToolCallCache(
  state: {
    taskToolCallsCache: Record<string, TaskToolCallCache>
  },
  taskId: string
): TaskToolCallCache {
  const existing = state.taskToolCallsCache[taskId]
  if (existing) return existing
  const created: TaskToolCallCache = { pending: [], executed: [] }
  state.taskToolCallsCache[taskId] = created
  return created
}

function resolveTaskToolCallTarget(
  state: {
    liveTaskId: string | null
    pendingToolCalls: ToolCallState[]
    executedToolCalls: ToolCallState[]
    taskToolCallsCache: Record<string, TaskToolCallCache>
  },
  taskId?: string | null
): TaskToolCallCache {
  if (!taskId || taskId === state.liveTaskId) {
    return {
      pending: state.pendingToolCalls,
      executed: state.executedToolCalls
    }
  }
  return ensureTaskToolCallCache(state, taskId)
}

export function createSwitchToolCallTask(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (prevTaskId: string | null, nextTaskId: string | null) => {
    set((state) => {
      if (prevTaskId) {
        state.taskToolCallsCache[prevTaskId] = {
          pending: cloneToolCallArray(state.pendingToolCalls),
          executed: cloneToolCallArray(state.executedToolCalls)
        }
      }

      const cached = nextTaskId ? state.taskToolCallsCache[nextTaskId] : undefined
      state.liveTaskId = nextTaskId
      state.pendingToolCalls = cloneToolCallArray(cached?.pending ?? [])
      state.executedToolCalls = cloneToolCallArray(cached?.executed ?? [])

      const cacheKeys = Object.keys(state.taskToolCallsCache)
      if (cacheKeys.length > 10) {
        const toRemove = cacheKeys.slice(0, cacheKeys.length - 10)
        for (const key of toRemove) {
          delete state.taskToolCallsCache[key]
        }
      }
    })
  }
}

export function createResetLiveTaskExecution(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (taskId: string) => {
    set((state) => {
      delete state.taskToolCallsCache[taskId]

      if (state.liveTaskId !== taskId) return
      state.pendingToolCalls = []
      state.executedToolCalls = []
    })
  }
}

export function createAddToolCall(
  set: AgentStoreInternals['set'],
  get: AgentStoreInternals['get']
) {
  return (tc: ToolCallState, taskId?: string | null) => {
    const resolvedTaskId = taskId ?? tc.taskId ?? get().liveTaskId
    set((state) => {
      const target = resolveTaskToolCallTarget(state, resolvedTaskId)
      applyToolCallToBuckets(target.pending, target.executed, {
        ...tc,
        ...(resolvedTaskId ? { taskId: resolvedTaskId } : {})
      })
    })
    if (!isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({
        kind: 'add_tool_call',
        toolCall: tc,
        taskId: resolvedTaskId
      })
    }
  }
}

export function createUpdateToolCall(
  set: AgentStoreInternals['set'],
  get: AgentStoreInternals['get']
) {
  return (id: string, patch: Partial<ToolCallState>, taskId?: string | null) => {
    let changed = false
    let resolvedTaskId = taskId ?? patch.taskId ?? get().liveTaskId ?? null
    set((state) => {
      const explicitTaskId = taskId ?? patch.taskId ?? null
      if (explicitTaskId) {
        const target = resolveTaskToolCallTarget(state, explicitTaskId)
        if (applyToolCallPatchToBuckets(target.pending, target.executed, id, patch)) {
          changed = true
          resolvedTaskId = explicitTaskId
          return
        }
      }

      if (
        applyToolCallPatchToBuckets(state.pendingToolCalls, state.executedToolCalls, id, patch)
      ) {
        changed = true
        resolvedTaskId = state.liveTaskId
        return
      }

      for (const [cacheTaskId, cache] of Object.entries(state.taskToolCallsCache)) {
        if (applyToolCallPatchToBuckets(cache.pending, cache.executed, id, patch)) {
          changed = true
          resolvedTaskId = cacheTaskId
          return
        }
      }
    })
    if (changed && !isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({
        kind: 'update_tool_call',
        id,
        patch,
        taskId: resolvedTaskId
      })
    }
  }
}

export function createClearToolCalls(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return () => {
    set((state) => {
      state.liveTaskId = null
      state.pendingToolCalls = []
      state.executedToolCalls = []
      state.approvedToolNames = []
      state.foregroundShellExecByToolUseId = {}
      state.taskToolCallsCache = {}
      state.taskBackgroundProcessSummaries = {}
    })
  }
}
