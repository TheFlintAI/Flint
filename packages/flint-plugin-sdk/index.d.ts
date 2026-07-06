/**
 * @flint/plugin-sdk — TypeScript type declarations for Flint Plugin API
 *
 * Plugins run in a Web Worker. The runtime provides a global `$plugin` object.
 * Plugin code is built into a self-contained Worker script — no module imports
 * at runtime (the builder strips imports and inlines the boot layer).
 *
 * === Plugin entry (main.ts) ===
 *
 *   /// <reference types="@flint/plugin-sdk" />
 *   // `$plugin` is now typed as PluginRuntime
 *
 *   $plugin.hook.on('tool:start', (data) => { ... })
 *   $plugin.ui.tab('stats', 'Statistics', 'BarChart3', () => { ... })
 *   $plugin.ready()
 */

// ── Modular type re-exports ───────────────────────────────────────────────

export * from './types/events'
export * from './types/vnode'
export * from './types/tools'
export * from './types/capabilities'
export * from './types/runtime'

// ── Global $plugin declaration ─────────────────────────────────────────────

import type { PluginRuntime } from './types/runtime'

declare const $plugin: PluginRuntime
export default $plugin
