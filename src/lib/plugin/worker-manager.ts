/**
 * Plugin Worker Manager — creates and manages Web Workers for plugins.
 *
 * Each enabled plugin runs in a Web Worker. Communication is via postMessage
 * with a simple RPC protocol (structured clone compatible).
 */

import type { VNode } from '@/lib/plugin/vnode-types'
import type { LocalizedString } from '@/lib/localized-string'
import type { AgentLifecycleEvent } from '@/lib/agent/events/types'
import type {
  PluginMessage,
  PluginRequest,
  PluginResponse,
  PluginEvent,
} from '@/lib/plugin/plugin-protocol'

// Pending RPC

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

// Worker handle

export interface WorkerHandle {
  worker: Worker
  ready: boolean
  eventSubscriptions: Set<string>
  views: Map<string, { label: LocalizedString; icon: string }>
  pendingRequests: Map<string, PendingRequest>
}

// Handler types

export type MessageHandler = (pluginId: string, msg: PluginMessage) => void
export type ReadyHandler = (pluginId: string) => void
export type ErrorHandler = (pluginId: string, error: string) => void

// WorkerManager

export class WorkerManager {
  private workers = new Map<string, WorkerHandle>()
  private onMessage: MessageHandler
  private onReady: ReadyHandler
  private onError: ErrorHandler
  private runtimeJs: string | null = null

  constructor(handlers: {
    onMessage: MessageHandler
    onReady: ReadyHandler
    onError: ErrorHandler
  }) {
    this.onMessage = handlers.onMessage
    this.onReady = handlers.onReady
    this.onError = handlers.onError
  }

  // Shared runtime

  /** Set the shared runtime JS. Must be called once before creating workers. */
  setRuntime(runtimeJs: string): void {
    this.runtimeJs = runtimeJs
  }

  // Lifecycle

  /** Create a Worker for a plugin. Terminates any existing worker first. */
  create(pluginId: string, pluginJs: string): WorkerHandle {
    this.terminate(pluginId)

    // Concatenate shared runtime + plugin code
    const fullJs = this.runtimeJs
      ? this.runtimeJs + '\n' + pluginJs
      : pluginJs

    const blob = new Blob(
      [fullJs],
      { type: 'application/javascript' }
    )
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url, { name: pluginId })

    const handle: WorkerHandle = {
      worker,
      ready: false,
      eventSubscriptions: new Set(),
      views: new Map(),
      pendingRequests: new Map(),
    }

    worker.onmessage = (e: MessageEvent<PluginMessage>) => {
      const msg = e.data
      if (!msg || typeof msg !== 'object') return

      // Dispatch to the main message handler
      this.onMessage(pluginId, msg)

      // Resolve pending RPC if this is a response
      if (msg.type === 'response' && handle.pendingRequests.has(msg.id)) {
        const { resolve, reject } = handle.pendingRequests.get(msg.id)!
        handle.pendingRequests.delete(msg.id)
        if (msg.error) {
          reject(new Error(msg.error.message || 'RPC error'))
        } else {
          resolve(msg.result)
        }
      }
    }

    worker.onerror = (e) => {
      const message = e.message || 'Unknown Worker error'
      console.error(`[WorkerManager] Plugin "${pluginId}" error:`, message)
      this.onError(pluginId, message)
    }

    this.workers.set(pluginId, handle)
    // Revoke after worker has fetched the blob (next tick)
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return handle
  }

  /** Terminate a plugin's Worker. Rejects all pending requests. */
  terminate(pluginId: string): void {
    const handle = this.workers.get(pluginId)
    if (!handle) return

    for (const [, pending] of handle.pendingRequests) {
      pending.reject(new Error('Plugin terminated'))
    }
    handle.pendingRequests.clear()

    handle.worker.terminate()
    this.workers.delete(pluginId)
  }

  /** Terminate all workers and clean up state. */
  dispose(): void {
    for (const [pluginId] of this.workers) {
      this.terminate(pluginId)
    }
    this.workers.clear()
  }

  // State

  markReady(pluginId: string): void {
    const handle = this.workers.get(pluginId)
    if (handle) {
      handle.ready = true
      this.onReady(pluginId)
    }
  }

  get(pluginId: string): WorkerHandle | undefined {
    return this.workers.get(pluginId)
  }

  // Subscriptions

  addEventSubscription(pluginId: string, event: string): void {
    this.workers.get(pluginId)?.eventSubscriptions.add(event)
  }

  // Views

  registerView(pluginId: string, id: string, label: LocalizedString, icon: string): void {
    const handle = this.workers.get(pluginId)
    if (handle) handle.views.set(id, { label, icon })
  }

  getViews(pluginId: string): Array<{ id: string; label: LocalizedString; icon: string }> {
    const handle = this.workers.get(pluginId)
    if (!handle) return []
    return Array.from(handle.views.entries()).map(([id, view]) => ({ id, ...view }))
  }

  // Outgoing messages

  /** Send an RPC request to a plugin and await the response. */
  sendRequest(pluginId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const handle = this.workers.get(pluginId)
    if (!handle) return Promise.reject(new Error(`Plugin "${pluginId}" not running`))

    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      handle.pendingRequests.set(id, { resolve, reject })
      const msg: PluginRequest = { type: 'request', id, method, params }
      handle.worker.postMessage(msg)
    })
  }

  /** Send a response to a pending plugin request. */
  sendResponse(pluginId: string, id: string, result: unknown): void {
    const handle = this.workers.get(pluginId)
    if (!handle) return
    const msg: PluginResponse = { type: 'response', id, result }
    handle.worker.postMessage(msg)
  }

  /** Send an error response to a pending plugin request. */
  sendError(pluginId: string, id: string, code: number, message: string): void {
    const handle = this.workers.get(pluginId)
    if (!handle) return
    const msg: PluginResponse = { type: 'response', id, error: { code, message } }
    handle.worker.postMessage(msg)
  }

  /** Send an event to a plugin (only if subscribed). */
  sendEvent(pluginId: string, event: string, data: unknown): void {
    const handle = this.workers.get(pluginId)
    if (!handle) return
    if (!handle.eventSubscriptions.has(event) && !handle.eventSubscriptions.has('*')) return
    const msg: PluginEvent = { type: 'event', event, data }
    handle.worker.postMessage(msg)
  }

  /** Broadcast an agent lifecycle event to all subscribed plugins. */
  dispatchEvent(event: AgentLifecycleEvent): void {
    for (const [pluginId, handle] of this.workers) {
      if (!handle.ready) continue
      if (handle.eventSubscriptions.has(event.type) || handle.eventSubscriptions.has('*')) {
        const msg: PluginEvent = { type: 'event', event: 'agent-event', data: event }
        handle.worker.postMessage(msg)
      }
    }
  }

  // View rendering

  async renderView(pluginId: string, viewId: string): Promise<VNode | null> {
    try {
      const vnode = await this.sendRequest(pluginId, 'view.render', { viewId })
      return vnode as VNode
    } catch {
      return null
    }
  }
}
