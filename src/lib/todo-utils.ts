import type { TodoItem } from '@/stores/todo-store'

/** Shared empty array used as a stable default to avoid re-renders. */
export const EMPTY_TASKS: TodoItem[] = []

/**
 * Standard shape of a team task sufficient to convert into a TodoItem.
 * Accepts both the full `TeamTask` from `@/lib/agent/teams/types` and
 * inline objects with the same fields.
 */
export interface TeamTaskLike {
  id: string
  subject: string
  description: string
  activeForm?: string
  status: string
  owner: string | null
  dependsOn?: string[]
}

/** Convert a team task into the TodoItem shape consumed by ProgressCard and friends. */
export function teamTaskToItem(task: TeamTaskLike): TodoItem {
  return {
    id: task.id,
    taskId: '',
    subject: task.subject,
    description: task.description,
    activeForm: task.activeForm ?? task.subject,
    status: (
      ['pending', 'in_progress', 'completed'].includes(task.status)
        ? task.status
        : 'pending'
    ) as TodoItem['status'],
    owner: task.owner,
    blocks: [],
    blockedBy: task.dependsOn ?? [],
    metadata: undefined,
    createdAt: 0,
    updatedAt: 0,
  }
}
