import { createLogger } from '@/lib/logger'
import type { ToolContext } from '../tool-types'
import { encodeStructuredToolResult } from '../tool-result-format'
import type { FetchResult } from './types'
import { fetchDirect } from './fetch-backends/direct'

const log = createLogger('WebFetch')

/** Fetch a single URL; any failure is surfaced as a hard error (no fallback). */
export async function runFetch(
  url: string,
  ctx: ToolContext
): Promise<{ result: FetchResult } | { error: string }> {
  try {
    const result = await fetchDirect(url, ctx)
    log.info(`fetched ${url} (${result.content.length} chars)`)
    return { result }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.warn(`fetch failed: ${error}`)
    return { error }
  }
}

/** Encode a successful fetch payload for the agent. */
export function encodeFetchResult(url: string, result: FetchResult): string {
  return encodeStructuredToolResult({
    url,
    content: result.content,
    contentType: result.contentType,
    statusCode: result.statusCode,
    engine: result.engine
  })
}
