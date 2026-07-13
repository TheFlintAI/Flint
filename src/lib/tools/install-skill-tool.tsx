import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import type { ToolHandler } from './tool-types'
import type { ToolPanelContext } from './tool-render-types'
import { toolRegistry } from '../agent/tool-registry'
import { encodeToolError } from './tool-result-format'
import { createLogger } from '@/lib/logger'
import { useSkillsStore } from '@/stores/skills-store'
import { refreshDynamicToolCatalog } from './dynamic-tool-catalog'

const log = createLogger('InstallSkill')

function InstallSkillInline({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isProcessing = ctx.status === 'streaming' || ctx.status === 'running'
  const skillName =
    (ctx.input?.name as string) ||
    (ctx.input?.sourcePath as string)?.split(/[/\\]/).pop() ||
    ''
  const elapsed =
    ctx.startedAt && ctx.completedAt
      ? `${((ctx.completedAt - ctx.startedAt) / 1000).toFixed(1)}s`
      : null

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground">
      <Download className="size-3.5 shrink-0 text-violet-500 dark:text-violet-400" />
      <span className="shrink-0 font-medium text-foreground/80">
        {isProcessing
          ? t('toolCall.installingSkill', { name: skillName })
          : t('toolCall.skillInstalled', { name: skillName })}
      </span>
      {elapsed ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">{elapsed}</span>
      ) : null}
      {ctx.error ? (
        <span className="shrink-0 text-[10px] text-destructive">{ctx.error}</span>
      ) : null}
    </div>
  )
}

const installSkillHandler: ToolHandler = {
  definition: {
    name: 'InstallSkill',
    description: `Install a skill from a local folder into Flint's user skills directory (~/.flint/skills/). The folder must contain a SKILL.md file. After installation, the skill becomes available for use via the Skill tool and will persist across sessions.

Use this tool when:
- The user asks you to install a skill from a specific folder
- The user wants to add a new custom skill to Flint
- You've created a new skill definition in a folder and want to register it with Flint

The folder name becomes the skill name. If a skill with the same name already exists, it will be overwritten.`,
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'The absolute path to the folder containing the skill to install. The folder must contain a SKILL.md file with valid frontmatter (name, description).'
        }
      },
      required: ['sourcePath']
    }
  },
  execute: async (input, ctx) => {
    const sourcePath = (input.sourcePath as string)?.trim()
    if (!sourcePath) {
      return encodeToolError('sourcePath is required')
    }
    try {
      // Validate the folder first by previewing it
      let preview: { name: string; description: string; content: string }
      try {
        preview = await ctx.commands.invoke<{
          name: string
          description: string
          content: string
        }>('skills:preview', { sourcePath })
      } catch (err) {
        return encodeToolError(
          `Cannot read folder "${sourcePath}": ${err instanceof Error ? err.message : String(err)}`
        )
      }

      if (!preview.content) {
        return encodeToolError(
          `No SKILL.md found in "${sourcePath}". The folder must contain a SKILL.md file with valid skill frontmatter.`
        )
      }

      // Install the skill by copying to ~/.flint/skills/<name>/
      const result = await ctx.commands.invoke<{ success: boolean; name: string }>(
        'skills:add-from-folder',
        { sourcePath }
      )

      if (result?.success) {
        log.info(`Skill "${result.name}" installed from "${sourcePath}"`)

        // Refresh the skills store and tool catalog so the new skill appears
        // immediately in the input area badges and becomes available to the LLM.
        await useSkillsStore.getState().loadSkills()
        await refreshDynamicToolCatalog()

        return `Skill "${result.name}" installed successfully.\n\nLocation: ~/.flint/skills/${result.name}/\nDescription: ${preview.description || '(none)'}`
      }

      return encodeToolError(`Failed to install skill from "${sourcePath}".`)
    } catch (err) {
      log.error(`InstallSkill failed:`, err)
      return encodeToolError(err instanceof Error ? err.message : String(err))
    }
  },
  render: { kind: 'native-inline', render: (ctx) => <InstallSkillInline ctx={ctx} /> },
}

export function registerInstallSkillTools(): void {
  toolRegistry.add(installSkillHandler)
}

export const installSkillToolModule: import('./tool-module').ToolModule = {
  register: registerInstallSkillTools,
}
