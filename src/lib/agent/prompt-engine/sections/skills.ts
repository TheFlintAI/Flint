import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`## Available Skills
{{#if skills.length}}
The following skills are available. Use the Skill tool to load one by name when applicable.

{{#each skills}}
- **{{this.name}}**: {{this.description}}
{{/each}}
{{/if}}`)

export const skillsSection: PromptSection = {
  id: 'skills',
  when: (ctx) => ctx.skills && ctx.skills.length > 0,
  build: (ctx) => T(ctx)
}
