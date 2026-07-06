import { tauriCommands } from '@/services/tauri-api/command-client'
import { sanitizeMessagesForToolReplay } from '@/lib/tools/tool-input-sanitizer'
import type { UnifiedMessage } from '@/lib/api/types'
import type { Task } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('ChatStore')

// --- Queued fire-and-forget DB persistence ---

const _pendingTaskCreates = new Map<string, Promise<unknown>>()
const _taskMessageWriteQueues = new Map<string, Promise<void>>()
const _messageWriteGenerations = new Map<string, number>()
const _pendingMessageWriteCounts = new Map<string, number>()

export function getMessageWriteGeneration(taskId: string): number {
  return _messageWriteGenerations.get(taskId) ?? 0
}

export function bumpMessageWriteGeneration(taskId: string): void {
  _messageWriteGenerations.set(taskId, getMessageWriteGeneration(taskId) + 1)
}

export function hasPendingMessageWrite(messageId: string): boolean {
  return _pendingMessageWriteCounts.has(messageId)
}

export function trackPendingMessageWrite(messageIds: string[], pending: Promise<void>): void {
  for (const messageId of messageIds) {
    _pendingMessageWriteCounts.set(messageId, (_pendingMessageWriteCounts.get(messageId) ?? 0) + 1)
  }
  void pending.finally(() => {
    for (const messageId of messageIds) {
      const nextCount = (_pendingMessageWriteCounts.get(messageId) ?? 1) - 1
      if (nextCount > 0) {
        _pendingMessageWriteCounts.set(messageId, nextCount)
      } else {
        _pendingMessageWriteCounts.delete(messageId)
      }
    }
  })
}

export function enqueueTaskMessageWrite(
  taskId: string,
  write: () => Promise<unknown>,
  expectedGeneration?: number
): Promise<void> {
  const previous = _taskMessageWriteQueues.get(taskId) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      if (
        expectedGeneration !== undefined &&
        getMessageWriteGeneration(taskId) !== expectedGeneration
      ) {
        return
      }

      await (_pendingTaskCreates.get(taskId) ?? Promise.resolve()).catch(() => {})

      if (
        expectedGeneration !== undefined &&
        getMessageWriteGeneration(taskId) !== expectedGeneration
      ) {
        return
      }

      await write()
    })
    .catch(() => {})

  _taskMessageWriteQueues.set(taskId, next)
  void next.finally(() => {
    if (_taskMessageWriteQueues.get(taskId) === next) {
      _taskMessageWriteQueues.delete(taskId)
    }
  })
  return next
}

// --- DB CRUD operations ---

export function dbCreateTask(s: Task): void {
  const pending = tauriCommands
    .invoke('db:tasks:create', {
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      workingFolder: s.workingFolder,
      sshConnectionId: s.sshConnectionId,
      planId: s.planId,
      pinned: s.pinned,
      providerId: s.providerId,
      modelId: s.modelId
    })
    .catch(() => {})
    .finally(() => {
      if (_pendingTaskCreates.get(s.id) === pending) {
        _pendingTaskCreates.delete(s.id)
      }
    })

  _pendingTaskCreates.set(s.id, pending)
}

export function dbUpdateTask(id: string, patch: Record<string, unknown>): void {
  tauriCommands.invoke('db:tasks:update', { id, patch }).catch(() => {})
}

export function dbDeleteTask(id: string): void {
  bumpMessageWriteGeneration(id)
  enqueueTaskMessageWrite(id, () => tauriCommands.invoke('db:tasks:delete', id))
}

export function sanitizeMessageContentForPersistence(
  content: UnifiedMessage['content']
): UnifiedMessage['content'] {
  if (!Array.isArray(content)) return content
  const [sanitized] = sanitizeMessagesForToolReplay([{ role: 'assistant', content }]) as Array<{
    role: string
    content: UnifiedMessage['content']
  }>
  return sanitized.content
}

export function dbAddMessage(taskId: string, msg: UnifiedMessage, sortOrder: number): void {
  const generation = getMessageWriteGeneration(taskId)
  const pending = enqueueTaskMessageWrite(
    taskId,
    () =>
      tauriCommands.invoke('db:messages:add', {
        id: msg.id,
        taskId,
        role: msg.role,
        content: JSON.stringify(sanitizeMessageContentForPersistence(msg.content)),
        meta: msg.meta ? JSON.stringify(msg.meta) : null,
        createdAt: msg.createdAt,
        usage: msg.usage ? JSON.stringify(msg.usage) : null,
        sortOrder
      }),
    generation
  )
  trackPendingMessageWrite([msg.id], pending)
}

export function dbAddMessageBatch(
  taskId: string,
  items: Array<{ msg: UnifiedMessage; sortOrder: number }>
): void {
  if (items.length === 0) return
  const generation = getMessageWriteGeneration(taskId)
  const pending = enqueueTaskMessageWrite(
    taskId,
    () =>
      tauriCommands.invoke(
        'db:messages:add-batch',
        items.map(({ msg, sortOrder }) => ({
          id: msg.id,
          taskId,
          role: msg.role,
          content: JSON.stringify(sanitizeMessageContentForPersistence(msg.content)),
          meta: msg.meta ? JSON.stringify(msg.meta) : null,
          createdAt: msg.createdAt,
          usage: msg.usage ? JSON.stringify(msg.usage) : null,
          sortOrder
        }))
      ),
    generation
  )
  trackPendingMessageWrite(
    items.map(({ msg }) => msg.id),
    pending
  )
}

export function resolveMessageSortOrder(
  task: Pick<Task, 'messages' | 'loadedRangeStart' | 'messageCount'> | undefined,
  msgId: string,
  fallback = 0
): number {
  if (!task) return Math.max(0, fallback)
  const index = task.messages.findIndex((message) => message.id === msgId)
  if (index >= 0) return Math.max(0, task.loadedRangeStart + index)
  return Math.max(0, task.messageCount - 1, fallback)
}

export function dbUpsertMessage(
  taskId: string,
  msg: UnifiedMessage,
  sortOrder: number,
  expectedGeneration = getMessageWriteGeneration(taskId)
): void {
  const normalizedContent =
    typeof msg.content === 'string' || Array.isArray(msg.content)
      ? sanitizeMessageContentForPersistence(msg.content)
      : msg.content
  const pending = enqueueTaskMessageWrite(
    taskId,
    () =>
      tauriCommands.invoke('db:messages:upsert', {
        id: msg.id,
        taskId,
        role: msg.role,
        content: JSON.stringify(normalizedContent),
        meta: msg.meta ? JSON.stringify(msg.meta) : null,
        createdAt: msg.createdAt,
        usage: msg.usage ? JSON.stringify(msg.usage) : null,
        sortOrder
      }),
    expectedGeneration
  )
  trackPendingMessageWrite([msg.id], pending)
}

export function dbClearMessages(taskId: string): void {
  bumpMessageWriteGeneration(taskId)
  enqueueTaskMessageWrite(taskId, () => tauriCommands.invoke('db:messages:clear', taskId))
}

export function dbTruncateMessagesFrom(taskId: string, fromSortOrder: number): void {
  bumpMessageWriteGeneration(taskId)
  enqueueTaskMessageWrite(taskId, () =>
    tauriCommands.invoke('db:messages:truncate-from', { taskId, fromSortOrder })
  )
}
