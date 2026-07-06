import type { AgentLifecycleEvent } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('AgentEventBus')

type AgentEventListener = (event: AgentLifecycleEvent) => void

/**
 * Central agent lifecycle event bus.
 * The agent loop dispatches events here; plugins subscribe via the plugin store.
 */
class AgentEventBus {
  private listeners: Set<AgentEventListener> = new Set()

  /** Register a listener. Returns an unsubscribe function. */
  register(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Dispatch an event to all registered listeners. */
  dispatch(event: AgentLifecycleEvent): void {
    if (this.listeners.size === 0) return
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        log.error('Event listener error:', err)
      }
    }
  }
}

export const agentEvents = new AgentEventBus()
