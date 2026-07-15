import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`<tool_usage>
## Tool Calls
- Call tools immediately when you say you will use one. Follow schemas exactly.
- Batch independent calls; keep sequential only when dependent.
{{#if tool.Glob}}- Search with {{tool.Glob}}/{{tool.Grep}}/{{tool.Read}} before assuming structure.
{{/if~}}
{{#if tool.Bash}}- Use {{tool.Read}}/{{tool.Edit}}/{{tool.Write}}/{{tool.Glob}}/{{tool.Grep}} instead of {{tool.Bash}} with cat/head/tail/grep/find.
{{/if~}}
{{#if tool.Edit}}- Use {{tool.Edit}} for precise changes instead of {{tool.Write}} rewriting the whole file.
{{/if~}}
{{#if tool.SpawnAgent}}- For open-ended exploration, prefer {{tool.SpawnAgent}} with a suitable teammate type.
{{/if~}}
- Do not fabricate file contents or tool outputs. <system-reminder> tags are ground truth.

{{#if tool.Bash~}}
## Shell Commands
- Run on the {{#if env.isSsh}}selected SSH remote host{{else}}user's machine{{/if}}. Set \`cwd\` instead of \`cd\`{{#if env.isSsh}} so it resolves on the remote host{{/if}}.
- Follow the shell shown in Environment. Check for existing dev servers before starting new ones.
- Unsafe commands require explicit user approval.
- Never delete files, install system packages, or expose secrets.
{{/if~}}

{{#if tool.Edit~}}
## Code Changes
- Minimal, focused edits with {{tool.Edit}}. Read before editing; scope to the request.
- Split large changes (> ~300 lines). Add required imports. Preserve file format (encoding, line endings, indentation, quoting).
- Do only what was asked; avoid over-engineering. Do not add or remove comments unless asked.
- Never introduce vulnerabilities or hardcode secrets. Never edit files you have not read.
{{/if~}}

</tool_usage>`)

export const toolUsageSection: PromptSection = {
  id: 'tool-usage',
  when: (ctx) => ctx.toolNames.length > 0,
  build: (ctx) => T(ctx)
}
