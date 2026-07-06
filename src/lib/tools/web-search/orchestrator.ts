import { createLogger } from '@/lib/logger'
import type { ToolContext } from '../tool-types'
import { encodeStructuredToolResult, encodeToolError } from '../tool-result-format'
import {
  PREFERRED_BACKEND_TTL_MS,
  type SearchAttempt,
  type SearchBackend,
  type SearchResult
} from './types'
import { bingBackend } from './backends/bing'
import { duckduckgoBackend } from './backends/duckduckgo'
import { baiduBackend } from './backends/baidu'

const log = createLogger('WebSearch')

/**
 * Default backend priority. Bing leads because it is reachable in both
 * mainland China and abroad; DuckDuckGo covers offshore, Baidu covers
 * China-native environments.
 */
const DEFAULT_ORDER: SearchBackend[] = [bingBackend, duckduckgoBackend, baiduBackend]

/** Last known-good backend cache; subsequent searches try it first. */
let preferred: { name: string; ts: number } | null = null

function orderedBackends(): SearchBackend[] {
  if (!preferred) return DEFAULT_ORDER
  if (Date.now() - preferred.ts > PREFERRED_BACKEND_TTL_MS) {
    preferred = null
    return DEFAULT_ORDER
  }
  const head = DEFAULT_ORDER.find((b) => b.name === preferred!.name)
  if (!head) return DEFAULT_ORDER
  return [head, ...DEFAULT_ORDER.filter((b) => b.name !== head.name)]
}

function markPreferred(name: string): void {
  preferred = { name, ts: Date.now() }
}

/**
 * Run a query across backends in priority order, returning the first
 * non-empty result set. Failures (network, anti-bot, empty) fall through
 * to the next backend; every attempt is logged.
 */
export async function runSearch(
  query: string,
  maxResults: number,
  ctx: ToolContext
): Promise<{ results: SearchResult[]; engine: string } | { error: string }> {
  const backends = orderedBackends()
  const attempts: SearchAttempt[] = []

  for (const backend of backends) {
    try {
      const results = await backend.search(query, maxResults, ctx)
      if (results.length === 0) {
        attempts.push({ backend: backend.name, error: 'empty' })
        log.warn(`backend ${backend.name} returned no results`)
        continue
      }
      markPreferred(backend.name)
      log.info(`backend ${backend.name} succeeded: ${results.length} results`)
      return { results, engine: backend.name }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      attempts.push({ backend: backend.name, error })
      log.warn(`backend ${backend.name} failed: ${error}`)
    }
  }

  const summary = attempts.map((a) => `${a.backend}(${a.error})`).join(', ')
  return { error: `all search backends failed: ${summary}` }
}

/** Encode a successful search payload for the agent. */
export function encodeSearchResult(
  results: SearchResult[],
  query: string,
  engine: string
): string {
  return encodeStructuredToolResult({
    results,
    query,
    resultCount: results.length,
    totalResults: results.length,
    engine
  })
}

export { encodeToolError }
