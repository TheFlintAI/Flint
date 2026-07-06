import type { SectionContext, EnvironmentContext } from './types'
import { toolRegistry } from '../tool-registry'

/** camelCase scope key → tool-group string used by the registry. */
const TOOL_GROUPS: Record<string, string> = {
  teamManagement: 'team-management',
  taskManagement: 'task-management',
  webSearch: 'web-search',
  workerCompletion: 'worker-completion'
}

function stringField(value: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const v = value?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function deriveTeam(ctx: SectionContext): {
  active: boolean
  name?: string
  members: string[]
  permissionMode?: string
} {
  const activeTeam = ctx.activeTeam
  if (!ctx.hasActiveTeam || !activeTeam) return { active: false, members: [] }
  const name = stringField(activeTeam, 'name')
  const rawMembers = activeTeam.members as Array<{ name?: string }> | undefined
  const members = rawMembers?.map((m) => m.name).filter((n): n is string => !!n) ?? []
  const permissionMode = stringField(activeTeam, 'permissionMode')
  return { active: true, name, members, permissionMode }
}

function deriveWorkerTask(ctx: SectionContext): {
  id: string
  subject: string
  details?: string
  hasDetails: boolean
} | null {
  const t = ctx.workerTask
  if (!t) return null
  const subject = t.subject?.trim() ?? ''
  const desc = t.description?.trim() ?? ''
  const details = desc && desc !== subject ? desc : undefined
  return { id: t.id, subject, details, hasDetails: Boolean(details) }
}

/** Build the flat template scope object from a section context. */
export function buildScope(ctx: SectionContext): Record<string, unknown> {
  const env: EnvironmentContext & { isSsh: boolean; isLocal: boolean } = {
    ...ctx.environmentContext,
    isSsh: ctx.environmentContext.target === 'ssh',
    isLocal: ctx.environmentContext.target === 'local'
  }

  // Build tool availability map keyed by actual registry name.
  // tool.Bash → "Bash" (truthy), unavailable tools → undefined (falsy)
  const toolNamesSet = new Set(ctx.toolNames)
  const tool: Record<string, string | undefined> = {}
  for (const name of ctx.toolNames) {
    tool[name] = name
  }

  const toolGroup: Record<string, boolean> = {}
  for (const [key, group] of Object.entries(TOOL_GROUPS)) {
    toolGroup[key] = toolRegistry.getToolNamesByGroup(group).some((name) => toolNamesSet.has(name))
  }

  const language = ctx.language === 'zh' ? 'zh' : 'en'
  const team = deriveTeam(ctx)

  const scope: Record<string, unknown> = {
    role: ctx.role,
    isMain: ctx.role === 'main',
    isWorker: ctx.role === 'worker',
    language,
    isZh: language === 'zh',
    isEn: language === 'en',
    languageLabel: language === 'zh' ? 'Chinese' : 'English',
    env,
    workingFolder: ctx.workingFolder,
    tool,
    toolGroup,
    memory: ctx.memory,
    team,
    userRules: ctx.userRules,
    skills: ctx.skills ?? [],
    worker: {
      task: deriveWorkerTask(ctx),
      instructions: ctx.workerInstructions?.trim() || undefined,
      teamName: ctx.teamName,
      memberName: ctx.memberName,
      permissionMode: ctx.permissionMode,
      isPlan: ctx.permissionMode === 'plan'
    }
  }

  return scope
}
