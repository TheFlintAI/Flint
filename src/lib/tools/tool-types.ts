import type { ToolDefinition, ToolResultContent } from '../api/types'
import type { LocalizedString } from '@/lib/localized-string'
import type { ToolRenderDescriptor } from './tool-render-types'

// --- Tool Permission ---

export type ToolPermission = 'allow' | 'ask' | 'deny'
export type ToolPermissionResolver = (input: Record<string, unknown>, ctx: ToolContext) => ToolPermission

// --- Tool Context ---

export interface ToolContext {
  taskId?: string
  /** Assistant message id backing this run — used as the fs-interceptor run id. */
  runId?: string
  workingFolder?: string
  sshConnectionId?: string
  signal: AbortSignal
  commands: TauriCommandClient
  /** Files read during this run, keyed by normalized resolved path. */
  readFileHistory?: Map<string, FileReadSnapshot>
  /** The tool_use block id currently being executed (set by agent-loop) */
  currentToolUseId?: string
  /** Identifies the calling agent — used to restrict certain tool behaviors */
  callerAgent?: string
  /** Mutable shared state bag — survives { ...toolCtx } spread copies in agent-loop. */
  sharedState?: {
    bashCwd?: string
    /** Set by the CompleteWork tool; the runner reads it as the completion report. */
    completeWork?: string
  }
}

export interface FileReadSnapshot {
  exists: boolean
  type?: 'file' | 'directory' | 'other' | null
  size?: number | null
  mtimeMs?: number | null
}

export interface TauriCommandClient {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  send(channel: string, ...args: unknown[]): void
  on<T = unknown>(channel: string, callback: (...args: T[]) => void): () => void
  removeListener?<T = unknown>(channel: string, callback: (...args: T[]) => void): void
  removeAllListeners?(channel: string): void
  once?<T = unknown>(channel: string, callback: (...args: T[]) => void): () => void
}

// --- Tool Handler ---

export interface ToolHandler {
  definition: ToolDefinition
  /** UI display name. Falls back to i18n key `permission.toolLabels.<name>` if unset. */
  displayName?: LocalizedString
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResultContent>
  /** Semantic groups for prompt-section gating (e.g. 'task-management', 'team-management'). */
  groups?: string[]
  /** Render descriptor — how ToolPanel displays this tool. */
  render: ToolRenderDescriptor
  /** Summarize input for the approval dialog. Returns null to use default JSON display. */
  formatApprovalSummary?: (input: Record<string, unknown>) => string | null
}
