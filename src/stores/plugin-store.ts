import { create } from 'zustand'
import { createLogger } from '@/lib/logger'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { agentEvents } from '@/lib/agent/events/event-bus'
import { WorkerManager } from '@/lib/plugin/worker-manager'
import type { VNode } from '@/lib/plugin/vnode-types'
import type { AgentLifecycleEvent } from '@/lib/agent/events/types'
import type { LocalizedString } from '@/lib/localized-string'
import { invokePlugin } from '@/lib/plugin/tauri-invoke'
import { HOST_METHOD } from '@/lib/plugin/plugin-protocol'
import { toolRegistry } from '@/lib/agent/tool-registry'
import { unregisterToolIcon } from '@/lib/tools/tool-icon'
import { handleWorkerMessage } from './plugin-message-router'

const log = createLogger('Plugin')

// Types

export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'error'

export interface PluginManifest {
  name: string
  displayName: LocalizedString
  version: string
  displayDescription?: LocalizedString
  icon?: string
  homepage?: string
  repository?: string
  main: string
  permissions?: string[]
}

export interface Plugin {
  id: string
  manifest: PluginManifest
  status: PluginStatus
  enabled: boolean
  size: number
  installedAt: number
  enabledAt: number | null
  settings: Record<string, unknown>
  state: Record<string, unknown>
  errorMessage?: string
}

export interface PluginTab {
  id: string
  label: LocalizedString
  icon: string
}

export interface PluginToolInfo {
  name: string
  displayName: LocalizedString
  displayDescription: LocalizedString
  icon?: string
}

// Worker Manager singleton

let workerManager: WorkerManager

export function getWorkerManager(): WorkerManager {
  if (!workerManager) {
    workerManager = new WorkerManager({
      onMessage: handleWorkerMessage,
      onReady: (pluginId) => {
        log.info(`[${pluginId}] Worker ready`)
        usePluginStore.setState((state) => {
          const plugins = state.plugins.map((p) =>
            p.id === pluginId ? { ...p, status: 'enabled' as const, errorMessage: undefined } : p
          )
          return { plugins }
        })
      },
      onError: (pluginId, error) => {
        log.error(`[${pluginId}] Worker error: ${error}`)
        usePluginStore.setState((state) => {
          const plugins = state.plugins.map((p) =>
            p.id === pluginId ? { ...p, status: 'error' as const, errorMessage: error } : p
          )
          return { plugins }
        })
      },
    })
  }
  return workerManager
}

// Event dispatcher

function setupEventDispatcher(): () => void {
  return agentEvents.register((event: AgentLifecycleEvent) => {
    getWorkerManager().dispatchEvent(event)
  })
}

let unregisterEventDispatcher: (() => void) | null = null

// Store

interface PluginStoreState {
  plugins: Plugin[]
  initialized: boolean
  error: string | null
  selectedPluginId: string | null
  pluginTabs: Record<string, PluginTab[]>
  tabVNodes: Record<string, Record<string, VNode | null>>
  pluginTools: Record<string, PluginToolInfo[]>

  selectPlugin: (id: string | null) => void
  initialize: () => Promise<void>
  refreshPlugins: () => Promise<void>
  importFlp: (path: string) => Promise<Plugin | null>
  enablePlugin: (id: string) => Promise<void>
  disablePlugin: (id: string) => Promise<void>
  togglePlugin: (id: string) => Promise<void>
  deletePlugin: (id: string) => Promise<boolean>
  deletePlugins: (ids: string[]) => Promise<boolean>
  updateSetting: (pluginId: string, key: string, value: unknown) => Promise<void>
  getPluginSettings: (id: string) => Record<string, unknown>
  getPluginPermissions: (id: string) => string[]
  loadTabVNode: (pluginId: string, tabId: string) => Promise<void>
}

export const usePluginStore = create<PluginStoreState>()((set, get) => ({
  plugins: [],
  initialized: false,
  error: null,
  selectedPluginId: null,
  pluginTabs: {},
  tabVNodes: {},
  pluginTools: {},

  selectPlugin: (id) => set({ selectedPluginId: id }),

  initialize: async () => {
    if (get().initialized) return
    log.info('[initialize] Starting plugin system...')

    if (!unregisterEventDispatcher) {
      unregisterEventDispatcher = setupEventDispatcher()
    }

    try {
      // Discover plugins first — this initializes the Rust PluginManager
      // (including resource_dir which is needed by getRuntime)
      await invokePlugin(TAURI_COMMANDS.PLUGIN_DISCOVER)

      // Load shared runtime once before starting any plugin workers
      try {
        const { runtimeJs } = await invokePlugin<{ runtimeJs: string }>(TAURI_COMMANDS.PLUGIN_GET_RUNTIME)
        if (runtimeJs) {
          getWorkerManager().setRuntime(runtimeJs)
          log.info('[initialize] Shared runtime loaded')
        }
      } catch (err) {
        log.warn('[initialize] Failed to load shared runtime, plugins may not work:', err)
      }

      const plugins = await invokePlugin<Plugin[]>(TAURI_COMMANDS.PLUGIN_LIST)
      const pluginList = Array.isArray(plugins) ? plugins : []

      const enabledPlugins = pluginList.filter((p) => p.enabled)
      log.info(`[initialize] ${pluginList.length} plugins, ${enabledPlugins.length} enabled`)

      set({
        plugins: pluginList.map((p) => ({
          ...p,
          ...(p.size > 0 ? {} : { size: 0 }),
        }))
      })

      for (const plugin of enabledPlugins) {
        await enablePluginWorker(plugin.id)
      }

      set({ initialized: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`[initialize] Failed: ${message}`)
      set({ error: message, initialized: true })
    }
  },

  refreshPlugins: async () => {
    try {
      const plugins = await invokePlugin<Plugin[]>(TAURI_COMMANDS.PLUGIN_LIST)
      if (Array.isArray(plugins)) set({ plugins })
    } catch { /* keep existing */ }
  },

  importFlp: async (path) => {
    const { plugin } = await invokePlugin<{ plugin: Plugin }>(TAURI_COMMANDS.PLUGIN_IMPORT_FLP, { path })
    await get().refreshPlugins()
    return plugin ?? null
  },

  enablePlugin: async (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    if (!plugin) return

    log.info(`[enablePlugin] Enabling "${id}"...`)

    try {
      await invokePlugin(TAURI_COMMANDS.PLUGIN_ENABLE, { pluginId: id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`[enablePlugin] "${id}" Tauri enable failed: ${message}`)
      set({
        plugins: get().plugins.map((p) =>
          p.id === id ? { ...p, status: 'error' as const, errorMessage: message } : p
        )
      })
      return
    }

    try {
      await enablePluginWorker(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`[enablePlugin] "${id}" Worker creation failed: ${message}`)
      getWorkerManager().terminate(id)
      await invokePlugin(TAURI_COMMANDS.PLUGIN_DISABLE, { pluginId: id }).catch(() => {})
      set({
        plugins: get().plugins.map((p) =>
          p.id === id ? { ...p, status: 'error' as const, errorMessage: message } : p
        )
      })
      return
    }

    // Worker created — now mark as enabled (onReady handler will clear any error)
    set({
      plugins: get().plugins.map((p) =>
        p.id === id ? { ...p, enabled: true, status: 'enabled' as const, errorMessage: undefined } : p
      )
    })
    log.info(`[enablePlugin] "${id}" enabled`)
  },

  disablePlugin: async (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    if (!plugin) return

    log.info(`[disablePlugin] Disabling "${id}"...`)

    const wm = getWorkerManager()

    // 1. Send deactivate and wait briefly for cleanup callbacks
    try {
      await Promise.race([
        wm.sendRequest(id, HOST_METHOD.LIFECYCLE_DEACTIVATE),
        new Promise((_, reject) => setTimeout(() => reject(new Error('deactivate timeout')), 500)),
      ])
    } catch {
      // Plugin may already be dead or unresponsive — proceed with termination
    }

    // 2. Terminate worker
    wm.terminate(id)

    // 3. Clean up plugin-registered tools from registry
    await cleanupPluginTools(id)

    // 4. Clean up tab and tool UI state
    set((state) => {
      const { [id]: _, ...restTabs } = state.pluginTabs
      const { [id]: __, ...restVNodes } = state.tabVNodes
      const { [id]: ___, ...restTools } = state.pluginTools
      return { pluginTabs: restTabs, tabVNodes: restVNodes, pluginTools: restTools }
    })

    // 5. Synchronize with Tauri
    try {
      await invokePlugin(TAURI_COMMANDS.PLUGIN_DISABLE, { pluginId: id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`[disablePlugin] "${id}" Tauri disable failed: ${message}`)
      // Keep disabled in frontend regardless — Tauri can catch up later
    }

    // 5. Mark as disabled in state
    set({
      plugins: get().plugins.map((p) =>
        p.id === id ? { ...p, enabled: false, status: 'disabled' as const } : p
      )
    })
    log.info(`[disablePlugin] "${id}" disabled`)
  },

  togglePlugin: async (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    if (!plugin) return
    if (plugin.enabled) await get().disablePlugin(id)
    else await get().enablePlugin(id)
  },

  deletePlugin: async (id) => {
    try {
      const wm = getWorkerManager()
      // Send deactivate before termination
      try {
        await Promise.race([
          wm.sendRequest(id, HOST_METHOD.LIFECYCLE_DEACTIVATE),
          new Promise((_, reject) => setTimeout(() => reject(new Error('deactivate timeout')), 500)),
        ])
      } catch { /* proceed */ }
      wm.terminate(id)

      // Clean up plugin-registered tools from registry
      await cleanupPluginTools(id)

      await invokePlugin(TAURI_COMMANDS.PLUGIN_UNINSTALL, { pluginId: id })
      set((state) => {
        const { [id]: _, ...restTabs } = state.pluginTabs
        const { [id]: __, ...restVNodes } = state.tabVNodes
        const { [id]: ___, ...restTools } = state.pluginTools
        return {
          plugins: state.plugins.filter((p) => p.id !== id),
          pluginTabs: restTabs,
          tabVNodes: restVNodes,
          pluginTools: restTools,
        }
      })
      return true
    } catch (err) {
      log.error(`deletePlugin "${id}" failed:`, err)
      return false
    }
  },

  deletePlugins: async (ids) => {
    let allSuccess = true
    for (const id of ids) {
      const ok = await get().deletePlugin(id)
      if (!ok) allSuccess = false
    }
    return allSuccess
  },

  updateSetting: async (pluginId, key, value) => {
    set({
      plugins: get().plugins.map((p) =>
        p.id === pluginId ? { ...p, settings: { ...p.settings, [key]: value } } : p
      )
    })
    try {
      await invokePlugin(TAURI_COMMANDS.PLUGIN_SET_SETTING, { pluginId, key, value })
    } catch (err) {
      log.error('Failed to persist setting:', err)
    }
  },

  getPluginSettings: (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    return plugin ? { ...plugin.settings } : {}
  },

  getPluginPermissions: (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    return plugin?.manifest.permissions ?? []
  },

  loadTabVNode: async (pluginId, tabId) => {
    try {
      const vnode = await getWorkerManager().renderTab(pluginId, tabId)
      set((state) => ({
        tabVNodes: {
          ...state.tabVNodes,
          [pluginId]: {
            ...(state.tabVNodes[pluginId] ?? {}),
            [tabId]: vnode
          }
        }
      }))
    } catch {
      // Plugin may not be running
    }
  },
}))

// Tool cleanup helper

async function cleanupPluginTools(pluginId: string): Promise<void> {
  const tools = usePluginStore.getState().pluginTools[pluginId]
  if (!tools || tools.length === 0) return

  try {
    for (const tool of tools) {
      const fullName = `plugin_${pluginId}_${tool.name}`
      toolRegistry.unregister(fullName)
      unregisterToolIcon(fullName)
    }
  } catch (err) {
    log.error(`[cleanupTools] "${pluginId}" tool cleanup failed:`, err)
  }
}

// Worker lifecycle

async function enablePluginWorker(pluginId: string): Promise<void> {
  const source = await invokePlugin<{ mainJs: string }>(TAURI_COMMANDS.PLUGIN_GET_SOURCE, { pluginId })

  if (!source?.mainJs) {
    throw new Error('Plugin source is empty')
  }

  getWorkerManager().create(pluginId, source.mainJs)
}
