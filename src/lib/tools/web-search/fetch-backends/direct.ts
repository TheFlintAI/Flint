import Defuddle from 'defuddle'
import type { ToolContext } from '../../tool-types'
import { httpGet } from '../http'
import { parseHtml } from '../html-utils'
import {
  BROWSER_USER_AGENT,
  FETCH_TIMEOUT_MS,
  MAX_FETCH_CONTENT_LENGTH,
  type FetchResult
} from '../types'

/**
 * Fetch a URL and extract its main content as markdown via Defuddle, locally
 * in the webview. Throws on HTTP errors or when extraction yields no usable
 * content — the caller surfaces this as a hard error (no fallback).
 */
export async function fetchDirect(url: string, ctx: ToolContext): Promise<FetchResult> {
  const response = await httpGet(ctx, url, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,text/plain,application/json,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeoutMs: FETCH_TIMEOUT_MS
  })

  if (!response.success || response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}`)
  }

  const contentType = response.headers['content-type'] ?? ''
  const body = response.body ?? ''

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body)
      const content = JSON.stringify(parsed, null, 2).slice(0, MAX_FETCH_CONTENT_LENGTH)
      if (content.trim()) {
        return { content, contentType, statusCode: response.statusCode, engine: 'direct' }
      }
    } catch {
      // Fall through to HTML extraction
    }
  }

  const isHtml = contentType.includes('text/html') || body.trimStart().startsWith('<')
  if (isHtml) {
    const doc = parseHtml(body)
    const result = new Defuddle(doc, { markdown: true, url }).parse()
    const title = result.title.trim()
    const markdown = `${title ? `# ${title}\n\n` : ''}${result.content ?? ''}`.slice(
      0,
      MAX_FETCH_CONTENT_LENGTH
    )
    if (!markdown.trim()) throw new Error('empty content after extraction')
    return {
      content: markdown,
      contentType: 'text/markdown',
      statusCode: response.statusCode,
      engine: 'direct'
    }
  }

  const content = body.slice(0, MAX_FETCH_CONTENT_LENGTH)
  if (!content.trim()) throw new Error('empty body')
  return { content, contentType, statusCode: response.statusCode, engine: 'direct' }
}
