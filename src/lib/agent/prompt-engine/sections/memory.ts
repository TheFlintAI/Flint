import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`{{#if memory.enabled~}}
<memory>
Flint memory store: {{memory.totalCount}} entries in SQLite (~/.flint/memory.db). Cosine-similarity vector search.
Each entry: id, type, title, body.
Use {{tool.MemoryRead}} to load by ID, {{tool.MemorySearch}} for semantic + text search, {{tool.MemoryWrite}} to create/update, {{tool.MemoryDelete}} to remove.
To update an entry, read it first with {{tool.MemoryRead}}, then call {{tool.MemoryWrite}} with the entryId and your changes.
Never store secrets, API keys, credentials, or PII in memory. Reference entry IDs when citing.
</memory>
{{#if memory.entries~}}
<memory_index>
Total entries: {{memory.totalCount}}.{{#if memory.updatedAt}} Updated: {{memory.updatedAt}}.{{/if}}
Format: - title
{{#each memory.entries~}}
- {{this.title}}
{{/each~}}
{{#if memory.hiddenCount}}- ... and {{memory.hiddenCount}} more entries (use {{tool.MemorySearch}} to retrieve them).
{{/if~}}
</memory_index>
{{else~}}
<memory_index>No memory entries exist yet.</memory_index>
{{/if~}}
{{/if~}}`)

export const memorySection: PromptSection = {
  id: 'memory',
  when: (ctx) => ctx.memory != null,
  build: (ctx) => T(ctx)
}
