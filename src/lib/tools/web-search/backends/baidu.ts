import type { ToolContext } from '../../tool-types'
import { httpGet } from '../http'
import { parseHtml } from '../html-utils'
import {
  BROWSER_USER_AGENT,
  SEARCH_TIMEOUT_MS,
  MAX_SNIPPET_LENGTH,
  type ParsedResult,
  type SearchBackend,
  type SearchResult
} from '../types'

/**
 * Baidu HTML search — mainland-China-native fallback.
 * Each result container carries the real target URL in its `mu` attribute;
 * the title sits in `.result h3 a` and the snippet in `.c-abstract`.
 */
function parseBaiduResults(html: string): ParsedResult[] {
  const doc = parseHtml(html)
  // Baidu marks result blocks with class "result" (and "c-container").
  const blocks = Array.from(doc.querySelectorAll('.result, .c-container'))
  const results: ParsedResult[] = []

  for (const block of blocks) {
    const anchor = block.querySelector('h3 a') ?? block.querySelector('a')
    if (!anchor) continue

    // Prefer the real URL exposed via the `mu` attribute on the container.
    const mu = block.getAttribute('mu')
    const href = anchor.getAttribute('href') ?? ''
    const url = mu || href
    if (!url) continue

    const title = (anchor.textContent ?? '').trim()
    const snippetEl = block.querySelector('.c-abstract')
    const snippet = (snippetEl?.textContent ?? '').trim()

    results.push({ title, url, snippet })
  }

  return results
}

export const baiduBackend: SearchBackend = {
  name: 'baidu',
  async search(
    query: string,
    maxResults: number,
    ctx: ToolContext
  ): Promise<SearchResult[]> {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`
    const response = await httpGet(ctx, url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      timeoutMs: SEARCH_TIMEOUT_MS
    })

    if (!response.success || response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode}`)
    }

    const parsed = parseBaiduResults(response.body ?? '')
    if (parsed.length === 0) throw new Error('no results parsed')

    return parsed
      .filter((r) => r.url)
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title,
        url: r.url,
        content: r.snippet.slice(0, MAX_SNIPPET_LENGTH),
        engine: 'baidu'
      }))
  }
}
