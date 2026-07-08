/**
 * Plugin RPC protocol constants and message types — single source of truth.
 *
 * Used by both the Worker runtime and the host to ensure consistent naming.
 */

// Message types

/** Discriminated union of all plugin-worker messages. */
export type PluginMessage =
  | PluginRequest
  | PluginResponse
  | PluginNotify
  | PluginEvent

/** RPC request — expects a response with matching `id`. */
export interface PluginRequest {
  type: 'request'
  id: string
  method: string
  params?: { args?: unknown[] } & Record<string, unknown>
}

/** RPC response — matches a prior request by `id`. */
export interface PluginResponse {
  type: 'response'
  id: string
  result?: unknown
  error?: { code: number; message: string }
}

/** Fire-and-forget notification — no response expected. */
export interface PluginNotify {
  type: 'notify'
  method: string
  params?: Record<string, unknown>
}

/** Broadcast event — dispatched to subscribed listeners. */
export interface PluginEvent {
  type: 'event'
  event: string
  data?: unknown
}

// Lifecycle (plugin → host)

export const PLUGIN_METHOD = {
  LIFECYCLE_READY: 'lifecycle.ready',

  HOOK_SUBSCRIBE: 'hook.subscribe',

  VIEW_REGISTER: 'view.register',
  VIEW_REFRESH: 'view.refresh',

  TOOL_REGISTER: 'tool.register',
  TOOL_UNREGISTER: 'tool.unregister',

  LOG_INFO: 'log.info',
  LOG_WARN: 'log.warn',
  LOG_ERROR: 'log.error',
} as const

// Lifecycle (host → plugin)

export const HOST_METHOD = {
  LIFECYCLE_ACTIVATE: 'lifecycle.activate',
  LIFECYCLE_DEACTIVATE: 'lifecycle.deactivate',

  VIEW_RENDER: 'view.render',
  TOOL_EXECUTE: 'tool.execute',
} as const

// KV store (persistent key-value)

export const KV_METHOD = {
  GET: 'kv.get',
  SET: 'kv.set',
  DELETE: 'kv.delete',
  KEYS: 'kv.keys',
} as const

// Config (plugin configuration)

export const CONFIG_METHOD = {
  GET: 'config.get',
  SET: 'config.set',
} as const

// Event names

export const PLUGIN_EVENT = {
  AGENT_EVENT: 'agent-event',
  UI_ACTION: 'ui:action',
  CONFIG_CHANGED: 'config.changed',
} as const

// Error codes

export const enum PluginErrorCode {
  /** Generic internal error */
  INTERNAL = -1,
  /** Requested resource not found (tab, tool, etc.) */
  NOT_FOUND = -2,
  /** Unknown RPC method */
  UNKNOWN_METHOD = -3,
  /** Permission denied */
  PERMISSION_DENIED = -4,
}
