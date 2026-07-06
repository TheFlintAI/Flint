import type { ToolContext } from '../tool-types'

/** Browser-like UA maximizes site compatibility for both search and fetch. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const SEARCH_TIMEOUT_MS = 8000
export const FETCH_TIMEOUT_MS = 20000

/** Maximum content length per search result snippet (characters). */
export const MAX_SNIPPET_LENGTH = 500

/** Maximum content length for WebFetch responses (characters). */
export const MAX_FETCH_CONTENT_LENGTH = 30000

/** Maximum number of search results allowed. */
export const MAX_RESULTS_CAP = 20

/** Default number of search results. */
export const DEFAULT_MAX_RESULTS = 10

/** TTL for the last known-good backend cache (5 minutes). */
export const PREFERRED_BACKEND_TTL_MS = 5 * 60 * 1000

export interface ApiResponse {
  success: boolean
  statusCode: number
  headers: Record<string, string>
  body: string
}

export interface SearchResult {
  title: string
  url: string
  content: string
  engine: string
}

export interface SearchBackend {
  name: string
  search(query: string, maxResults: number, ctx: ToolContext): Promise<SearchResult[]>
}

export interface FetchResult {
  content: string
  contentType: string
  statusCode: number
  engine: string
}

/** Internal parsed search result before normalization. */
export interface ParsedResult {
  title: string
  url: string
  snippet: string
}

export interface HttpGetOptions {
  headers: Record<string, string>
  timeoutMs: number
  /** Accept invalid TLS certs. Defaults to false. */
  allowInsecureTls?: boolean
}

export interface SearchAttempt {
  backend: string
  error: string
}
