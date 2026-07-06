import type { ToolCallState } from '../types'
import type { TokenUsage } from '@/lib/api/types'
import type {
  TeamRuntimeMessageRecord,
  TeamRuntimePermissionMode
} from '@/protocols/team-runtime-types'

// --- Agent Definition (shared across teams and skill panels) ---

export interface AgentDefinition {
  name: string
  description: string
  icon?: string
  systemPrompt: string
  tools: string[]
  disallowedTools: string[]
  maxTurns: number
  initialPrompt?: string
  background?: boolean
  model?: string
  temperature?: number
}

// --- Team Types ---

export type TeamMemberStatus = 'working' | 'idle' | 'waiting' | 'stopped' | 'completed' | 'failed'

export interface TeamMember {
  id: string
  name: string
  model: string
  agentName?: string
  role?: 'lead' | 'worker'
  status: TeamMemberStatus
  currentTaskId: string | null
  iteration: number
  toolCalls: ToolCallState[]
  streamingText: string
  /**
   * Per-tool-call cursor into `streamingText`: the character length of
   * `streamingText` at the moment that tool call started. Used to interleave
   * tool calls into the text/stage/think timeline in true arrival order
   * (instead of dumping all text units above all tool rows). Missing entry ⇒
   * the tool predates cursor tracking and is appended at the end.
   */
  toolCursors: Record<string, number>
  startedAt: number
  completedAt: number | null
  usage?: TokenUsage
}

export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TeamTask {
  id: string
  subject: string
  description: string
  status: TeamTaskStatus
  owner: string | null
  dependsOn: string[]
  activeForm?: string
  report?: string
}

export type TeamEvent =
  | {
      type: 'team_start'
      taskId?: string
      teamName: string
      runtimePath?: string
      leadAgentId?: string
      permissionMode?: TeamRuntimePermissionMode
      teamAllowedPaths?: string[]
      createdAt?: number
    }
  | { type: 'team_member_add'; taskId?: string; member: TeamMember }
  | { type: 'team_member_update'; taskId?: string; memberId: string; patch: Partial<TeamMember> }
  | { type: 'team_member_remove'; taskId?: string; memberId: string }
  | { type: 'team_task_add'; taskId?: string; task: TeamTask }
  | { type: 'team_task_update'; chatTaskId?: string; taskId: string; patch: Partial<TeamTask> }
  | { type: 'team_message'; taskId?: string; message: TeamRuntimeMessageRecord }
  | { type: 'team_end'; taskId?: string }
