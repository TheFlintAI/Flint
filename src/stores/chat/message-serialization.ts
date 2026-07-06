import { nanoid } from 'nanoid'
import type { UnifiedMessage, ContentBlock } from '@/lib/api/types'
import type { Task } from './types'
import { sanitizeMessageContentForPersistence } from './persistence'

// --- Serialization / deserialization ---

const MESSAGE_WINDOW_MAX_SIZE = 240
const MESSAGE_WINDOW_TAIL_PRESERVE = 80

export interface TaskRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  working_folder: string | null
  ssh_connection_id?: string | null
  plan_id?: string | null
  pinned: number
  message_count?: number
  plugin_id?: string | null
  external_chat_id?: string | null
  provider_id?: string | null
  model_id?: string | null
}

interface MessageRow {
  id: string
  task_id: string
  role: string
  content: string
  meta: string | null
  created_at: number
  usage: string | null
  sort_order: number
}

export function rowToTask(row: TaskRow, messages: UnifiedMessage[] = []): Task {
  const messageCount = row.message_count ?? messages.length
  const loadedRangeEnd = messages.length > 0 ? messageCount : 0
  const loadedRangeStart = Math.max(0, loadedRangeEnd - messages.length)
  return {
    id: row.id,
    title: row.title,
    messages,
    messageCount,
    messagesLoaded: messages.length > 0 || messageCount === 0,
    loadedRangeStart,
    loadedRangeEnd,
    lastKnownMessageCount: messageCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workingFolder: row.working_folder ?? undefined,
    sshConnectionId: row.ssh_connection_id ?? undefined,
    planId: row.plan_id ?? undefined,
    pinned: row.pinned === 1,
    providerId: row.provider_id ?? undefined,
    modelId: row.model_id ?? undefined
  }
}

export function mergeTaskSummary(
  task: Task,
  next: Task,
  options?: { preserveLoadedMessages?: boolean }
): void {
  const preserveLoadedMessages = options?.preserveLoadedMessages === true
  const messageCountChanged = task.messageCount !== next.messageCount

  // Preserve AI-generated titles when the sync snapshot is stale
  // (e.g. local title was updated by generateTaskTitle but the DB event
  // still carries the untitled default).
  const isLocalTitleAiGenerated = task.title !== ''
  const isSyncTitleDefault = next.title === ''
  if (!(isLocalTitleAiGenerated && isSyncTitleDefault)) {
    task.title = next.title
  }
  task.createdAt = next.createdAt
  task.updatedAt = next.updatedAt
  task.workingFolder = next.workingFolder
  task.sshConnectionId = next.sshConnectionId
  task.planId = next.planId
  task.pinned = next.pinned
  task.providerId = next.providerId
  task.modelId = next.modelId
  // When preserveLoadedMessages is true the in-memory state may already be
  // ahead of the DB snapshot (e.g. beginUserTurn appended messages that the
  // fire-and-forget persist hasn't landed yet). Accepting a stale lower count
  // would wipe those resident messages and leave MessageList empty.
  if (preserveLoadedMessages && next.messageCount < task.messageCount) {
    return
  }

  task.messageCount = next.messageCount

  if (next.messageCount === 0) {
    task.messages = []
    task.messagesLoaded = true
    task.loadedRangeStart = 0
    task.loadedRangeEnd = 0
    task.lastKnownMessageCount = 0
    return
  }

  task.lastKnownMessageCount = next.messageCount

  if (messageCountChanged && !preserveLoadedMessages) {
    task.messages = []
    task.messagesLoaded = false
    task.loadedRangeStart = next.messageCount
    task.loadedRangeEnd = next.messageCount
    return
  }

  if (task.loadedRangeEnd > next.messageCount) {
    task.loadedRangeEnd = next.messageCount
  }
  if (task.loadedRangeStart > task.loadedRangeEnd) {
    task.loadedRangeStart = task.loadedRangeEnd
  }
}

export function rowToMessage(row: MessageRow): UnifiedMessage {
  let content: string | ContentBlock[]
  let meta: UnifiedMessage['meta']
  try {
    const parsed = JSON.parse(row.content)
    if (typeof parsed === 'string' || Array.isArray(parsed)) {
      content = parsed
    } else if (parsed == null) {
      content = ''
    } else {
      content = row.content
    }
  } catch {
    content = row.content
  }
  // Defensive: older DB rows may contain un-elided Write/Edit payloads written
  // before we lowered the inline limits. Strip them on load so the frontend
  // never has to hold a multi-MB tool_use.input in resident state.
  if (Array.isArray(content)) {
    content = sanitizeMessageContentForPersistence(content)
  }
  try {
    meta = row.meta ? (JSON.parse(row.meta) as UnifiedMessage['meta']) : undefined
  } catch {
    meta = undefined
  }
  return {
    id: row.id,
    role: row.role as UnifiedMessage['role'],
    content,
    ...(meta ? { meta } : {}),
    createdAt: row.created_at,
    usage: row.usage ? JSON.parse(row.usage) : undefined
  }
}

export function cloneMessagesForNewTask(messages: UnifiedMessage[]): UnifiedMessage[] {
  const cloned = JSON.parse(JSON.stringify(messages)) as UnifiedMessage[]
  return cloned.map((message) => {
    const next = {
      ...message,
      id: nanoid()
    }
    delete next._revision
    return next
  })
}

export function trimTaskMessageWindow(task: Task): void {
  if (task.messages.length <= MESSAGE_WINDOW_MAX_SIZE) return
  const removableCount = task.messages.length - MESSAGE_WINDOW_MAX_SIZE
  const maxRemovable = Math.max(0, task.messages.length - MESSAGE_WINDOW_TAIL_PRESERVE)
  const trimCount = Math.min(removableCount, maxRemovable)
  if (trimCount <= 0) return
  task.messages.splice(0, trimCount)
  task.loadedRangeStart = Math.min(task.messageCount, task.loadedRangeStart + trimCount)
}
