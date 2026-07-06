import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`## Working Folder
\`{{workingFolder}}\`
All relative paths resolve against this folder{{#if env.isSsh}} (remote){{/if}}. Use it as the default cwd for terminal commands run via {{tool.Bash}}.`)

export const workingFolderSection: PromptSection = {
  id: 'working-folder',
  when: (ctx) => Boolean(ctx.workingFolder),
  build: (ctx) => T(ctx)
}
