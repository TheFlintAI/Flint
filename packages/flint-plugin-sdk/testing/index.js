/**
 * Test utilities for Flint plugin development.
 *
 * createTestPlugin() returns a mock $plugin runtime that stores all state
 * in-memory. The mock mirrors the real Worker runtime API exactly — same
 * method signatures, same return types, same disposal semantics.
 */

import { createVNodeFactory } from '../runtime/vnode-factory.js'
import { textUtils } from '../runtime/text.js'

export function createTestPlugin({ pluginId = 'test-plugin' } = {}) {
  const _kvStore = new Map()
  const _configStore = new Map()
  const _activateCbs = []
  const _deactivateCbs = []
  const _hookFns = []
  const _toolExecutors = {}
  const _configChangeCbs = []

  const _vnodeApi = createVNodeFactory()

  // ── View ─────────────────────────────────────────────────────────────────

  const _view = {
    _views: {},
    register(id, label, icon, render) {
      this._views[id] = { label, icon, render }
    },
    refresh(id) {
      // noop in test — render is called synchronously
    },
    _renderView(id) {
      const view = this._views[id]
      if (view && typeof view.render === 'function') return view.render()
      return null
    },
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  const _uiActionCbs = []

  const ui = {
    ..._vnodeApi,

    onAction(cb) {
      _uiActionCbs.push(cb)
      return { dispose() { const i = _uiActionCbs.indexOf(cb); if (i >= 0) _uiActionCbs.splice(i, 1) } }
    },
    _fireAction(data) {
      for (const cb of _uiActionCbs) { try { cb(data) } catch (_) {} }
    },
  }

  // ── Hook ────────────────────────────────────────────────────────────────

  function _fireHook(event) {
    for (const fn of _hookFns) {
      try { fn(event) } catch (_) {}
    }
  }

  // ── $plugin ─────────────────────────────────────────────────────────────

  const $plugin = {
    ready() {
      setTimeout(() => {
        for (const cb of _activateCbs) {
          Promise.resolve().then(() => cb()).catch(() => {})
        }
      }, 0)
    },

    lifecycle: {
      onActivate(cb) {
        _activateCbs.push(cb)
        return { dispose() { const i = _activateCbs.indexOf(cb); if (i >= 0) _activateCbs.splice(i, 1) } }
      },
      onDeactivate(cb) {
        _deactivateCbs.push(cb)
        return { dispose() { const i = _deactivateCbs.indexOf(cb); if (i >= 0) _deactivateCbs.splice(i, 1) } }
      },
      _activate() {
        for (const cb of _activateCbs) {
          Promise.resolve().then(() => cb()).catch(() => {})
        }
      },
      _deactivate() {
        for (const cb of _deactivateCbs) {
          Promise.resolve().then(() => cb()).catch(() => {})
        }
      },
    },

    hook: {
      on(event, fn) {
        const wrapped = typeof event === 'function'
          ? event
          : (data) => { if (event === '*' || data.type === event) fn(data) }
        _hookFns.push(wrapped)
        return { dispose() { const i = _hookFns.indexOf(wrapped); if (i >= 0) _hookFns.splice(i, 1) } }
      },
      _fire: _fireHook,
    },

    tools: {
      register(def, handler) {
        _toolExecutors[def.name] = handler
      },
      unregister(name) {
        delete _toolExecutors[name]
      },
      _execute(name, input) {
        const executor = _toolExecutors[name]
        if (!executor) throw new Error(`Tool not found: ${name}`)
        return executor(input)
      },
    },

    view: _view,
    ui,

    kv: {
      async get(key)     { return _kvStore.get(key) },
      async set(key, val) { _kvStore.set(key, val) },
      async delete(key)  { _kvStore.delete(key) },
      async keys()       { return [..._kvStore.keys()] },
    },

    config: {
      _store: _configStore,
      async get() { return Object.fromEntries(_configStore) },
      async set(data) { for (const [k, v] of Object.entries(data)) { _configStore.set(k, v) } },
      onChange(cb) {
        _configChangeCbs.push(cb)
        return { dispose() { const i = _configChangeCbs.indexOf(cb); if (i >= 0) _configChangeCbs.splice(i, 1) } }
      },
      _notify(data) {
        for (const cb of _configChangeCbs) { try { cb(data) } catch (_) {} }
      },
    },

    log: {
      info(msg)  { console.log(`[${pluginId}] INFO  ${msg}`) },
      warn(msg)  { console.warn(`[${pluginId}] WARN  ${msg}`) },
      error(msg) { console.error(`[${pluginId}] ERROR ${msg}`) },
    },

    shell:     new Proxy({}, { get: (_, method) => typeof method === 'string' ? (...args) => Promise.resolve({ code: 0, stdout: '', stderr: '' }) : undefined }),
    fs:        new Proxy({}, { get: (_, method) => typeof method === 'string' ? (...args) => Promise.resolve({}) : undefined }),
    text:      textUtils,
    fetch(url, opts) {
      return Promise.resolve({
        status: 200,
        headers: {},
        text: () => Promise.resolve(''),
        json: () => Promise.resolve(null),
      })
    },
    clipboard: new Proxy({}, { get: (_, method) => typeof method === 'string' ? (...args) => Promise.resolve('') : undefined }),
  }

  return $plugin
}
