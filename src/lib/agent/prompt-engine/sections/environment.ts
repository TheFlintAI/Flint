import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`## Environment
- Execution Target: {{#if env.isSsh}}SSH Remote Host{{#if env.host}} ({{env.host}}){{/if}}{{else}}Local Machine{{/if}}
{{#if env.connectionName}}- SSH Connection: {{env.connectionName}}
{{/if~}}
- Operating System: {{env.operatingSystem}}
- Shell: {{env.shell}}
{{#if env.isSsh~}}
- Filesystem Scope: Remote filesystem over SSH
{{#if eq env.pathStyle "posix"}}- Path Style: Prefer POSIX-style paths unless evidence suggests otherwise
{{/if~}}
{{#if eq env.pathStyle "windows"}}- Path Style: Prefer Windows-style paths on the remote host
{{/if~}}
- Remote Guidance: Do not assume the local computer's OS, shell, paths, or home directory when SSH is active.
{{/if~}}`)

export const environmentSection: PromptSection = {
  id: 'environment',
  build: (ctx) => T(ctx)
}
