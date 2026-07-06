import type { UnifiedMessage } from '@/lib/api/types'
import type { ChatStore } from '../chat-store'
import { getTaskByIdFromState } from './task-helpers'
import { dbUpsertMessage, dbAddMessageBatch, resolveMessageSortOrder } from './persistence'
import { createLogger } from '@/lib/logger'

const log = createLogger('ChatStore')

// --- Debounced message persistence for streaming ---

export const STREAMING_PERIODIC_FLUSH_MS = 1_000

export const _pendingFlush = new Map<string, ReturnType<typeof setTimeout>>()
export const _streamingDirtyMessageIds = new Set<string>()
export const _activeStreamingMessageIds = new Set<string>()

const _streamingFlushIntervals = new Map<string, ReturnType<typeof setInterval>>()

export function startStreamingPeriodicFlush(
  taskId: string,
  msgId: string,
  getState: () => ChatStore
): void {
  stopStreamingPeriodicFlush(taskId)
  const intervalId = setInterval(() => {
    const task = getTaskByIdFromState(getState(), taskId)
    const msg = task?.messages.find((m) => m.id === msgId)
    if (msg) {
      dbUpsertMessage(taskId, msg, resolveMessageSortOrder(task, msgId))
    }
  }, STREAMING_PERIODIC_FLUSH_MS)
  _streamingFlushIntervals.set(taskId, intervalId)
}

export function stopStreamingPeriodicFlush(taskId: string): void {
  const intervalId = _streamingFlushIntervals.get(taskId)
  if (intervalId) {
    clearInterval(intervalId)
    _streamingFlushIntervals.delete(taskId)
  }
}

export const _deferredMessageAdds: Array<{
  taskId: string
  msg: UnifiedMessage
  sortOrder: number
}> = []

export function clearDeferredMessageAdds(taskId: string, fromSortOrder = 0): void {
  for (let i = _deferredMessageAdds.length - 1; i >= 0; i--) {
    const entry = _deferredMessageAdds[i]
    if (entry.taskId === taskId && entry.sortOrder >= fromSortOrder) {
      _deferredMessageAdds.splice(i, 1)
    }
  }
}

export function flushDeferredMessageAdds(taskId: string): void {
  const toFlush: typeof _deferredMessageAdds = []
  for (let i = _deferredMessageAdds.length - 1; i >= 0; i--) {
    if (_deferredMessageAdds[i].taskId === taskId) {
      toFlush.push(_deferredMessageAdds[i])
      _deferredMessageAdds.splice(i, 1)
    }
  }
  if (toFlush.length === 0) return
  toFlush.reverse()
  dbAddMessageBatch(
    taskId,
    toFlush.map(({ msg, sortOrder }) => ({ msg, sortOrder }))
  )
}

export function dbFlushMessage(
  taskId: string,
  msg: UnifiedMessage,
  getState: () => ChatStore
): void {
  if (_activeStreamingMessageIds.has(msg.id)) {
    _streamingDirtyMessageIds.add(msg.id)
    return
  }
  const key = msg.id
  const existing = _pendingFlush.get(key)
  if (existing) clearTimeout(existing)
  _pendingFlush.set(
    key,
    setTimeout(() => {
      _pendingFlush.delete(key)
      const task = getTaskByIdFromState(getState(), taskId)
      dbUpsertMessage(taskId, msg, resolveMessageSortOrder(task, msg.id))
    }, 2000)
  )
}

export function dbFlushMessageImmediate(
  taskId: string,
  msg: UnifiedMessage,
  getState: () => ChatStore
): void {
  if (_activeStreamingMessageIds.has(msg.id)) {
    _streamingDirtyMessageIds.add(msg.id)
    return
  }
  const existing = _pendingFlush.get(msg.id)
  if (existing) {
    clearTimeout(existing)
    _pendingFlush.delete(msg.id)
  }
  const task = getTaskByIdFromState(getState(), taskId)
  dbUpsertMessage(taskId, msg, resolveMessageSortOrder(task, msg.id))
}

export function clearPendingMessageFlushes(messageIds: string[]): void {
  for (const messageId of messageIds) {
    const pending = _pendingFlush.get(messageId)
    if (!pending) continue
    clearTimeout(pending)
    _pendingFlush.delete(messageId)
  }
}
