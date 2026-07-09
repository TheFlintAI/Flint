import type { ToolDefinition } from '../api/types'
import type { MemoryIndexSnapshot } from '@/protocols/memory-types'
import { buildMemoryContext } from './dynamic-context'
import { toolRegistry } from './tool-registry'
import type { ActiveTeam } from '@/stores/team-store'
import { promptRegistry } from './prompt-engine'
import type { SectionContext, EnvironmentContext, WorkerTaskInfo, MemoryPromptData, SkillPromptData } from './prompt-engine/types'
import { listSkills, scanWorkspaceSkills, mergeSkills } from '@/lib/resources/resource-manager'

// Skills loading

/** Load enabled skills, merging global + workspace (workspace overrides global by name). */
async function loadEnabledSkills(workingFolder?: string): Promise<SkillPromptData[]> {
  const globalSkills = await listSkills()
  const workspaceSkills = workingFolder
    ? await scanWorkspaceSkills(workingFolder)
    : []
  const allSkills = mergeSkills(globalSkills, workspaceSkills)
  return allSkills
    .filter(s => s.enabled)
    .map(s => ({ name: s.name, description: s.description }))
}

// Environment resolution

/** Detect the local platform without the deprecated `navigator.platform`. */
function detectLocalPlatform(): string {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const raw = (uaData?.platform ?? navigator.platform ?? 'unknown')
  if (raw.startsWith('Win')) return 'Windows'
  if (raw.startsWith('Mac')) return 'macOS'
  if (raw.startsWith('Linux')) return 'Linux'
  return raw
}

function resolveLocalShellLabel(operatingSystem: string): string {
  if (operatingSystem === 'Windows') return 'cmd.exe'
  if (operatingSystem === 'macOS' || operatingSystem === 'Linux') return '/bin/sh'
  return 'system shell'
}

export function resolveEnvironmentContext(options: {
  sshConnectionId?: string | null
  workingFolder?: string
  sshConnection?: {
    name?: string | null
    host?: string | null
    defaultDirectory?: string | null
  } | null
}): EnvironmentContext {
  const { sshConnectionId, workingFolder, sshConnection } = options

  const localOperatingSystem = detectLocalPlatform()
  const localShell = resolveLocalShellLabel(localOperatingSystem)
  if (!sshConnectionId) {
    return {
      target: 'local',
      operatingSystem: localOperatingSystem,
      shell: localShell
    }
  }

  const pathHint =
    workingFolder?.trim() ||
    sshConnection?.defaultDirectory?.trim() ||
    sshConnection?.host?.trim() ||
    ''
  const pathStyle: EnvironmentContext['pathStyle'] = /^[A-Za-z]:[\\/]/.test(pathHint)
    ? 'windows'
    : pathHint.startsWith('/') || pathHint.startsWith('~')
      ? 'posix'
      : 'unknown'

  return {
    target: 'ssh',
    operatingSystem:
      pathStyle === 'windows'
        ? 'Remote Windows host (via SSH)'
        : pathStyle === 'posix'
          ? 'Remote POSIX host (via SSH)'
          : 'Remote host via SSH',
    shell:
      pathStyle === 'windows'
        ? 'Remote shell via SSH (likely PowerShell or cmd)'
        : 'Remote shell via SSH (prefer POSIX-style commands unless evidence shows otherwise)',
    host: sshConnection?.host?.trim() || undefined,
    connectionName: sshConnection?.name?.trim() || undefined,
    pathStyle
  }
}

// Section context builder (shared)

interface SharedSectionInputs {
  workingFolder?: string
  userRules?: string
  toolNames: string[]
  language?: string
  environmentContext: EnvironmentContext
  memory: MemoryPromptData | null
  skills: SkillPromptData[]
}

function buildSharedContext(inputs: SharedSectionInputs): SectionContext {
  return {
    role: 'main',
    workingFolder: inputs.workingFolder,
    userRules: inputs.userRules,
    toolNames: inputs.toolNames,
    language: inputs.language,
    environmentContext: inputs.environmentContext,
    memory: inputs.memory,
    skills: inputs.skills,
    hasActiveTeam: false,
    activeTeam: null,
    workerTask: null,
    workerInstructions: undefined,
    teamName: undefined,
    memberName: undefined,
    permissionMode: undefined
  }
}

function resolveMemoryContext(snapshot?: MemoryIndexSnapshot | null): MemoryPromptData | null {
  return snapshot ? buildMemoryContext(snapshot) : null
}

// Public API

export async function buildAgentSystemPrompt(options: {
  workingFolder?: string
  taskId?: string
  userRules?: string
  toolDefs?: ToolDefinition[]
  language?: string
  hasActiveTeam?: boolean
  activeTeam?: ActiveTeam | null
  memorySnapshot?: MemoryIndexSnapshot
  environmentContext?: EnvironmentContext
}): Promise<string> {
  const toolDefs = options.toolDefs ?? toolRegistry.getDefinitions()
  const toolNames = toolDefs.map(t => t.name)
  const env = options.environmentContext ?? resolveEnvironmentContext({})
  const memory = resolveMemoryContext(options.memorySnapshot)

  const skills = await loadEnabledSkills(options.workingFolder)

  const ctx: SectionContext = {
    ...buildSharedContext({
      workingFolder: options.workingFolder,
      userRules: options.userRules,
      toolNames,
      language: options.language,
      environmentContext: env,
      memory,
      skills
    }),
    role: 'main',
    taskId: options.taskId,
    hasActiveTeam: options.hasActiveTeam ?? false,
    activeTeam: (options.activeTeam as Record<string, unknown> | null | undefined) ?? null
  }

  return promptRegistry.buildAll(ctx).join('\n\n')
}

export async function buildWorkerSystemPrompt(options: {
  workingFolder?: string
  language?: string
  environmentContext?: EnvironmentContext
  userRules?: string
  memorySnapshot?: MemoryIndexSnapshot | null
  toolDefs?: ToolDefinition[]
  workerTask?: WorkerTaskInfo | null
  workerInstructions?: string
  teamName?: string
  memberName?: string
  permissionMode?: string
}): Promise<string> {
  const toolDefs = options.toolDefs ?? toolRegistry.getDefinitions()
  const toolNames = toolDefs.map(t => t.name)
  const env = options.environmentContext ?? resolveEnvironmentContext({ workingFolder: options.workingFolder })
  const memory = resolveMemoryContext(options.memorySnapshot)

  const skills = await loadEnabledSkills(options.workingFolder)

  const ctx: SectionContext = {
    ...buildSharedContext({
      workingFolder: options.workingFolder,
      userRules: options.userRules,
      toolNames,
      language: options.language,
      environmentContext: env,
      memory,
      skills
    }),
    role: 'worker',
    workerTask: options.workerTask ?? null,
    workerInstructions: options.workerInstructions,
    teamName: options.teamName,
    memberName: options.memberName,
    permissionMode: options.permissionMode
  }

  return promptRegistry.buildAll(ctx).join('\n\n')
}

export function buildFallbackReportPrompt(): string {
  const langInstruction = 'Respond in the same language the task was given in. Output the report body only - do NOT call any tools, do NOT ask clarifying questions, do NOT add preamble like "Here is the report". Just the report.'

  return [
    'Your previous turn ended without a `CompleteWork` call. Your caller has no way to see what you did. Now, based on everything you executed in this conversation (tool calls, findings, analysis, attempts, and failures), write a detailed work report. The report MUST include:',
    '1. What you were asked to do and your interpretation of the task.',
    '2. The concrete steps you took, in order, with the key evidence you gathered from each tool call.',
    '3. Your findings, conclusions, or the artifacts you produced (paste or quote the important parts directly).',
    '4. Anything you could NOT finish, and the reason (blocker, missing info, unclear scope, etc.).',
    '5. Concrete next steps or recommendations for the caller.',
    '',
    langInstruction
  ].join('\n')
}
