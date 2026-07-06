import type { WritableDraft } from 'immer'
import type { ToolCallState } from '@/lib/agent/types'
import type { BackgroundProcessState } from './background-process'

/** Minimal shape the extracted modules need from the agent store. */
export interface AgentStoreState {
  liveTaskId: string | null
  pendingToolCalls: ToolCallState[]
  executedToolCalls: ToolCallState[]
  taskToolCallsCache: Record<string, TaskToolCallCache>
  approvedToolNames: string[]
  backgroundProcesses: Record<string, BackgroundProcessState>
  foregroundShellExecByToolUseId: Record<string, string>
  taskBackgroundProcessSummaries: Record<string, BackgroundProcessState[]>
  runningTasks: Record<string, 'running' | 'retrying' | 'completed'>
}

export interface TaskToolCallCache {
  pending: ToolCallState[]
  executed: ToolCallState[]
}

/** Setter-shape exposed to extracted modules. */
export interface AgentStoreInternals {
  set: (recipe: (state: WritableDraft<AgentStoreState>) => void) => void
  get: () => AgentStoreState
}
