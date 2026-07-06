/**
 * Plugin capability interfaces — shell, filesystem, network, clipboard.
 *
 * Each capability requires the corresponding permission in plugin.toml:
 *   shell     → "shell"
 *   fs        → "fs", "fs:read", or "fs:write"
 *   fetch     → "network"
 *   clipboard → "clipboard", "clipboard:read", or "clipboard:write"
 */

// ── Shell ──────────────────────────────────────────────────────────────────

export interface PluginShell {
  exec(command: string, options?: { cwd?: string }): Promise<{
    code: number
    stdout: string
    stderr: string
  }>
}

// ── Filesystem ─────────────────────────────────────────────────────────────

export interface PluginFS {
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<void>
  list(path: string): Promise<{ name: string; path: string; dir: boolean }[]>
  delete(path: string): Promise<void>
}

// ── Network (fetch) ────────────────────────────────────────────────────────

/** Fetch response — mirrors the web Fetch API's Response interface. */
export interface PluginFetchResponse {
  /** HTTP status code. */
  readonly status: number
  /** Response headers (lowercase keys). */
  readonly headers: Record<string, string>
  /** Decode the response body as text. Uses the encoding requested via
   *  `responseEncoding` in the fetch options; defaults to UTF-8. */
  text(): Promise<string>
  /** Parse the response body as JSON. Rejects if the body is not valid JSON;
   *  resolves to `null` if the body is empty. */
  json<T = unknown>(): Promise<T | null>
}

// ── Clipboard ──────────────────────────────────────────────────────────────

export interface PluginClipboard {
  read(): Promise<string>
  write(text: string): Promise<void>
}
