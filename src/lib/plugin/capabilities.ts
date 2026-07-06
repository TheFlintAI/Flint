/**
 * Plugin capability execution — routes worker RPC methods to Tauri commands.
 * Enforces plugin permissions before invoking restricted capabilities.
 */

import type { PluginRequest } from './plugin-protocol'
import { CAPABILITY_PERMISSIONS, hasAnyPermission } from './permissions'
import { invokePlugin } from './tauri-invoke'

// Capability endpoint

interface CapabilityEndpoint {
  /** Tauri command channel to invoke. */
  channel: string
  /** Build the command args from the positional arguments sent by the plugin. */
  buildArgs: (positionalArgs: unknown[]) => Record<string, unknown>
  /** Transform the raw Tauri response before sending it back to the plugin.
   *  Defaults to identity (pass-through). */
  adaptResponse?: (raw: unknown) => unknown
}

// Arg helpers

function firstArg(args: unknown[]): unknown {
  return args[0]
}

function optionsArg(args: unknown[]): Record<string, unknown> | undefined {
  const v = args[1]
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

// Route table

const CAPABILITY_ENDPOINTS: Record<string, CapabilityEndpoint> = {
  'shell:exec': {
    channel: 'shell:exec',
    buildArgs: (a) => ({
      command: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
      cwd: optionsArg(a)?.cwd,
    }),
  },

  'fs:read': {
    channel: 'fs:read-file',
    buildArgs: (a) => ({
      path: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
    }),
  },

  'fs:list': {
    channel: 'fs:list-dir',
    buildArgs: (a) => ({
      path: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
    }),
  },

  'fs:write': {
    channel: 'fs:write-file',
    buildArgs: (a) => ({
      path: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
      content: typeof a[1] === 'string' ? a[1] as string : '',
    }),
  },

  'fs:delete': {
    channel: 'fs:delete',
    buildArgs: (a) => ({
      path: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
    }),
  },

  'network:fetch': {
    channel: 'api:request',
    buildArgs: (a) => {
      const opts = optionsArg(a)
      return {
        url: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
        method: opts?.method,
        headers: opts?.headers,
        body: opts?.body,
        responseEncoding: opts?.responseEncoding,
        timeoutMs: opts?.timeoutMs,
      }
    },
    adaptResponse: adaptFetchResponse,
  },

  'clipboard:read': {
    channel: 'clipboard:read-text',
    buildArgs: () => ({}),
  },

  'clipboard:write': {
    channel: 'clipboard:write-text',
    buildArgs: (a) => ({
      text: typeof firstArg(a) === 'string' ? firstArg(a) as string : '',
    }),
  },
}

// Network response normalization

/**
 * Normalize the Rust HTTP client response into the shape expected by the
 * plugin Worker runtime's fetch adapter.
 */
function adaptFetchResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  return {
    statusCode: r.statusCode,
    headers: r.headers ?? {},
    body: r.body ?? '',
  }
}

// Capability context

export interface CapabilityContext {
  pluginId: string
  permissions: string[]
  respond: (id: string, result: unknown) => void
  reject: (id: string, code: number, message: string) => void
  logWarn: (msg: string) => void
  logError: (msg: string) => void
}

// Execute

/**
 * Execute a capability requested by a plugin worker.
 *
 * 1. Parse the method name into `category.fnName`
 * 2. Look up the capability endpoint
 * 3. Check permissions
 * 4. Invoke the Tauri command
 * 5. Adapt the response and send it back to the plugin
 */
export async function executeCapability(
  ctx: CapabilityContext,
  msg: PluginRequest,
): Promise<void> {
  const dotIndex = msg.method.indexOf('.')
  if (dotIndex < 0) return

  const category = msg.method.slice(0, dotIndex)
  const fnName = msg.method.slice(dotIndex + 1)
  const methodKey = `${category}:${fnName}`
  const positionalArgs = (msg.params?.args as unknown[]) ?? []

  try {
    const endpoint = CAPABILITY_ENDPOINTS[methodKey]
    if (!endpoint) {
      const errorMsg = `Unknown capability: ${msg.method}`
      ctx.logWarn(`[${ctx.pluginId}] ${errorMsg}`)
      if (msg.id) ctx.reject(msg.id, -3, errorMsg)
      return
    }

    const required = CAPABILITY_PERMISSIONS[methodKey]
    if (required !== undefined && !hasAnyPermission(ctx.permissions, required)) {
      const errorMsg = `Permission denied: "${methodKey}"`
      ctx.logWarn(`[${ctx.pluginId}] ${errorMsg}`)
      if (msg.id) ctx.reject(msg.id, -4, errorMsg)
      return
    }

    const rawResult = await invokePlugin(endpoint.channel, endpoint.buildArgs(positionalArgs))
    const result = endpoint.adaptResponse
      ? endpoint.adaptResponse(rawResult)
      : rawResult

    if (msg.id) ctx.respond(msg.id, result)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    ctx.logError(`[${ctx.pluginId}] Capability "${msg.method}" failed: ${errorMsg}`)
    if (msg.id) ctx.reject(msg.id, -1, errorMsg)
  }
}
