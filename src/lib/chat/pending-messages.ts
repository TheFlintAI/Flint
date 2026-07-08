import { nanoid } from 'nanoid'
import {
  cloneImageAttachments,
  type EditableUserMessageDraft,
  type ImageAttachment
} from '@/lib/chat/image-attachments'

// Types

export type MessageSource = 'team' | 'queued' | 'continue'

export interface SendMessageOptions {
  longRunningMode?: boolean
  clearCompletedTasksOnTurnStart?: boolean
  /** Number of file references in the user message, for context snapshot */
  fileCount?: number
  /** Workspace folder path to set on the task before sending */
  workspace?: string
}

export interface QueuedTaskMessage {
  id: string
  text: string
  images?: ImageAttachment[]
  source?: MessageSource
  options?: SendMessageOptions
  createdAt: number
}

export interface PendingTaskMessageItem {
  id: string
  text: string
  images: ImageAttachment[]
  createdAt: number
}

// Module-level state

/** Per-task pending user sends while the agent is already running. */
const pendingTaskMessages = new Map<string, QueuedTaskMessage[]>()
const pendingTaskMessageViews = new Map<string, PendingTaskMessageItem[]>()
const pendingTaskMessageListeners = new Set<() => void>()
const pausedPendingTaskDispatch = new Set<string>()

export const QUEUED_MESSAGE_SYSTEM_REMIND = `<system-reminder>
A new user message was queued while you were still processing the previous request.
This message was inserted after that run finished.
Treat the following user query as the latest instruction and respond to it directly.
</system-reminder>`

const EMPTY_PENDING_TASK_MESSAGES: PendingTaskMessageItem[] = []

// Internal helpers

export function cloneOptionalImageAttachments(images?: ImageAttachment[]): ImageAttachment[] | undefined {
  const cloned = cloneImageAttachments(images)
  return cloned.length > 0 ? cloned : undefined
}

function notifyPendingTaskMessageListeners(): void {
  for (const listener of pendingTaskMessageListeners) {
    listener()
  }
}

export function setPendingTaskDispatchPaused(taskId: string, paused: boolean): void {
  const changed = paused
    ? !pausedPendingTaskDispatch.has(taskId)
    : pausedPendingTaskDispatch.has(taskId)
  if (!changed) return

  if (paused) {
    pausedPendingTaskDispatch.add(taskId)
  } else {
    pausedPendingTaskDispatch.delete(taskId)
  }
  notifyPendingTaskMessageListeners()
}

function toPendingItem(msg: QueuedTaskMessage): PendingTaskMessageItem {
  return {
    id: msg.id,
    text: msg.text,
    images: cloneImageAttachments(msg.images),
    createdAt: msg.createdAt
  }
}

export function replaceTaskPendingMessages(taskId: string, next: QueuedTaskMessage[]): void {
  if (next.length === 0) {
    pendingTaskMessages.delete(taskId)
    pendingTaskMessageViews.delete(taskId)
    pausedPendingTaskDispatch.delete(taskId)
  } else {
    pendingTaskMessages.set(taskId, next)
    pendingTaskMessageViews.set(taskId, next.map(toPendingItem))
  }
  notifyPendingTaskMessageListeners()
}

// Queue operations

export function enqueuePendingTaskMessage(
  taskId: string,
  msg: Omit<QueuedTaskMessage, 'id' | 'createdAt'>
): number {
  const queue = pendingTaskMessages.get(taskId) ?? []
  const next = [
    ...queue,
    {
      id: nanoid(),
      createdAt: Date.now(),
      text: msg.text,
      images: cloneOptionalImageAttachments(msg.images),
      source: msg.source,
      options: msg.options ? { ...msg.options } : undefined
    }
  ]
  replaceTaskPendingMessages(taskId, next)
  return next.length
}

export function dequeuePendingTaskMessage(taskId: string): QueuedTaskMessage | null {
  const queue = pendingTaskMessages.get(taskId)
  if (!queue || queue.length === 0) return null
  const [head, ...rest] = queue
  replaceTaskPendingMessages(taskId, rest)
  return {
    ...head,
    text: head.text,
    images: cloneOptionalImageAttachments(head.images),
    options: head.options ? { ...head.options } : undefined
  }
}

export function hasPendingTaskMessages(taskId: string): boolean {
  const queue = pendingTaskMessages.get(taskId)
  return !!queue && queue.length > 0
}

// Public API

export function subscribePendingTaskMessages(listener: () => void): () => void {
  pendingTaskMessageListeners.add(listener)
  return () => {
    pendingTaskMessageListeners.delete(listener)
  }
}

export function getPendingTaskMessages(taskId: string): PendingTaskMessageItem[] {
  return pendingTaskMessageViews.get(taskId) ?? EMPTY_PENDING_TASK_MESSAGES
}

export function getPendingTaskMessageCountForTask(taskId: string): number {
  return pendingTaskMessages.get(taskId)?.length ?? 0
}

export function isPendingTaskDispatchPaused(taskId: string): boolean {
  return pausedPendingTaskDispatch.has(taskId)
}

export function clearPendingTaskMessages(taskId: string): number {
  const cleared = pendingTaskMessages.get(taskId)?.length ?? 0
  if (cleared === 0) {
    setPendingTaskDispatchPaused(taskId, false)
    return 0
  }
  replaceTaskPendingMessages(taskId, [])
  return cleared
}

export function updatePendingTaskMessageDraft(
  taskId: string,
  messageId: string,
  draft: EditableUserMessageDraft
): boolean {
  const queue = pendingTaskMessages.get(taskId)
  if (!queue || queue.length === 0) return false
  let changed = false
  const next = queue.map((msg) => {
    if (msg.id !== messageId) return msg
    changed = true
    return {
      ...msg,
      text: draft.text,
      images: cloneOptionalImageAttachments(draft.images)
    }
  })
  if (!changed) return false
  replaceTaskPendingMessages(taskId, next)
  return true
}

export function removePendingTaskMessage(taskId: string, messageId: string): boolean {
  const queue = pendingTaskMessages.get(taskId)
  if (!queue || queue.length === 0) return false
  const next = queue.filter((msg) => msg.id !== messageId)
  if (next.length === queue.length) return false
  replaceTaskPendingMessages(taskId, next)
  return true
}

export function hasPendingTaskMessagesForTask(taskId: string): boolean {
  return hasPendingTaskMessages(taskId)
}
