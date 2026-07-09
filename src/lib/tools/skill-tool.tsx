import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import type { ToolHandler } from './tool-types'
import type { ToolPanelContext } from './tool-render-types'
import { toolRegistry } from '../agent/tool-registry'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { encodeToolError } from './tool-result-format'
import { createLogger } from '@/lib/logger'
import type { SkillInfo } from '@/lib/resources/resource-manager'
import { scanWorkspaceSkills, mergeSkills } from '@/lib/resources/resource-manager'
import { getSkillNameFromInput } from '@/components/chat/tool-panel/utils'

const log = createLogger('Skills')

let registeredSkills: SkillInfo[] = []
let registeredSkillSignature = ''

function normalizeSkills(skills: SkillInfo[]): SkillInfo[] {
  return skills
    .map((skill) => ({
      name: String(skill.name ?? '').trim(),
      description: String(skill.description ?? '').trim(),
      enabled: skill.enabled !== false
    }))
    .filter((skill) => skill.name)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

function buildSkillSignature(skills: SkillInfo[]): string {
  return JSON.stringify({ skills })
}

async function loadRegisteredSkills(workspace?: string): Promise<SkillInfo[] | null> {
  try {
    const globalSkills = await tauriCommands.invoke<SkillInfo[]>('skills:list')
    const base = Array.isArray(globalSkills) ? globalSkills : []
    if (!workspace) return base
    const wsSkills = await scanWorkspaceSkills(workspace)
    return mergeSkills(base, wsSkills)
  } catch (err) {
    log.error('Failed to load skills from TAURI_COMMANDS:', err)
    return null
  }
}

export async function refreshSkillTools(workspace?: string): Promise<void> {
  const nextSkills = await loadRegisteredSkills(workspace)
  if (!nextSkills) {
    if (!toolRegistry.has('Skill')) {
      toolRegistry.add(createSkillHandler())
    }
    return
  }

  const normalizedSkills = normalizeSkills(nextSkills)
  const nextSignature = buildSkillSignature(normalizedSkills)
  if (nextSignature === registeredSkillSignature && toolRegistry.has('Skill')) return

  registeredSkills = normalizedSkills
  registeredSkillSignature = nextSignature
  toolRegistry.add(createSkillHandler())
}

function buildSkillDescription(): string {
  const enabledSkills = registeredSkills.filter((s) => s.enabled)
  const disabledCount = registeredSkills.length - enabledSkills.length

  const skillList = enabledSkills.length > 0
    ? [
        '',
        'Available skills:',
        ...enabledSkills.map((skill) => `- ${skill.name}: ${skill.description}`)
      ].join('\n')
    : '\n\nNo skills are currently available.'

  const disabledNote = disabledCount > 0
    ? `\n\n${disabledCount} skill(s) are installed but disabled.`
    : ''

  return `Load a skill by name to get detailed instructions or domain knowledge for a specialized task. Returns the full content of the skill's SKILL.md file as context.

You have access to **Skills** — curated guides for specific workflows.
Only use the Skill tool when the user's request clearly matches a listed skill, or when the user explicitly asks for a skill.
Do not call Skill for ordinary coding, file editing, searching, debugging, or repository navigation requests unless a listed skill is obviously the best fit.

### How to use Skills
1. **Match carefully**: Use a skill only when the request clearly aligns with one of the available skills in the task context.
2. **Load first when relevant**: If a listed skill is clearly applicable, call the Skill tool before other tools.
3. **Read carefully**: After loading, read the Skill's content thoroughly before taking any action.
4. **Follow strictly**: Execute the Skill's instructions step-by-step. Do NOT skip steps, reorder them, or substitute your own approach.
5. **Retry on failure**: If a Skill's script fails, fix the issue and re-run the same script command when appropriate.${skillList}${disabledNote}`
}

function SkillInline({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isProcessing = ctx.status === 'streaming' || ctx.status === 'running'
  const skillName = getSkillNameFromInput(ctx.input)
  const elapsed =
    ctx.startedAt && ctx.completedAt
      ? `${((ctx.completedAt - ctx.startedAt) / 1000).toFixed(1)}s`
      : null

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground">
      <FileText className="size-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
      <span className="shrink-0 font-medium text-foreground/80">
        {isProcessing ? t('toolCall.skillLoading') : t('toolCall.skillUsed')}
      </span>
      {skillName ? (
        <span
          className="min-w-0 truncate rounded-full border border-emerald-500/15 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
          title={skillName}
        >
          {skillName}
        </span>
      ) : null}
      {elapsed ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">{elapsed}</span>
      ) : null}
      {ctx.error ? (
        <span className="shrink-0 text-[10px] text-destructive">{ctx.error}</span>
      ) : null}
    </div>
  )
}

function createSkillHandler(): ToolHandler {
  const enabledSkills = registeredSkills.filter((s) => s.enabled)
  const allNames = enabledSkills.map((s) => s.name)

  return {
    definition: {
      name: 'Skill',
      description: buildSkillDescription(),
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the skill to load. Must match one of the available skills.',
            ...(allNames.length > 0 ? { enum: allNames } : {})
          }
        },
        required: ['name']
      }
    },
    execute: async (input, ctx) => {
      const skillName = input.name as string
      if (!skillName) {
        return encodeToolError('name is required')
      }
      try {
        const result = (await ctx.commands.invoke('skills:load', {
          name: skillName,
          ...(ctx.workingFolder ? { workspace: ctx.workingFolder } : {})
        })) as
          | { content: string; workingDirectory: string }
          | { error: string }
        if ('error' in result) {
          return encodeToolError(result.error)
        }
        return `<skill_context>\n<working_directory>${result.workingDirectory}</working_directory>\n<instruction>CRITICAL: When executing any script mentioned in this skill, you MUST prepend the working_directory to form an absolute path. For example, if the skill says "python scripts/foo.py", you must run "python ${result.workingDirectory}/scripts/foo.py". NEVER run scripts using bare relative paths like "python scripts/foo.py" — they will fail because your cwd is not the skill directory.</instruction>\n</skill_context>\n\n${result.content}`
      } catch (err) {
        return encodeToolError(err instanceof Error ? err.message : String(err))
      }
    },
    render: { kind: 'native-inline', render: (ctx) => <SkillInline ctx={ctx} /> },
    formatApprovalSummary: (input) => `Load skill: ${input.name ?? ''}`,
  }
}
