import type { UnifiedMessage, ContentBlock, TextBlock, ThinkingBlock } from '@/lib/api/types'
import type { ChatStore } from '../chat-store'
import { getTaskByIdFromState, bumpMessageRevision } from './task-helpers'
import { dbFlushMessage } from './stream-persistence'

// --- RAF-batched streaming delta buffer ---
// Multiple tokens arrive per animation frame; batching them into a single
// set() call reduces Zustand/React re-renders from ~100/s to ≤60/s.

export type StreamDelta =
  | { kind: 'text'; taskId: string; msgId: string; text: string }
  | { kind: 'thinking'; taskId: string; msgId: string; thinking: string }

export const _pendingStreamDeltas: StreamDelta[] = []
export let _streamDeltaRafId: number | null = null
// Assigned after useChatStore is created (avoids temporal dead zone).
export let _scheduleStreamDeltaFlush: () => void = () => {}
export const _streamingBackfillBlockedTaskIds = new Set<string>()

export function setScheduleStreamDeltaFlush(fn: () => void): void {
  _scheduleStreamDeltaFlush = fn
}

export function setStreamDeltaRafId(id: number | null): void {
  _streamDeltaRafId = id
}

export function initStreamFlush(
  getState: () => ChatStore,
  setState: (recipe: (state: ChatStore) => void) => void
): void {
  _scheduleStreamDeltaFlush = () => {
    if (_streamDeltaRafId !== null) return
    _streamDeltaRafId = requestAnimationFrame(() =>
      flushStreamDeltas(getState, setState)
    )
  }
}

export function stripThinkTagMarkers(text: string): string {
  return text.replace(/<\s*\/?\s*think\s*>/gi, '')
}

export function backfillStreamingMessage(
  state: { activeTaskId: string | null; streamingMessageId: string | null; streamingMessages: Record<string, string> },
  taskId: string,
  msgId: string
): void {
  if (_streamingBackfillBlockedTaskIds.has(taskId)) return
  if (state.streamingMessages[taskId] !== msgId) {
    state.streamingMessages[taskId] = msgId
  }
  if (taskId === state.activeTaskId && state.streamingMessageId !== msgId) {
    state.streamingMessageId = msgId
  }
}

export function groupStreamDeltasByTask(deltas: StreamDelta[]): Map<string, StreamDelta[]> {
  const byTask = new Map<string, StreamDelta[]>()
  for (const delta of deltas) {
    let arr = byTask.get(delta.taskId)
    if (!arr) {
      arr = []
      byTask.set(delta.taskId, arr)
    }
    arr.push(delta)
  }
  return byTask
}

export function applyStreamDeltas(
  byTask: Map<string, StreamDelta[]>,
  affectedMessages: Array<{ taskId: string; msgId: string }>,
  setState: (recipe: (state: ChatStore) => void) => void
): void {
  setState((state) => {
    const now = Date.now()
    for (const [taskId, taskDeltas] of byTask) {
      const task = getTaskByIdFromState(state, taskId)
      if (!task) continue

      const msgMap = new Map<string, UnifiedMessage>()
      for (const msg of task.messages) msgMap.set(msg.id, msg)

      for (const delta of taskDeltas) {
        const msg = msgMap.get(delta.msgId)
        if (!msg) continue
        backfillStreamingMessage(state, taskId, delta.msgId)

        if (delta.kind === 'text') {
          if (typeof msg.content === 'string') {
            msg.content += delta.text
          } else {
            const blocks = msg.content as ContentBlock[]
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock?.type === 'text') {
              ;(lastBlock as TextBlock).text += delta.text
            } else {
              blocks.push({ type: 'text', text: delta.text })
            }
          }
        } else {
          if (typeof msg.content === 'string') {
            msg.content = [{ type: 'thinking', thinking: delta.thinking, startedAt: now }]
          } else {
            const blocks = msg.content as ContentBlock[]
            let target: ThinkingBlock | null = null
            for (let i = blocks.length - 1; i >= 0; i--) {
              const b = blocks[i]
              if (b.type === 'thinking' && !(b as ThinkingBlock).completedAt) {
                target = b as ThinkingBlock
                break
              }
            }
            if (target) {
              target.thinking = stripThinkTagMarkers(`${target.thinking}${delta.thinking}`)
            } else {
              blocks.push({ type: 'thinking', thinking: delta.thinking, startedAt: now })
            }
          }
        }

        bumpMessageRevision(msg)
        affectedMessages.push({ taskId, msgId: delta.msgId })
      }
    }
  })
}

export function persistAffectedMessages(
  affectedMessages: Array<{ taskId: string; msgId: string }>,
  getState: () => ChatStore
): void {
  if (affectedMessages.length === 0) return

  const state = getState()
  const seen = new Set<string>()
  for (const { taskId, msgId } of affectedMessages) {
    const key = `${taskId} ${msgId}`
    if (seen.has(key)) continue
    seen.add(key)
    const task = getTaskByIdFromState(state, taskId)
    if (!task) continue
    const msg = task.messages.find((m) => m.id === msgId)
    if (msg) dbFlushMessage(taskId, msg, getState)
  }
}

export function flushPendingStreamDeltasForMessage(
  taskId: string,
  msgId: string,
  getState: () => ChatStore,
  setState: (recipe: (state: ChatStore) => void) => void
): void {
  if (_pendingStreamDeltas.length === 0) return

  const matching: StreamDelta[] = []
  for (let index = _pendingStreamDeltas.length - 1; index >= 0; index -= 1) {
    const delta = _pendingStreamDeltas[index]
    if (delta.taskId !== taskId || delta.msgId !== msgId) continue
    matching.push(delta)
    _pendingStreamDeltas.splice(index, 1)
  }

  if (matching.length === 0) return

  matching.reverse()
  const affectedMessages: Array<{ taskId: string; msgId: string }> = []
  applyStreamDeltas(groupStreamDeltasByTask(matching), affectedMessages, setState)
  persistAffectedMessages(affectedMessages, getState)
}

export function flushStreamDeltas(
  getState: () => ChatStore,
  setState: (recipe: (state: ChatStore) => void) => void
): void {
  _streamDeltaRafId = null
  if (_pendingStreamDeltas.length === 0) return

  const deltas = _pendingStreamDeltas.splice(0)
  const affectedMessages: Array<{ taskId: string; msgId: string }> = []
  applyStreamDeltas(groupStreamDeltasByTask(deltas), affectedMessages, setState)
  persistAffectedMessages(affectedMessages, getState)
}
