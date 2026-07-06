/**
 * Plugin tool definition and registration types.
 */

import type { LocalizedString } from './vnode'

export interface PluginToolDefinition {
  /** Tool name (must be unique within the plugin). */
  name: string
  /** AI-visible description of what the tool does. */
  description: string
  /** UI description (localized). */
  displayDescription: LocalizedString
  /** JSON Schema for the tool's input parameters. */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** UI display name (localized). */
  displayName: LocalizedString
  /** Lucide icon name (e.g. 'CloudSun', 'Database'). Default: 'Puzzle'. */
  icon?: string
}

export interface PluginTools {
  /**
   * Register a custom Agent tool.
   * The handler runs in the Worker and can use $plugin.shell, $plugin.fs, $plugin.fetch, etc.
   * The tool name is automatically namespaced as `plugin_<pluginId>_<name>`.
   */
  register(
    def: PluginToolDefinition,
    handler: (input: Record<string, unknown>) => Promise<unknown>
  ): void

  /** Unregister a previously registered tool. */
  unregister(name: string): void
}
