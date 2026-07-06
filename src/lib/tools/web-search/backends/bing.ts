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
 * Bing HTML search. Reachable in both mainland China and abroad, with good
 * Chinese-language result quality — used as the default-first backend.
 * Organic results live in `li.b_algo` with the title in `h2 > a`.
 *
 * Bing wraps every result link in a `bing.com/ck/a` click-tracking redirect
 * that returns HTTP 204 with no body when fetched server-side, so the anchor
 * href is useless to WebFetch. The real target URL is encoded in that
 * redirect's `u=` parameter as a fixed 2-char type prefix (e.g. `a1`)
 * followed by URL-safe base64 of the fully percent-encoded target URL. We
 * decode that to recover a fetchable URL; any block that fails to decode is
 * skipped, and if all blocks fail the backend throws so the orchestrator
 * falls back to the next search engine.
 */

/** URL-safe base64 decode to a UTF-8 string. */
function decodeBase64Url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

/** Recover the real target URL from a `bing.com/ck/a` redirect href. */
function decodeBingRedirect(href: string): string | null {
  let u: string
  try {
    u = new URL(href.startsWith('//') ? `https:${href}` : href).searchParams.get('u') ?? ''
  } catch {
    return null
  }
  if (u.length < 2) return null

  const decoded = decodeBase64Url(u.slice(2))
  return /^https?:\/\//i.test(decoded) ? decoded : null
}

function parseBingResults(html: string): ParsedResult[] {
  const doc = parseHtml(html)
  const blocks = Array.from(doc.querySelectorAll('li.b_algo'))
  const results: ParsedResult[] = []

  for (const block of blocks) {
    const anchor = block.querySelector('h2 a') ?? block.querySelector('a')
    if (!anchor) continue

    const url = decodeBingRedirect(anchor.getAttribute('href') ?? '')
    if (!url) continue

    const title = (anchor.textContent ?? '').trim()
    // Bing places snippets in `.b_caption p` or any <p> inside the block.
    const snippetEl = block.querySelector('.b_caption p') ?? block.querySelector('p')
    const snippet = (snippetEl?.textContent ?? '').trim()

    results.push({ title, url, snippet })
  }

  return results
}

export const bingBackend: SearchBackend = {
  name: 'bing',
  async search(
    query: string,
    maxResults: number,
    ctx: ToolContext
  ): Promise<SearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`
    const response = await httpGet(ctx, url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeoutMs: SEARCH_TIMEOUT_MS
    })

    if (!response.success || response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode}`)
    }

    const parsed = parseBingResults(response.body ?? '')
    if (parsed.length === 0) throw new Error('no results parsed')

    return parsed.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.snippet.slice(0, MAX_SNIPPET_LENGTH),
      engine: 'bing'
    }))
  }
}
