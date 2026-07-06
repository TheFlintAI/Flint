/**
 * Team runtime on-disk protocol.
 *
 * The on-disk team runtime is a SINGLE concern: an append-only message inbox
 * (`messages.json`) used as the transport between the lead and worker agents.
 * Member, task, and team-meta state live ONLY in the in-memory team store
 * (driven by teamEvents) and are never mirrored to disk — that separation is
 * what prevents the dual-source-of-truth divergence bugs (phantom ID-named
 * agents, members/tasks vanishing on snapshot, etc.).
 */

export type TeamRuntimePermissionMode = 'default' | 'plan'

export type TeamRuntimeMessageType =
  | 'message'
  | 'broadcast'
  | 'shutdown_request'
  | 'shutdown_response'
  | 'idle_notification'
  | 'permission_request'
  | 'permission_response'
  | 'plan_approval_request'
  | 'plan_approval_response'
  | 'team_permission_update'
  | 'mode_set_request'

export interface TeamRuntimeMessageRecord {
  id: string
  from: string
  to: string | 'all'
  type: TeamRuntimeMessageType
  content: string
  summary?: string
  timestamp: number
}

export interface TeamRuntimePermissionResponsePayload {
  approved: boolean
  requestId: string
}

export interface TeamRuntimePlanApprovalRequestPayload {
  requestId: string
  plan: string
  taskId?: string | null
}

export interface TeamRuntimePlanApprovalResponsePayload {
  approved: boolean
  requestId: string
  feedback?: string
}

export interface TeamRuntimePermissionUpdatePayload {
  permissionMode?: TeamRuntimePermissionMode
  teamAllowedPaths?: string[]
}

export interface CreateTeamRuntimeArgs {
  teamName: string
  taskId?: string
  workingFolder?: string
}

export interface TeamRuntimeCreateResult {
  teamName: string
  runtimePath: string
  leadAgentId: string
  createdAt: number
  permissionMode: TeamRuntimePermissionMode
  teamAllowedPaths: string[]
}

export interface DeleteTeamRuntimeArgs {
  teamName: string
}

export interface AppendTeamRuntimeMessageArgs {
  teamName: string
  message: TeamRuntimeMessageRecord
}

export interface ConsumeTeamRuntimeMessagesArgs {
  teamName: string
  afterTimestamp?: number
  recipient?: string
  includeBroadcast?: boolean
  limit?: number
}

// Single source of truth binding each team-runtime command channel to its
// typed args and result. The command-router handlers are typed against this,
// so a return-shape mismatch becomes a compile error rather than a silent bug.
export interface TeamRuntimeCommandMap {
  'team-runtime:create': { args: CreateTeamRuntimeArgs; result: TeamRuntimeCreateResult }
  'team-runtime:delete': { args: DeleteTeamRuntimeArgs; result: { success: true } }
  'team-runtime:message:append': { args: AppendTeamRuntimeMessageArgs; result: { success: true } }
  'team-runtime:messages:consume': { args: ConsumeTeamRuntimeMessagesArgs; result: TeamRuntimeMessageRecord[] }
}
