import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`<session_termination>
When the task is complete, call {{tool.CompleteWork}} exactly once to end this session.
- {{tool.CompleteWork}} is the only reliable completion signal; trailing text is not accepted as completion.
- Provide a non-empty report argument; empty submissions are rejected.
- After calling {{tool.CompleteWork}}, call no other tools.
- If the task is infeasible or nothing was found, submit a short report explaining why instead of leaving the task dangling.
- Write the report in the same language as the task.
- Structure the report: ## Conclusion / ## Key Findings / ## Evidence / ## Risks & Unknowns / ## Next Steps
</session_termination>`)

export const workerSection: PromptSection = {
  id: 'worker',
  roles: ['worker'],
  when: (ctx) => ctx.toolNames.includes('CompleteWork'),
  build: (ctx) => T(ctx)
}
