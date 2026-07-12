import type { TeamEvent } from '@/lib/agent/teams/types'
import type { ToolCallState } from '@/lib/agent/types'
import { SYNC_SENDER_ID, type SyncEnvelope } from '@/lib/agent/task-runtime-sync'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import type { TodoItem } from '@/stores/todo-store'
import type { ActiveTeam } from '@/stores/team-store'

export type AgentRuntimeSyncEvent =
  | { kind: 'set_running'; running: boolean }
  | {
      kind: 'set_session_status'
      taskId: string
      status: 'running' | 'retrying' | 'completed' | null
    }
  | { kind: 'add_tool_call'; toolCall: ToolCallState; taskId?: string | null }
  | {
      kind: 'update_tool_call'
      id: string
      patch: Partial<ToolCallState>
      taskId?: string | null
    }
  | { kind: 'task_add'; task: TodoItem }
  | {
      kind: 'task_update'
      id: string
      patch: Partial<Omit<TodoItem, 'id' | 'createdAt'>>
    }
  | { kind: 'task_delete'; id: string }
  | { kind: 'task_delete_session'; taskId: string }
  | { kind: 'team_event'; event: TeamEvent; taskId?: string | null }
  | {
      kind: 'team_meta'
      taskId: string
      patch: Partial<Pick<ActiveTeam, 'permissionMode' | 'teamAllowedPaths'>>
    }
  | { kind: 'clear_session_team'; taskId: string }

let suppressionDepth = 0

export function isAgentRuntimeSyncSuppressed(): boolean {
  return suppressionDepth > 0
}

export function withAgentRuntimeSyncSuppressed<T>(fn: () => T): T {
  suppressionDepth += 1
  try {
    return fn()
  } finally {
    suppressionDepth = Math.max(0, suppressionDepth - 1)
  }
}

export function emitAgentRuntimeSync(event: AgentRuntimeSyncEvent): void {
  if (isAgentRuntimeSyncSuppressed()) return
  const envelope: SyncEnvelope = { senderId: SYNC_SENDER_ID, event }
  tauriCommands.send(TAURI_COMMANDS.AGENT_RUNTIME_SYNC, envelope)
}

export function installAgentRuntimeSyncListener(
  onEvent: (event: AgentRuntimeSyncEvent) => void
): () => void {
  return tauriCommands.on(TAURI_COMMANDS.AGENT_RUNTIME_SYNC, (data: unknown) => {
    const envelope = data as SyncEnvelope
    if (envelope.senderId === SYNC_SENDER_ID) return
    onEvent(envelope.event as AgentRuntimeSyncEvent)
  })
}
