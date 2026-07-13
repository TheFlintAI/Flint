import { useTodoStore } from '@/stores/todo-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { MemoryIndexSnapshot } from '@/protocols/memory-types'
import type { MemoryPromptData } from './prompt-engine/types'

const FILE_CONTEXT_BUDGET_RATIO = 0.25
const FILE_CONTEXT_BUDGET_MAX_TOKENS = 24_000
const FILE_CONTEXT_FALLBACK_TOKENS = 12_000
/** Maximum memory index entries injected into the system prompt. */
const MAX_MEMORY_INDEX_ENTRIES = 60

/**
 * Build a runtime reminder injected into the last user message.
 * Includes lightweight task state context.
 */
export async function buildRuntimeReminder(options: {
  taskId: string
}): Promise<string> {
  const { taskId } = options

  const parts: string[] = []
  const taskStateContext = buildTaskStateContext(taskId)
  if (taskStateContext) {
    parts.push(taskStateContext)
  }

  if (parts.length === 0) {
    return ''
  }

  return `<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
}

export function buildMemoryContext(snapshot: MemoryIndexSnapshot): MemoryPromptData | null {
  const settings = useSettingsStore.getState()
  const enabled = Boolean(settings.memoryUseMemories)

  const sorted = [...snapshot.entries].sort(
    (a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)
  )
  // Cap the injected index to avoid unbounded system-prompt growth; the rest
  // stays reachable via MemorySearch.
  const visible = sorted.slice(0, MAX_MEMORY_INDEX_ENTRIES)
  const hiddenCount = sorted.length - visible.length

  return {
    enabled,
    totalCount: snapshot.total_entries,
    updatedAt: snapshot.updated_at ? new Date(snapshot.updated_at).toISOString() : null,
    entries: visible.map((e) => ({ summary: e.summary })),
    hiddenCount
  }
}

function buildTaskStateContext(taskId: string): string | null {
  const parts: string[] = ['Task State:']

  const tasks = useTodoStore.getState().getPlanItemsByTask(taskId)
  if (tasks.length > 0) {
    const pending = tasks.filter((task) => task.status === 'pending').length
    const inProgress = tasks.filter((task) => task.status === 'in_progress').length
    const completed = tasks.filter((task) => task.status === 'completed').length
    parts.push(
      `- Task List: ${tasks.length} tasks (${pending} pending, ${inProgress} in_progress, ${completed} completed)`
    )
    if (inProgress > 0 || pending > 0) {
      parts.push(
        '  Reminder: Continue with existing tasks and use TaskUpdate to keep status current.'
      )
    }
  }

  return parts.length > 1 ? parts.join('\n') : null
}
