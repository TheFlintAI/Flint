/**
 * Message transport layer between Web Worker (plugin) and main thread (host).
 *
 * Provides postMessage-based request/response + event pub/sub.
 * All communication is serialized as JSON.
 */

// ── State ──────────────────────────────────────────────────────────────────

let nextId = 0
const pending = new Map()
const listeners = new Map()

// ── Outgoing ───────────────────────────────────────────────────────────────

function sendMsg(msg) {
  self.postMessage(msg)
}

/** One-way notification to host (no response expected). */
export function post(method, params) {
  sendMsg({ type: 'notify', method, params })
}

/** RPC call to host — returns a promise that resolves with the response. */
export function call(method, params) {
  const id = String(++nextId)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    sendMsg({ type: 'request', id, method, params })
  })
}

// ── Outgoing responses ─────────────────────────────────────────────────────

/** Reply to a host request with a success result. */
export function reply(id, result) {
  sendMsg({ type: 'response', id, result })
}

/** Reject a host request with an error. */
export function reject(id, code, message) {
  sendMsg({ type: 'response', id, error: { code, message } })
}

// ── Event pub/sub ──────────────────────────────────────────────────────────

/** Subscribe to events from the host. Returns a disposable handle. */
export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, [])
  listeners.get(event).push(cb)
  return {
    dispose() {
      const cbs = listeners.get(event)
      if (cbs) {
        const i = cbs.indexOf(cb)
        if (i >= 0) cbs.splice(i, 1)
      }
    }
  }
}

function emit(event, data) {
  const cbs = listeners.get(event)
  if (cbs) for (const cb of cbs) { try { cb(data) } catch (_) {} }
}

// ── Incoming message handler ───────────────────────────────────────────────

export function setupTransport(dispatch) {
  self.onmessage = (e) => {
    const msg = e.data
    if (!msg || typeof msg !== 'object') return

    // Response to a pending outgoing request
    if (msg.type === 'response' && msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject: rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(msg.error.message || 'RPC error'))
      else resolve(msg.result)
      return
    }

    // Incoming request from host
    if (msg.type === 'request' && msg.method && msg.id !== undefined) {
      dispatch(msg)
      return
    }

    // Event from host (hook events, settings changes, etc.)
    if (msg.type === 'event' && msg.event) {
      emit(msg.event, msg.data)
      return
    }

    // Notification from host (log relay, settings changed, etc.)
    if (msg.type === 'notify' && msg.method) {
      emit(msg.method, msg.params)
      return
    }
  }
}
