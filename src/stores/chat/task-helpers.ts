import type { UnifiedMessage } from '@/lib/api/types'
import type { Task } from './types'

/**
 * Rebuilds tasksById map from the tasks array.
 * Must be called whenever the shape of the tasks array changes
 * (push, splice, filter, wholesale replacement).
 */
export function syncTasksById(state: {
  tasks: Task[]
  tasksById: Record<string, number>
}): void {
  const next: Record<string, number> = {}
  for (let i = 0; i < state.tasks.length; i++) {
    next[state.tasks[i].id] = i
  }
  state.tasksById = next
}

/** O(1) task lookup via tasksById index, with linear-scan fallback. */
export function getTaskByIdFromState<T extends { id: string }>(
  state: { tasks: T[]; tasksById: Record<string, number> },
  taskId: string
): T | undefined {
  const idx = state.tasksById[taskId]
  if (idx !== undefined) {
    const candidate = state.tasks[idx]
    if (candidate && candidate.id === taskId) return candidate
  }
  return state.tasks.find((s) => s.id === taskId)
}

export function getResidentTaskScore(task: Task): number {
  return (
    (task.messagesLoaded ? 1_000_000 : 0) +
    task.messages.length * 1_000 +
    Math.max(0, task.loadedRangeEnd - task.loadedRangeStart)
  )
}

export function chooseResidentTask(left: Task, right: Task): Task {
  const leftScore = getResidentTaskScore(left)
  const rightScore = getResidentTaskScore(right)
  if (rightScore > leftScore) return right
  if (leftScore > rightScore) return left
  return right.updatedAt > left.updatedAt ? right : left
}

export function copyResidentTaskState(target: Task, source: Task): void {
  target.messages = source.messages
  target.messageCount = source.messageCount
  target.messagesLoaded = source.messagesLoaded
  target.loadedRangeStart = source.loadedRangeStart
  target.loadedRangeEnd = source.loadedRangeEnd
  target.lastKnownMessageCount = source.lastKnownMessageCount
  target.promptSnapshot = source.promptSnapshot
}

export function dedupeTasksById(
  state: { tasks: Task[]; tasksById: Record<string, number> },
  taskId: string
): Task | undefined {
  const matches = state.tasks.filter((task) => task.id === taskId)
  if (matches.length === 0) return undefined

  const keeper = matches.reduce(chooseResidentTask)
  for (const duplicate of matches) {
    if (duplicate === keeper) continue
    if (chooseResidentTask(keeper, duplicate) === duplicate) {
      copyResidentTaskState(keeper, duplicate)
    }
    keeper.updatedAt = Math.max(keeper.updatedAt, duplicate.updatedAt)
    keeper.createdAt = Math.min(keeper.createdAt, duplicate.createdAt)
    keeper.promptSnapshot = keeper.promptSnapshot ?? duplicate.promptSnapshot
  }

  if (matches.length > 1) {
    state.tasks = state.tasks.filter(
      (task) => task.id !== taskId || task === keeper
    )
  }
  syncTasksById(state)
  return keeper
}

export const MESSAGE_LOAD_SNAPSHOT_TAIL_SIZE = 8

export function matchesMessageLoadSnapshot(
  task: Pick<Task, 'messageCount' | 'messages'> | undefined,
  expectedMessageCount: number,
  expectedTailMessageIds: string[]
): boolean {
  if (!task) return false
  const currentKnownCount = task.messageCount ?? task.messages.length
  if (currentKnownCount !== expectedMessageCount) return false
  if (expectedTailMessageIds.length === 0) return true
  if (task.messages.length === 0) return true

  const currentTailMessageIds = task.messages
    .slice(-expectedTailMessageIds.length)
    .map((message) => message.id)

  return (
    currentTailMessageIds.length === expectedTailMessageIds.length &&
    currentTailMessageIds.every((messageId, index) => messageId === expectedTailMessageIds[index])
  )
}

/** Bump the monotonic revision counter used by React.memo equality checks. */
export function bumpMessageRevision(msg: UnifiedMessage): void {
  msg._revision = (msg._revision ?? 0) + 1
}
