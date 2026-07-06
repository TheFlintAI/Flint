import type { ToolContext } from '../tool-types'
import type { ApiResponse, HttpGetOptions } from './types'

/**
 * Issue an HTTP GET via the Rust backend (`api:request`).
 *
 * Proxy auto-detection is handled by reqwest (enabled via the `system-proxy`
 * Cargo feature). On Windows the registry is read, on macOS the
 * SystemConfiguration framework. `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`
 * env vars are also honoured. When no proxy is configured reqwest connects
 * directly and the orchestrator handles failures via backend fallback.
 */
export async function httpGet(
  ctx: ToolContext,
  url: string,
  opts: HttpGetOptions
): Promise<ApiResponse> {
  return (await ctx.commands.invoke('api:request', {
    url,
    method: 'GET',
    headers: opts.headers,
    timeoutMs: opts.timeoutMs,
    allowInsecureTls: opts.allowInsecureTls ?? false
  })) as ApiResponse
}
