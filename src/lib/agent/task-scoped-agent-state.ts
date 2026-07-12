import type { ToolCallState } from '@/lib/agent/types'
import type { BackgroundProcessState } from '@/stores/agent-store'
import type { TaskToolCallCache } from '@/stores/agent/types'

const EMPTY_TOOL_CALLS: ToolCallState[] = []

export interface TaskScopedAgentSelection {
  hasActiveToolCallOutput: boolean
  isTaskRunning: boolean
  signature: string
}

export interface TaskScopedAgentSelectionOptions {
  mode?: 'live' | 'coarse'
}

export interface TaskScopedAgentStateSource {
  liveTaskId: string | null
  executedToolCalls: ToolCallState[]
  taskToolCallsCache: Record<string, TaskToolCallCache | undefined>
  runningTasks: Record<string, 'running' | 'retrying' | 'completed'>
  backgroundProcesses: Record<string, BackgroundProcessState>
}

const EMPTY_TASK_AGENT_SELECTION: TaskScopedAgentSelection = {
  hasActiveToolCallOutput: false,
  isTaskRunning: false,
  signature: 'empty'
}

const taskMemoryScopedAgentSelectionCache = new Map<string, TaskScopedAgentSelection>()

function getTaskToolCalls(
  state: TaskScopedAgentStateSource,
  taskId: string
): TaskToolCallCache {
  if (state.liveTaskId === taskId) {
    return {
      executed: state.executedToolCalls
    }
  }
  return (
    state.taskToolCallsCache[taskId] ?? {
      executed: EMPTY_TOOL_CALLS
    }
  )
}

function hasRunningToolCall(toolCalls: ToolCallState[]): boolean {
  return toolCalls.some(
    (toolCall) => toolCall.status === 'running' || toolCall.status === 'streaming' || toolCall.status === 'awaiting_approval'
  )
}

export function selectTaskScopedAgentState(
  state: TaskScopedAgentStateSource,
  taskId: string | null | undefined,
  options?: TaskScopedAgentSelectionOptions
): TaskScopedAgentSelection {
  if (!taskId) return EMPTY_TASK_AGENT_SELECTION

  const toolCalls = getTaskToolCalls(state, taskId)
  const hasActiveToolCallOutput =
    hasRunningToolCall(toolCalls.executed)
  const hasRunningBackgroundProcess = Object.values(state.backgroundProcesses).some(
    (process) => process.taskId === taskId && process.status === 'running'
  )
  const isTaskRunning =
    state.runningTasks[taskId] === 'running' ||
    state.runningTasks[taskId] === 'retrying' ||
    hasRunningBackgroundProcess

  const signature = [
    `run:${isTaskRunning ? '1' : '0'}`,
    `tool:${hasActiveToolCallOutput ? '1' : '0'}`
  ].join(String.fromCharCode(1))
  const cacheKey = taskId + String.fromCharCode(0) + (options?.mode ?? 'live')
  const cached = taskMemoryScopedAgentSelectionCache.get(cacheKey)
  if (cached?.signature === signature) return cached

  const nextSelection: TaskScopedAgentSelection = {
    hasActiveToolCallOutput,
    isTaskRunning,
    signature
  }

  taskMemoryScopedAgentSelectionCache.set(cacheKey, nextSelection)
  return nextSelection
}
