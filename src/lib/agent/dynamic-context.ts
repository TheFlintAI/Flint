import { useUIStore } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import { useTodoStore } from '@/stores/todo-store'
import { useSettingsStore } from '@/stores/settings-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { estimateTokens } from '@/lib/utils/format-tokens'
import type { AIModelConfig } from '../api/types'
import type { MemoryIndexSnapshot } from '@/protocols/memory-types'
import type { MemoryPromptData } from './prompt-engine/types'

const FILE_CONTEXT_BUDGET_RATIO = 0.25
const FILE_CONTEXT_BUDGET_MAX_TOKENS = 24_000
const FILE_CONTEXT_FALLBACK_TOKENS = 12_000
/** Maximum memory index entries injected into the system prompt. */
const MAX_MEMORY_INDEX_ENTRIES = 60

/**
 * Build a runtime reminder injected into the last user message.
 * Includes lightweight taskItem state and selected file contents.
 */
export async function buildRuntimeReminder(options: {
  taskId: string
  modelConfig?: AIModelConfig | null
}): Promise<string> {
  const { taskId, modelConfig } = options

  const parts: string[] = []
  const taskStateContext = buildTaskStateContext(taskId)
  if (taskStateContext) {
    parts.push(taskStateContext)
  }

  const selectedFiles = useUIStore.getState().selectedFiles ?? []
  const taskItem = useChatStore.getState().tasks.find((s) => s.id === taskId)
  const workingFolder = taskItem?.workingFolder

  if (selectedFiles.length > 0) {
    const selectedFileContext = await buildSelectedFileContext(
      selectedFiles,
      workingFolder,
      modelConfig
    )
    if (selectedFileContext) {
      parts.push(selectedFileContext)
    }
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

async function buildSelectedFileContext(
  selectedFiles: string[],
  workingFolder?: string,
  modelConfig?: AIModelConfig | null
): Promise<string> {
  const budget = resolveFileContextBudget(modelConfig)
  let usedTokens = 0
  const fileSections: string[] = []
  const skipped: string[] = []

  for (const filePath of selectedFiles) {
    const displayPath =
      workingFolder && filePath.startsWith(workingFolder)
        ? filePath.slice(workingFolder.length).replace(/^[\\/]/, '')
        : filePath

    try {
      const content = await tauriCommands.invoke('fs:read-file', { path: filePath })
      if (typeof content !== 'string') {
        skipped.push(`${displayPath} [unreadable]`)
        continue
      }

      const section = [`## ${displayPath}`, content].join('\n')
      const sectionTokens = estimateTokens(section)
      if (usedTokens + sectionTokens <= budget) {
        fileSections.push(section)
        usedTokens += sectionTokens
        continue
      }

      const remainingBudget = budget - usedTokens
      if (remainingBudget <= 0) {
        skipped.push(`${displayPath} [skipped: context budget exceeded]`)
        continue
      }

      const truncated = truncateToTokenBudget(content, remainingBudget)
      if (!truncated.trim()) {
        skipped.push(`${displayPath} [skipped: context budget exceeded]`)
        continue
      }

      fileSections.push(`## ${displayPath}\n${truncated}\n[Truncated due to context budget]`)
      usedTokens = budget
    } catch {
      skipped.push(`${displayPath} [read failed]`)
    }
  }

  if (fileSections.length === 0 && skipped.length === 0) {
    return ''
  }

  const lines = ['<selected_files>', `Selected Files: ${selectedFiles.length}`]
  if (fileSections.length > 0) {
    lines.push(...fileSections)
  }
  if (skipped.length > 0) {
    lines.push('## Skipped Files', ...skipped.map((item) => `- ${item}`))
  }
  lines.push('</selected_files>')
  return lines.join('\n')
}

function resolveFileContextBudget(modelConfig?: AIModelConfig | null): number {
  const contextLength = modelConfig?.contextLength
  if (typeof contextLength !== 'number' || contextLength <= 0) {
    return FILE_CONTEXT_FALLBACK_TOKENS
  }
  return Math.min(
    FILE_CONTEXT_BUDGET_MAX_TOKENS,
    Math.max(4_000, Math.floor(contextLength * FILE_CONTEXT_BUDGET_RATIO))
  )
}

function truncateToTokenBudget(content: string, tokenBudget: number): string {
  if (!content || tokenBudget <= 0) return ''
  const lines = content.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    const candidate = kept.length > 0 ? `${kept.join('\n')}\n${line}` : line
    if (estimateTokens(candidate) > tokenBudget) {
      break
    }
    kept.push(line)
  }
  return kept.join('\n')
}
