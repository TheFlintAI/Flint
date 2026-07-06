import type { AgentStreamEnvelope, AgentStreamEvent } from '@/protocols/agent-stream-protocol'
import { AGENT_STREAM_PROTOCOL_VERSION } from '@/protocols/agent-stream-protocol'
import { tauriCommands } from './command-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('AgentStream')

type RunEventCallback = (event: AgentStreamEvent) => void
type GlobalEventCallback = (runId: string, taskId: string, event: AgentStreamEvent) => void

export class AgentStreamReceiver {
  private runHandlers = new Map<string, Set<RunEventCallback>>()
  private globalHandlers = new Set<GlobalEventCallback>()
  private lastSeqByRun = new Map<string, number>()
  private attached = false

  attach(): void {
    if (this.attached) return
    this.attached = true

    tauriCommands.on('agent:stream', (envelope: AgentStreamEnvelope) => {
      if (envelope.v !== AGENT_STREAM_PROTOCOL_VERSION) {
        log.warn('Unknown protocol version', envelope.v)
        return
      }

      const lastSeq = this.lastSeqByRun.get(envelope.runId) ?? -1
      if (envelope.seq > lastSeq + 1) {
        log.warn(
          `[AgentStream] Gap detected for run ${envelope.runId}: expected ${lastSeq + 1}, got ${envelope.seq}`
        )
      }
      this.lastSeqByRun.set(envelope.runId, envelope.seq)

      for (const event of envelope.events) {
        this.dispatch(envelope.runId, envelope.taskId, event)
      }

      if (envelope.events.some((e) => e.type === 'loop_end' || e.type === 'error')) {
        this.lastSeqByRun.delete(envelope.runId)
      }
    })
  }

  get isAttached(): boolean {
    return this.attached
  }

  subscribe(runId: string, callback: RunEventCallback): () => void {
    let handlers = this.runHandlers.get(runId)
    if (!handlers) {
      handlers = new Set()
      this.runHandlers.set(runId, handlers)
    }
    handlers.add(callback)

    return () => {
      handlers!.delete(callback)
      if (handlers!.size === 0) {
        this.runHandlers.delete(runId)
      }
    }
  }

  subscribeAll(callback: GlobalEventCallback): () => void {
    this.globalHandlers.add(callback)
    return () => {
      this.globalHandlers.delete(callback)
    }
  }

  notifyTaskVisibility(taskId: string, visible: boolean): void {
    tauriCommands.send('agent:task-visibility', { taskId, visible })
  }

  private dispatch(runId: string, taskId: string, event: AgentStreamEvent): void {
    const handlers = this.runHandlers.get(runId)
    if (handlers) {
      for (const handler of handlers) {
        handler(event)
      }
    }

    for (const handler of this.globalHandlers) {
      handler(runId, taskId, event)
    }
  }
}

export const agentStream = new AgentStreamReceiver()
