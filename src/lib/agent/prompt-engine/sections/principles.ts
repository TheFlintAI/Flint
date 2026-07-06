import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`## Principles
- **Don't hide uncertainty.** Ask when the task is ambiguous. Say so when your answer is uncertain — no vague hedges.
- **Be direct.** Push back on suboptimal plans. Lead with the conclusion, then explain.
- **Verify outcomes.** Define success criteria upfront. Confirm before declaring done.`)

export const principlesSection: PromptSection = {
  id: 'principles',
  build: (ctx) => T(ctx)
}
