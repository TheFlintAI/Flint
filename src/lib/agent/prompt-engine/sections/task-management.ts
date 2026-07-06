import type { PromptSection } from '../types'
import { tpl, hasToolGroup } from '../section-helpers'

const T = tpl(`<task_management>
Use Task tools for complex requests (3+ steps or multiple files).
- Check existing tasks in any <system-reminder> before creating new ones.
- Create tasks with {{tool.TaskCreate}} before starting complex work.
- Mark {{tool.TaskUpdate}} in_progress/completed; never mark completed unless fully done.
- Use {{tool.TaskList}}/{{tool.TaskGet}} to inspect tasks as needed.
</task_management>`)

export const taskManagementSection: PromptSection = {
  id: 'task-management',
  roles: ['main'],
  when: (ctx) => hasToolGroup(ctx, 'task-management'),
  build: (ctx) => T(ctx)
}
