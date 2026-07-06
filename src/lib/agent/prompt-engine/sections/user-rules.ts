import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`<user_rules>
The following user-defined rules take precedence over all other instructions. Follow them without exception.
{{userRules}}
</user_rules>`)

export const userRulesSection: PromptSection = {
  id: 'user-rules',
  when: (ctx) => Boolean(ctx.userRules?.trim()),
  build: (ctx) => T(ctx)
}
