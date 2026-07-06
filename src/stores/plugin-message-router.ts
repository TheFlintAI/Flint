/**
 * Plugin RPC message router — dispatches Worker messages to the appropriate handler.
 *
 * All handler functions are pure message-in → side-effect-out.
 * They access the WorkerManager singleton and plugin store via imports.
 */

import { createLogger } from '@/lib/logger'
import { toast } from 'sonner'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import type { PluginMessage, PluginRequest, PluginNotify } from '@/lib/plugin/plugin-protocol'
import type { LocalizedString } from '@/lib/localized-string'
import type { ToolResultContent } from '@/lib/api/types'
import { executeCapability, type CapabilityContext } from '@/lib/plugin/capabilities'
import { invokePlugin } from '@/lib/plugin/tauri-invoke'
import {
  PLUGIN_METHOD,
  HOST_METHOD,
  STORE_METHOD,
} from '@/lib/plugin/plugin-protocol'
import { usePluginStore, getWorkerManager, type PluginToolInfo } from './plugin-store'
import { toolRegistry } from '@/lib/agent/tool-registry'
import { registerToolIcon, unregisterToolIcon } from '@/lib/tools/tool-icon'

const log = createLogger('Plugin')

// Entry point

export function handleWorkerMessage(pluginId: string, msg: PluginMessage): void {
  if (msg.type === 'request') {
    void handlePluginRequest(pluginId, msg)
    return
  }

  if (msg.type === 'notify') {
    handlePluginNotify(pluginId, msg)
    return
  }
}

// Request handlers

async function handlePluginRequest(pluginId: string, msg: PluginRequest): Promise<void> {
  switch (msg.method) {
    case STORE_METHOD.SETTINGS_GET:
    case STORE_METHOD.SETTINGS_SET:
    case STORE_METHOD.GET:
    case STORE_METHOD.SET:
    case STORE_METHOD.DELETE:
    case STORE_METHOD.KEYS:
      await handleStoreRequest(pluginId, msg)
      break

    default:
      if (msg.method.includes('.')) {
        await dispatchCapability(pluginId, msg)
      } else {
        log.warn(`[${pluginId}] Unknown request method: "${msg.method}"`)
        if (msg.id) {
          getWorkerManager().sendError(pluginId, msg.id, -3, `Unknown method: ${msg.method}`)
        }
      }
      break
  }
}

async function handleStoreRequest(pluginId: string, msg: PluginRequest): Promise<void> {
  const wm = getWorkerManager()
  const method = msg.method

  try {
    let result: unknown
    switch (method) {
      case STORE_METHOD.SETTINGS_GET:
        result = usePluginStore.getState().getPluginSettings(pluginId)
        break
      case STORE_METHOD.SETTINGS_SET: {
        const data = (msg.params?.data as Record<string, unknown>) ?? {}
        for (const [key, value] of Object.entries(data)) {
          await usePluginStore.getState().updateSetting(pluginId, key, value)
        }
        result = true
        break
      }
      case STORE_METHOD.GET: {
        const state = await invokePlugin<Record<string, unknown>>(TAURI_COMMANDS.PLUGIN_GET_STATE, { pluginId })
        const key = msg.params?.key as string | undefined
        result = key !== undefined ? state?.[key] : state
        break
      }
      case STORE_METHOD.SET:
        await invokePlugin(TAURI_COMMANDS.PLUGIN_SET_STATE, {
          pluginId,
          key: msg.params?.key as string,
          value: msg.params?.value,
        })
        result = undefined
        break
      case STORE_METHOD.DELETE:
        await invokePlugin(TAURI_COMMANDS.PLUGIN_DELETE_STATE, {
          pluginId,
          key: msg.params?.key as string,
        })
        result = undefined
        break
      case STORE_METHOD.KEYS: {
        const state = await invokePlugin<Record<string, unknown>>(TAURI_COMMANDS.PLUGIN_GET_STATE, { pluginId })
        result = state ? Object.keys(state) : []
        break
      }
    }
    if (msg.id) {
      wm.sendResponse(pluginId, msg.id, result)
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    log.error(`[${pluginId}] Store request failed:`, errorMsg)
    if (msg.id) {
      getWorkerManager().sendError(pluginId, msg.id, -1, errorMsg)
    }
  }
}

async function dispatchCapability(pluginId: string, msg: PluginRequest): Promise<void> {
  const wm = getWorkerManager()
  const permissions = usePluginStore.getState().getPluginPermissions(pluginId)
  const ctx: CapabilityContext = {
    pluginId,
    permissions,
    respond: (id, result) => wm.sendResponse(pluginId, id, result),
    reject: (id, code, message) => wm.sendError(pluginId, id, code, message),
    logWarn: (message) => log.warn(message),
    logError: (message) => log.error(message),
  }
  await executeCapability(ctx, msg)
}

// Notification handler

function handlePluginNotify(pluginId: string, msg: PluginNotify): void {
  const wm = getWorkerManager()

  switch (msg.method) {
    case PLUGIN_METHOD.LIFECYCLE_READY:
      wm.markReady(pluginId)
      {
        const plugin = usePluginStore.getState().plugins.find(p => p.id === pluginId)
        const meta = plugin ? {
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          displayName: plugin.manifest.displayName,
          icon: plugin.manifest.icon ?? 'Puzzle',
        } : undefined
        wm.sendRequest(pluginId, HOST_METHOD.LIFECYCLE_ACTIVATE, { meta }).catch(() => {})
      }
      break

    case PLUGIN_METHOD.HOOK_SUBSCRIBE: {
      const event = (msg.params?.event as string) ?? '*'
      wm.addEventSubscription(pluginId, event)
      break
    }

    case PLUGIN_METHOD.UI_REGISTER_TAB: {
      const { id, label, icon } = (msg.params ?? {}) as {
        id?: string
        label?: LocalizedString
        icon?: string
      }
      if (id && label) {
        wm.registerTab(pluginId, id, label, icon ?? '')
        usePluginStore.setState((state) => ({
          pluginTabs: {
            ...state.pluginTabs,
            [pluginId]: wm.getTabs(pluginId)
          }
        }))
      }
      break
    }

    case PLUGIN_METHOD.UI_REFRESH_TAB: {
      const tabId = (msg.params?.id as string) ?? ''
      if (tabId) {
        usePluginStore.getState().loadTabVNode(pluginId, tabId)
      }
      break
    }

    case PLUGIN_METHOD.TOOL_REGISTER: {
      const def = (msg.params ?? {}) as {
        name?: string
        displayName?: LocalizedString
        description?: string
        displayDescription?: LocalizedString
        inputSchema?: Record<string, unknown>
        icon?: string
      }
      if (!def.name || !def.displayName) break

      const displayDescription: LocalizedString =
        def.displayDescription ?? (def.description ? { en: def.description } : undefined) ?? { en: '' }
      const definitionDescription: string =
        (def.displayDescription && typeof def.displayDescription === 'object' ? (def.displayDescription as Record<string,string>).en : null) ??
        def.description ??
        ''

      const fullName = `plugin_${pluginId}_${def.name}`

      const toolInfo: PluginToolInfo = {
        name: def.name,
        displayName: def.displayName,
        displayDescription,
        icon: def.icon,
      }
      usePluginStore.setState((state) => ({
        pluginTools: {
          ...state.pluginTools,
          [pluginId]: [...(state.pluginTools[pluginId] ?? []).filter(t => t.name !== def.name), toolInfo],
        }
      }))

      toolRegistry.add({
          definition: {
            name: fullName,
            description: definitionDescription,
            inputSchema: (def.inputSchema as { type: 'object'; properties: Record<string, unknown>; required?: string[] }) || { type: 'object' as const, properties: {} },
          },
          displayName: def.displayName,
          execute: async (input, _ctx) => {
            const result = await wm.sendRequest(pluginId, HOST_METHOD.TOOL_EXECUTE, {
              name: def.name,
              input,
            }) as { content: ToolResultContent } | undefined
            return (result?.content ?? [{ type: 'text', text: 'Tool execution failed' }]) as ToolResultContent
          },
          render: {
            kind: 'remote',
            pluginId,
            toolName: def.name!,
            header: {
              type: 'row',
              children: [
                { type: 'text', props: { text: def.name! } },
              ],
            },
          },
        })

        registerToolIcon(fullName, def.icon)

      break
    }

    case PLUGIN_METHOD.TOOL_UNREGISTER: {
      const name = (msg.params?.name as string) ?? ''
      if (!name) break
      const fullName = `plugin_${pluginId}_${name}`

      usePluginStore.setState((state) => ({
        pluginTools: {
          ...state.pluginTools,
          [pluginId]: (state.pluginTools[pluginId] ?? []).filter(t => t.name !== name),
        }
      }))

      toolRegistry.unregister(fullName)
      unregisterToolIcon(fullName)
      break
    }

    case PLUGIN_METHOD.LOG_INFO:
      log.info(`[${pluginId}]`, msg.params?.message)
      break
    case PLUGIN_METHOD.LOG_WARN:
      log.warn(`[${pluginId}]`, msg.params?.message)
      break
    case PLUGIN_METHOD.LOG_ERROR:
      log.error(`[${pluginId}]`, msg.params?.message)
      toast.error(String(msg.params?.message ?? 'Plugin error'))
      break
  }
}
