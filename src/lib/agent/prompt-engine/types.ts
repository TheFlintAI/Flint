// Shared types for the prompt engine: roles, environment, section context.

export type PromptRole = 'main' | 'worker'

export interface EnvironmentContext {
  target: 'local' | 'ssh'
  operatingSystem: string
  shell: string
  host?: string
  connectionName?: string
  pathStyle?: 'windows' | 'posix' | 'unknown'
}

export interface WorkerTaskInfo {
  id: string
  subject: string
  description: string
}

export interface MemoryEntryData {
  summary: string
}

/** Structured memory data rendered by the memory section (presentation lives in the template). */
export interface MemoryPromptData {
  enabled: boolean
  totalCount: number
  updatedAt: string | null
  entries: MemoryEntryData[]
  /** Entries omitted from `entries` to bound system-prompt size. */
  hiddenCount: number
}

export interface SkillPromptData {
  name: string
  description: string
}

export interface SectionContext {
  role: PromptRole
  workingFolder?: string
  taskId?: string
  userRules?: string
  toolNames: string[]
  language?: string
  environmentContext: EnvironmentContext
  memory: MemoryPromptData | null
  /** All available skills (global + workspace) to list in the prompt */
  skills: SkillPromptData[]
  // main-only
  hasActiveTeam: boolean
  activeTeam: Record<string, unknown> | null
  // worker-only (team coordination)
  workerTask?: WorkerTaskInfo | null
  workerInstructions?: string
  teamName?: string
  memberName?: string
  permissionMode?: string
}

export interface PromptSection {
  id: string
  /** Roles this section applies to. Omit for all roles. */
  roles?: PromptRole[]
  /** Extra gate; return false to skip the section. */
  when?: (ctx: SectionContext) => boolean
  /** Return null/empty to skip. */
  build: (ctx: SectionContext) => string | null
}
