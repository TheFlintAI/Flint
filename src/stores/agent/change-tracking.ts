import { nanoid } from 'nanoid'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { createRow, upsertRow, deleteRow, updateRow } from '@/lib/db/json-store'
import { useUIStore } from '../ui-store'
import { createLogger } from '@/lib/logger'

const log = createLogger('ChangeTracking')
const MAX_CHANGE_SETS = 40

// Types

export type FileOp = 'create' | 'modify' | 'delete'

export interface FileSnapshot {
  exists: boolean
  text?: string
  previewText?: string
  tailPreviewText?: string
  textOmitted?: boolean
  hash: string | null
  size: number
  lineCount?: number
  mtimeMs?: number | null
}

export interface FileChange {
  id: string
  runId: string
  taskId?: string
  toolUseId?: string
  toolName?: string
  filePath: string
  transport: 'local' | 'ssh'
  connectionId?: string
  op: FileOp
  status: 'open' | 'reverted'
  before: FileSnapshot
  after: FileSnapshot
  createdAt: number
  revertedAt?: number
}

export interface ChangeSet {
  runId: string
  taskId?: string
  assistantMessageId?: string
  status: 'open' | 'reverted'
  changes: FileChange[]
  createdAt: number
  updatedAt: number
}

export interface ChangeTrackingState {
  changeSets: Record<string, ChangeSet>
  hydrateChangeSets: (taskId: string) => Promise<void>
  recordFileChange: (input: {
    runId: string
    taskId?: string
    toolUseId?: string
    toolName?: string
    filePath: string
    op: FileOp
    before: FileSnapshot
    after: FileSnapshot
    fullTextBefore?: string
    fullTextAfter?: string
  }) => Promise<void>
  revertChangeSet: (runId: string) => Promise<{ error?: string }>
  revertFileChange: (runId: string, changeId: string) => Promise<{ error?: string }>
}

// Helpers

/** Canonical derivation of the net file operation from before/after existence. */
export function deriveOp(
  before: FileSnapshot,
  after: FileSnapshot
): FileOp | null {
  if (!before.exists && after.exists) return 'create'
  if (before.exists && !after.exists) return 'delete'
  if (before.exists && after.exists) return 'modify'
  return null
}

function isAgentChangeError(value: unknown): value is { error: string } {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { error?: unknown }).error === 'string'
}

function trimChangeSets(map: Record<string, ChangeSet>): void {
  const entries = Object.entries(map).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  if (entries.length <= MAX_CHANGE_SETS) return
  const removeCount = entries.length - MAX_CHANGE_SETS
  for (let index = 0; index < removeCount; index += 1) {
    delete map[entries[index][0]]
  }
}

async function persistFileChange(
  input: {
    runId: string
    taskId?: string
    toolUseId?: string
    toolName?: string
    filePath: string
    op: FileOp
    fullTextBefore?: string
    fullTextAfter?: string
  },
  changeId: string,
  now: number
): Promise<void> {
  await createRow('agent_file_changes', {
    id: changeId,
    run_id: input.runId,
    task_id: input.taskId ?? null,
    file_path: input.filePath,
    status: 'open',
    sort_order: now,
    tool_use_id: input.toolUseId ?? null,
    tool_name: input.toolName ?? null,
    op: input.op,
    transport: 'local',
    before_json: JSON.stringify({ fullText: input.fullTextBefore }),
    after_json: JSON.stringify({ fullText: input.fullTextAfter }),
    created_at: now,
    updated_at: now
  })
  await upsertRow('agent_change_sets', {
    id: input.runId,
    run_id: input.runId,
    task_id: input.taskId ?? null,
    assistant_message_id: input.runId,
    status: 'open',
    created_at: now,
    updated_at: now
  })
}

// Zustand Slice

export function createChangeTrackingSlice(
  set: (recipe: (state: ChangeTrackingState) => void) => void
): ChangeTrackingState {
  return {
    changeSets: {},

    hydrateChangeSets: async (taskId) => {
      if (!taskId) return
      try {
        const result = await tauriCommands.invoke(TAURI_COMMANDS.AGENT_CHANGES_LIST_TASK, { taskId })
        if (isAgentChangeError(result) || !Array.isArray(result)) return
        set((state) => {
          for (const item of result) {
            if (!item || typeof item !== 'object' || !('runId' in item)) continue
            const cs = item as ChangeSet
            if (state.changeSets[cs.runId]) continue
            state.changeSets[cs.runId] = cs
          }
          trimChangeSets(state.changeSets)
        })
      } catch {
        // ignore fetch failures for ephemeral change journal state
      }
    },

    recordFileChange: async (input) => {
      const { runId, taskId, toolUseId, toolName, filePath, op, before, after } = input
      if (!runId || !filePath) return
      if (!taskId?.trim()) {
        log.warn(
          'recordFileChange: no taskId available, change will not be scoped to any task',
          { runId, filePath, op }
        )
      }

      const now = Date.now()

      let mergeAction: 'create' | 'update' | 'delete' = 'create'
      let mergedChangeId: string | null = null
      let mergedDbPatch: Record<string, unknown> = {}

      set((state) => {
        const existingCs = state.changeSets[runId]
        const existingChanges: FileChange[] = existingCs?.changes ?? []

        const existingIdx = existingChanges.findIndex(
          (c) => c.filePath === filePath && c.status === 'open'
        )

        if (existingIdx === -1) {
          const changeId = nanoid()
          const change: FileChange = {
            id: changeId,
            runId,
            taskId,
            toolUseId,
            toolName,
            filePath,
            transport: 'local',
            op,
            status: 'open',
            before,
            after,
            createdAt: now
          }
          const createdAt = existingCs?.createdAt ?? now
          state.changeSets[runId] = {
            runId,
            taskId,
            status: 'open',
            changes: [...existingChanges, change],
            createdAt,
            updatedAt: now
          }
          trimChangeSets(state.changeSets)
          mergeAction = 'create'
          mergedChangeId = changeId
          return
        }

        const existingChange = existingChanges[existingIdx]
        const mergedOp = deriveOp(existingChange.before, after)

        if (mergedOp === null) {
          const filtered = [...existingChanges]
          filtered.splice(existingIdx, 1)
          state.changeSets[runId] = {
            runId,
            taskId,
            status: 'open',
            changes: filtered,
            createdAt: existingCs!.createdAt,
            updatedAt: now
          }
          mergeAction = 'delete'
          mergedChangeId = existingChange.id
        } else {
          const updatedChange: FileChange = {
            ...existingChange,
            taskId: taskId ?? existingChange.taskId,
            toolUseId: toolUseId ?? existingChange.toolUseId,
            toolName: toolName ?? existingChange.toolName,
            op: mergedOp,
            after
          }
          const updatedChanges = [...existingChanges]
          updatedChanges[existingIdx] = updatedChange
          state.changeSets[runId] = {
            runId,
            taskId,
            status: 'open',
            changes: updatedChanges,
            createdAt: existingCs!.createdAt,
            updatedAt: now
          }
          mergeAction = 'update'
          mergedChangeId = existingChange.id
          mergedDbPatch = {
            op: mergedOp,
            after_json: JSON.stringify({ fullText: input.fullTextAfter }),
            tool_use_id: input.toolUseId ?? null,
            tool_name: input.toolName ?? null,
            updated_at: now
          }
        }
      })

      log.info('recordFileChange', { runId, taskId, filePath, op, mergeAction })
      useUIStore.getState().openRightPanel(taskId)

      if (mergeAction === 'create') {
        await persistFileChange(input, mergedChangeId!, now).catch(() => {})
      } else if (mergeAction === 'delete') {
        await deleteRow('agent_file_changes', mergedChangeId!).catch(() => {})
      } else if (mergeAction === 'update') {
        await updateRow('agent_file_changes', mergedChangeId!, mergedDbPatch).catch(() => {})
      }
    },

    revertChangeSet: async (runId) => {
      if (!runId) return { error: 'runId is required' }
      try {
        const result = await tauriCommands.invoke(TAURI_COMMANDS.AGENT_CHANGES_UNDO_RUN, { runId })
        if (isAgentChangeError(result)) return { error: result.error }

        const now = Date.now()
        set((state) => {
          const cs = state.changeSets[runId]
          if (!cs) return
          for (const change of cs.changes) {
            if (change.status === 'open') {
              change.status = 'reverted'
              change.revertedAt = now
            }
          }
        })
        return {}
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },

    revertFileChange: async (runId, changeId) => {
      if (!runId || !changeId) return { error: 'runId and changeId are required' }
      try {
        const result = await tauriCommands.invoke(TAURI_COMMANDS.AGENT_CHANGES_UNDO_FILE, { runId, changeId })
        if (isAgentChangeError(result)) return { error: result.error }

        const now = Date.now()
        set((state) => {
          for (const cs of Object.values(state.changeSets)) {
            for (const change of cs.changes) {
              if (change.id === changeId && change.status === 'open') {
                change.status = 'reverted'
                change.revertedAt = now
                return
              }
            }
          }
        })
        return {}
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  }
}
