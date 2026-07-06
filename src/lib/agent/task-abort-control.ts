import { clearPendingQuestions } from '@/lib/tools/ask-user-tool'
import { useAgentStore } from '@/stores/agent-store'
import { useTodoStore } from '@/stores/todo-store'
import {
  installTaskRuntimeControlSyncListener,
  emitTaskRuntimeControlSync,
  type TaskRuntimeControlSyncEvent
} from '@/lib/agent/task-runtime-sync'
import {
  setPendingTaskDispatchPaused
} from '@/lib/chat/pending-messages'

// Helpers that need to be defined in main file (imported here)
let _onAbortTeam: ((taskId: string, clearPendingApprovals?: boolean) => void) | null = null
export function registerAbortTeam(fn: (taskId: string, clearPendingApprovals?: boolean) => void): void {
  _onAbortTeam = fn
}

let _setStreamingNull: ((taskId: string) => void) | null = null
export function registerSetStreamingNull(fn: (taskId: string) => void): void {
  _setStreamingNull = fn
}

/** Per-task abort controllers — module-level so concurrent tasks don't overwrite each other */
const taskAbortControllers = new Map<string, AbortController>()
const continuingToolExecutionTasks = new Set<string>()

export function getTaskAbortController(taskId: string): AbortController | undefined {
  return taskAbortControllers.get(taskId)
}

export function setTaskAbortController(taskId: string, controller: AbortController): void {
  taskAbortControllers.set(taskId, controller)
}

export function deleteTaskAbortController(taskId: string): void {
  taskAbortControllers.delete(taskId)
}

export function isContinuingToolExecution(taskId: string): boolean {
  return continuingToolExecutionTasks.has(taskId)
}

export function markContinuingToolExecution(taskId: string): void {
  continuingToolExecutionTasks.add(taskId)
}

export function unmarkContinuingToolExecution(taskId: string): void {
  continuingToolExecutionTasks.delete(taskId)
}

function finishStoppingTask(taskId: string): void {
  setPendingTaskDispatchPaused(taskId, true)

  const ac = taskAbortControllers.get(taskId)
  if (ac) {
    ac.abort()
    taskAbortControllers.delete(taskId)
  }

  _setStreamingNull?.(taskId)
  useAgentStore.getState().setTaskStatus(taskId, null)

  clearPendingQuestions()

  // Reset all in_progress todo items to pending so spinners stop in the progress card
  const todoStore = useTodoStore.getState()
  const planItems = todoStore.getPlanItemsByTask(taskId)
  for (const item of planItems) {
    if (item.status === 'in_progress') {
      todoStore.updatePlanItem(item.id, { status: 'pending' })
    }
  }

  const hasOtherRunning = Object.values(useAgentStore.getState().runningTasks).some(
    (status) => status === 'running' || status === 'retrying'
  )
  if (!hasOtherRunning) {
    useAgentStore.getState().setRunning(false)
    useAgentStore.getState().abort()
  }
}

export function stopTaskLocally(taskId: string): void {
  finishStoppingTask(taskId)
  _onAbortTeam?.(taskId)
}

function abortTaskLocally(taskId: string): void {
  finishStoppingTask(taskId)
  _onAbortTeam?.(taskId, true)
}

function applyTaskRuntimeControlSyncEvent(event: TaskRuntimeControlSyncEvent): void {
  switch (event.kind) {
    case 'stop_streaming':
      stopTaskLocally(event.taskId)
      return
    case 'abort_session':
      abortTaskLocally(event.taskId)
      return
  }
}

/**
 * Abort all running tasks for a specific taskItem (agent loop + teammates).
 * Safe to call even if the task has nothing running.
 */
export function abortTask(taskId: string): void {
  abortTaskLocally(taskId)
  emitTaskRuntimeControlSync({ kind: 'abort_session', taskId })
}

installTaskRuntimeControlSyncListener((event) => {
  applyTaskRuntimeControlSyncEvent(event)
})
