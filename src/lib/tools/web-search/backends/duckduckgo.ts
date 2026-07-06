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

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/'

/** Markers that indicate DuckDuckGo returned an anti-bot / anomaly page. */
const ANOMALY_MARKERS = ['anomaly', 'unusual traffic', 'If this error persists']

/**
 * Decode the real target URL from a DuckDuckGo redirect href.
 * Redirects look like `//duckduckgo.com/l/?uddg=<encoded>&rut=...`.
 * Falls back to the raw href when it is already a direct URL.
 */
function extractRealUrl(href: string): string {
  try {
    const normalized = href.startsWith('//') ? `https:${href}` : href
    const parsed = new URL(normalized)
    const uddg = parsed.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : normalized
  } catch {
    return href
  }
}

/**
 * Parse DuckDuckGo HTML results. Each result exposes `.result__a`
 * (title + redirect href) paired with the nearest `.result__snippet`.
 */
function parseDuckDuckGoResults(html: string): ParsedResult[] {
  const doc = parseHtml(html)
  const blocks = Array.from(doc.querySelectorAll('.result'))
  const results: ParsedResult[] = []

  for (const block of blocks) {
    const anchor = block.querySelector('.result__a')
    if (!anchor) continue

    const href = anchor.getAttribute('href') ?? ''
    const url = extractRealUrl(href)
    if (!url) continue

    const title = (anchor.textContent ?? '').trim()
    const snippetEl = block.querySelector('.result__snippet')
    const snippet = (snippetEl?.textContent ?? '').trim()

    results.push({ title, url, snippet })
  }

  return results
}

/** Returns true when the page looks like a DuckDuckGo anti-bot anomaly response. */
function isAnomalyPage(html: string, resultCount: number): boolean {
  if (resultCount > 0) return false
  const lower = html.toLowerCase()
  return ANOMALY_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))
}

export const duckduckgoBackend: SearchBackend = {
  name: 'duckduckgo',
  async search(
    query: string,
    maxResults: number,
    ctx: ToolContext
  ): Promise<SearchResult[]> {
    const url = `${DDG_HTML_ENDPOINT}?q=${encodeURIComponent(query)}`
    const response = await httpGet(ctx, url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeoutMs: SEARCH_TIMEOUT_MS
    })

    if (!response.success || response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode}`)
    }

    const body = response.body ?? ''
    const parsed = parseDuckDuckGoResults(body)
    if (isAnomalyPage(body, parsed.length)) {
      throw new Error('anti-bot anomaly page')
    }
    if (parsed.length === 0) throw new Error('no results parsed')

    return parsed
      .filter((r) => r.url)
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title,
        url: r.url,
        content: r.snippet.slice(0, MAX_SNIPPET_LENGTH),
        engine: 'duckduckgo'
      }))
  }
}
