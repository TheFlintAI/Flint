import type { PromptSection } from '../types'
import { tpl } from '../section-helpers'

const T = tpl(`## Web Search
- Use {{tool.WebSearch}} to find current information, documentation, or factual answers on the web.
- Use {{tool.WebFetch}} to read the full content of a URL from search results.
- Always cite the source URL when referencing information from web search results.`)

export const webSearchSection: PromptSection = {
  id: 'web-search',
  when: (ctx) => ctx.toolNames.includes('WebSearch'),
  build: (ctx) => T(ctx)
}
