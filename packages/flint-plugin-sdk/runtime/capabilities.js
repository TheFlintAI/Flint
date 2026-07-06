/**
 * Capability proxies and fetch response adapter.
 *
 * Shell, FS, and Clipboard are proxied via RPC:
 *   $plugin.shell.exec(...) → call('shell.exec', ...)
 *
 * Network (fetch) returns a fetch-like Response object.
 */

import { call } from './transport.js'

// ── RPC proxy factory ──────────────────────────────────────────────────────

export function createProxy(ns) {
  return new Proxy({}, {
    get(_, method) {
      return typeof method === 'string'
        ? (...args) => call(ns + '.' + method, { args })
        : undefined
    }
  })
}

// ── Fetch response adapter ─────────────────────────────────────────────────

export function adaptResponse(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const status = typeof raw.statusCode === 'number' ? raw.statusCode : 0
  const headers = (raw.headers && typeof raw.headers === 'object') ? raw.headers : {}
  const body = typeof raw.body === 'string' ? raw.body : ''
  return {
    get status()  { return status },
    get headers() { return headers },
    text() { return Promise.resolve(body) },
    json() {
      return Promise.resolve().then(() => {
        if (!body) return null
        return JSON.parse(body)
      })
    }
  }
}
