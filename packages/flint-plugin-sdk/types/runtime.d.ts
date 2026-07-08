/**
 * Plugin runtime — root interfaces.
 *
 * These compose the $plugin global object available inside every plugin.
 */

import type { AgentLifecycleEvent } from './events'
import type { PluginView, PluginUI } from './vnode'
import type { PluginTools } from './tools'
import type { PluginShell, PluginFS, PluginFetchResponse, PluginClipboard } from './capabilities'

// ── Meta ───────────────────────────────────────────────────────────────────

export interface PluginMeta {
  name: string
  version: string
  displayName: Record<string, string>
  icon: string
}

// ── Timer ──────────────────────────────────────────────────────────────────

export interface TimerHandle {
  dispose(): void
}

export interface PluginTimer {
  /** Run `fn` every `ms` milliseconds. Auto-cleaned on deactivate. */
  interval(ms: number, fn: () => void): TimerHandle
  /** Run `fn` once after `ms` milliseconds. Auto-cleaned on deactivate. */
  timeout(ms: number, fn: () => void): TimerHandle
}

// ── Format ─────────────────────────────────────────────────────────────────

export interface PluginFmt {
  /** Fixed-decimal number. Returns "—" for non-finite values. */
  number(value: number, decimals?: number): string
  /** Signed number: "+5.23" or "-1.50". Returns "—" for non-finite. */
  change(value: number, decimals?: number): string
  /** Signed percent: "+5.23%" or "-1.50%". Returns "—" for non-finite. */
  percent(value: number, decimals?: number): string
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

export interface PluginLifecycle {
  onActivate(callback: () => void | Promise<void>): { dispose(): void }
  onDeactivate(callback: () => void | Promise<void>): { dispose(): void }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export interface PluginHook {
  /**
   * Subscribe to agent lifecycle events.
   * Pass '*' to receive all events, or a specific event type like 'tool:start'.
   */
  on(event: string, fn: (data: AgentLifecycleEvent) => void): { dispose(): void }
}

// ── KV (persistent key-value store) ────────────────────────────────────────

export interface PluginKV {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

// ── Config (plugin configuration) ──────────────────────────────────────────

export interface PluginConfig {
  get<T = Record<string, unknown>>(): Promise<T>
  set<T = Record<string, unknown>>(settings: T): Promise<void>
  onChange<T = Record<string, unknown>>(callback: (settings: T) => void): { dispose(): void }
}

// ── State (reactive session store) ─────────────────────────────────────────

export interface PluginStateStore<T extends Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K]
  set<K extends keyof T>(key: K, value: T[K]): void
  /** Batch-write multiple keys. Does NOT trigger UI refresh — call flush() explicitly. */
  patch(partial: Partial<T>): void
  /** Trigger UI re-render. Pass a viewId to refresh only that view; omit to refresh all views. */
  flush(viewId?: string): void
  /** Snapshot the entire state. */
  getAll(): T
  /** Restore all keys from persisted plugin config. */
  load(): Promise<void>
  /** Persist the given keys (or all keys) to plugin config. */
  save(keys?: (keyof T)[]): Promise<void>
}

export interface PluginState {
  define<T extends Record<string, unknown>>(defaults: T): PluginStateStore<T>
}

// ── Log ────────────────────────────────────────────────────────────────────

export interface PluginLog {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

// ── Text ─────────────────────────────────────────────────────────────────

export interface PluginText {
  /**
   * Resolve \\uXXXX Unicode escape sequences to actual Unicode characters.
   *
   * Many Chinese web APIs embed CJK characters as JSON-style Unicode escapes
   * in otherwise non-JSON response formats. Call this on fetched text before
   * parsing to normalize the content.
   *
   * Example:
   *   const raw = await res.text()
   *   const text = $plugin.text.decode(raw)
   *   // Decodes Unicode escape sequences in text (e.g. '\\u8d35\\u5dde\\u8305\\u53f0' → '贵州茅台')
   */
  decode(text: string): string
}

// ── Root Runtime ───────────────────────────────────────────────────────────

export interface PluginRuntime {
  /** Signal that the plugin has finished initialization. */
  ready(): void
  /** Plugin metadata from plugin.toml — available after activation. */
  meta: PluginMeta
  lifecycle: PluginLifecycle
  hook: PluginHook
  tools: PluginTools
  /** View/tab management — register tabs, trigger re-renders. */
  view: PluginView
  /** Component factories — display, layout, chart, and interactive input components. */
  ui: PluginUI
  /** Persistent key-value store (Tauri-backed). */
  kv: PluginKV
  /** Plugin configuration (persistent settings). */
  config: PluginConfig
  state: PluginState
  log: PluginLog
  /** Managed timers — auto-cleaned on deactivate. */
  timer: PluginTimer
  /** Number formatting utilities. */
  fmt: PluginFmt
  /** Text decoding utilities for processing text from external APIs. */
  text: PluginText
  shell: PluginShell
  fs: PluginFS
  fetch(url: string, options?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    /** Force a charset for response body decoding (e.g. "gbk"). */
    responseEncoding?: string
  }): Promise<PluginFetchResponse>
  clipboard: PluginClipboard
}
