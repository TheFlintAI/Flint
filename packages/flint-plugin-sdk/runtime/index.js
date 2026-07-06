/**
 * Flint Plugin SDK — Worker Runtime (Assembly)
 *
 * Composes transport, VNode factory, and capability modules into the
 * `$plugin` runtime object on `globalThis`. This module is bundled
 * separately as the shared runtime — plugin code only sees `$plugin`
 * as a global.
 */

import { setupTransport, post, call, on, reply, reject } from './transport.js'
import { createVNodeFactory } from './vnode-factory.js'
import { createProxy, adaptResponse } from './capabilities.js'
import { textUtils } from './text.js'

// ── Worker identity ────────────────────────────────────────────────────────

const PLUGIN_ID = self.name || 'unknown'

// ── Plugin metadata (set by host during activation) ────────────────────────

let meta = { name: PLUGIN_ID, version: '0.0.0', displayName: { en: PLUGIN_ID }, icon: 'Puzzle' }

// ── Managed timers (auto-cleaned on deactivate) ────────────────────────────

const timers = new Set()

function disposeAllTimers() {
  for (const t of timers) { try { t.dispose() } catch (_) {} }
  timers.clear()
}

// ── Tab registry ───────────────────────────────────────────────────────────

const tabs = {}

// ── VNode factory ──────────────────────────────────────────────────────────

const vnodeFactory = createVNodeFactory()

// ── Tool executors ─────────────────────────────────────────────────────────

const toolExecutors = {}

function dispatchTool(msg) {
  const { name, input } = msg.params || {}
  const executor = toolExecutors[name]
  if (!executor) {
    reject(msg.id, -1, `Tool not found: ${name}`)
    return
  }
  Promise.resolve().then(() => executor(input))
    .then(result => reply(msg.id, result))
    .catch(err => reject(msg.id, -1, err instanceof Error ? err.message : String(err)))
}

// ── Request dispatcher (host → plugin) ─────────────────────────────────────

const activateCbs = []
const deactivateCbs = []

function dispatch(msg) {
  switch (msg.method) {
    case 'lifecycle.activate':
      // Store plugin metadata sent by host
      if (msg.params && msg.params.meta) meta = msg.params.meta
      for (const cb of activateCbs) {
        Promise.resolve().then(() => cb()).catch(err => {
          post('log.error', { message: `[${PLUGIN_ID}] activate callback error: ${err instanceof Error ? err.message : String(err)}` })
        })
      }
      reply(msg.id, true)
      return
    case 'lifecycle.deactivate':
      disposeAllTimers()
      for (const cb of deactivateCbs) {
        Promise.resolve().then(() => cb()).catch(err => {
          post('log.error', { message: `[${PLUGIN_ID}] deactivate callback error: ${err instanceof Error ? err.message : String(err)}` })
        })
      }
      reply(msg.id, true)
      return
    case 'ui.renderTab': {
      const tabId = msg.params && msg.params.tabId
      const tab = tabs[tabId]
      if (tab && typeof tab.render === 'function') {
        try {
          const vnode = tab.render()
          reply(msg.id, vnode)
        } catch (err) {
          reject(msg.id, -1, err instanceof Error ? err.message : String(err))
        }
      } else {
        reject(msg.id, -2, `Tab not found: ${tabId}`)
      }
      return
    }
    case 'tool.execute':
      dispatchTool(msg)
      return
    default:
      reject(msg.id, -3, `Unknown method: ${msg.method}`)
  }
}

// ── UI object ──────────────────────────────────────────────────────────────

const ui = {
  ...vnodeFactory,

  tab(id, label, icon, render) {
    tabs[id] = { label, icon, render }
    post('ui.registerTab', { id, label, icon })
  },
  refresh(id) {
    post('ui.refreshTab', { id })
  },

  /**
   * Register form action handlers.
   *
   * Object form (recommended) — routes by formId → action:
   *   $plugin.ui.onAction({
   *     'my-form': {
   *       change({ values }) { ... },
   *       submit({ values }) { ... },
   *     }
   *   })
   *
   * Function form — catch-all for all actions:
   *   $plugin.ui.onAction(({ formId, action, values }) => { ... })
   */
  onAction(routes) {
    post('hook.subscribe', { event: 'ui:action' })
    if (typeof routes === 'function') {
      return on('ui:action', routes)
    }
    return on('ui:action', (data) => {
      const handlers = routes[data.formId]
      if (handlers && typeof handlers[data.action] === 'function') {
        handlers[data.action](data)
      }
    })
  },
}

// ── $plugin runtime (exposed as global for plugin code) ────────────────────

globalThis.$plugin = {
  ready() {
    post('lifecycle.ready', { pluginId: PLUGIN_ID })
  },

  /** Plugin metadata — name, version, displayName, icon from plugin.toml. */
  get meta() { return meta },

  lifecycle: {
    onActivate(cb)   { activateCbs.push(cb); return { dispose() { const i = activateCbs.indexOf(cb); if (i >= 0) activateCbs.splice(i, 1) } } },
    onDeactivate(cb) { deactivateCbs.push(cb); return { dispose() { const i = deactivateCbs.indexOf(cb); if (i >= 0) deactivateCbs.splice(i, 1) } } },
  },

  hook: {
    on(event, fn) {
      const wrapped = typeof event === 'function'
        ? event
        : (data) => { if (event === '*' || data.type === event) fn(data) }
      const inner = on('agent-event', wrapped)
      post('hook.subscribe', { event: event === '*' ? '*' : event })
      return { dispose() { inner.dispose() } }
    },
  },

  tools: {
    register(def, handler) {
      toolExecutors[def.name] = handler
      const serializable = {}
      for (const key of Object.keys(def)) {
        if (typeof def[key] !== 'function') {
          serializable[key] = def[key]
        }
      }
      post('tool.register', serializable)
    },
    unregister(name) {
      delete toolExecutors[name]
      post('tool.unregister', { name })
    }
  },

  ui,

  /**
   * Managed timers — auto-cleaned on plugin deactivate.
   *
   *   $plugin.timer.interval(30_000, () => refresh())
   *   $plugin.timer.timeout(5_000, () => showNotification())
   */
  timer: {
    interval(ms, fn) {
      const id = setInterval(fn, ms)
      const handle = { dispose() { clearInterval(id); timers.delete(handle) } }
      timers.add(handle)
      return handle
    },
    timeout(ms, fn) {
      const id = setTimeout(fn, ms)
      const handle = { dispose() { clearTimeout(id); timers.delete(handle) } }
      timers.add(handle)
      return handle
    },
  },

  /**
   * Number formatting utilities.
   *
   *   $plugin.fmt.number(123.456, 2)   // "123.46"
   *   $plugin.fmt.change(5.23, 2)      // "+5.23"
   *   $plugin.fmt.percent(0.0523, 2)   // "+5.23%"
   */
  fmt: {
    number(value, decimals = 2) {
      return isFinite(value) ? value.toFixed(decimals) : '—' // —
    },
    change(value, decimals = 2) {
      if (!isFinite(value)) return '—'
      return (value >= 0 ? '+' : '') + value.toFixed(decimals)
    },
    percent(value, decimals = 2) {
      if (!isFinite(value)) return '—'
      return (value >= 0 ? '+' : '') + value.toFixed(decimals) + '%'
    },
  },

  store: {
    get(key)     { return call('store.get', { key }) },
    set(key, val) { return call('store.set', { key, value: val }) },
    delete(key)  { return call('store.delete', { key }) },
    keys()       { return call('store.keys', {}) },
  },

  state: {
    /**
     * Reactive K/V store. State mutations are synchronous — use `flush()` to
     * trigger UI re-render after all state changes + async data loading are
     * complete.
     *
     *   const $s = $plugin.state.define({ count: 0, label: 'hello' })
     *   $s.get('count')        // read
     *   $s.set('count', 5)     // write single key (no UI refresh)
     *   $s.patch({ a:1, b:2 }) // write multiple keys (no UI refresh)
     *   $s.flush()             // trigger UI re-render for all tabs
     *   await $s.load()        // restore all keys from plugin settings
     *   await $s.save()        // persist all keys
     *   await $s.save(['count']) // persist specific keys
     */
    define(schema) {
      const state = { ...schema }

      function flushTabs() {
        for (const tabId of Object.keys(tabs)) {
          post('ui.refreshTab', { id: tabId })
        }
      }

      return {
        get(key) { return state[key] },
        set(key, value) { state[key] = value },
        patch(obj) { Object.assign(state, obj) },
        /** Trigger UI re-render for all registered tabs. */
        flush() { flushTabs() },
        getAll() { return { ...state } },
        async load() {
          try {
            const saved = await call('settings.get', {})
            if (saved && typeof saved === 'object') {
              for (const key of Object.keys(schema)) {
                if (key in saved) state[key] = saved[key]
              }
            }
          } catch { /* no saved state yet */ }
        },
        async save(keys) {
          const data = {}
          for (const key of (keys || Object.keys(schema))) data[key] = state[key]
          await call('settings.set', { data })
        },
      }
    },
  },

  settings: {
    get() { return call('settings.get', {}) },
    set(data) { return call('settings.set', { data }) },
    onChange(cb) {
      post('hook.subscribe', { event: 'settings.changed' })
      const inner = on('settings.changed', cb)
      return { dispose() { inner.dispose() } }
    },
  },

  log: {
    info(msg)  { post('log.info', { message: String(msg) }) },
    warn(msg)  { post('log.warn', { message: String(msg) }) },
    error(msg) { post('log.error', { message: String(msg) }) },
  },

  shell:      createProxy('shell'),
  fs:         createProxy('fs'),
  clipboard:  createProxy('clipboard'),

  /** Text decoding utilities for processing text from external APIs. */
  text: textUtils,

  fetch(url, opts) {
    return call('network.fetch', { args: [url, opts] }).then(adaptResponse)
  },
}

// ── Start transport ────────────────────────────────────────────────────────

setupTransport(dispatch)
