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

  UI_REGISTER_TAB: 'ui.registerTab',
  UI_REFRESH_TAB: 'ui.refreshTab',

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

  UI_RENDER_TAB: 'ui.renderTab',
  TOOL_EXECUTE: 'tool.execute',
} as const

// Store & Settings

export const STORE_METHOD = {
  GET: 'store.get',
  SET: 'store.set',
  DELETE: 'store.delete',
  KEYS: 'store.keys',

  SETTINGS_GET: 'settings.get',
  SETTINGS_SET: 'settings.set',
  SETTINGS_CHANGED: 'settings.changed',
} as const

// Event names

export const PLUGIN_EVENT = {
  AGENT_EVENT: 'agent-event',
  UI_ACTION: 'ui:action',
  SETTINGS_CHANGED: 'settings.changed',
} as const

// Error codes

export const enum PluginErrorCode {
  /** Generic internal error */
  INTERNAL = -1,
  /** Requested resource not found (tab, tool, etc.) */
  NOT_FOUND = -2,
  /** Unknown RPC method */
  UNKNOWN_METHOD = -3,
}
