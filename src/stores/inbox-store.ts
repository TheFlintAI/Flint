import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import type { UnifiedMessage } from '@/lib/api/types'

const MAX_BUFFERED_ADDED_MESSAGES = 200

export type PendingInboxItemType =
  | 'ask_user'
  | 'approval'
  | 'preview_ready'
  | 'desktop_control'
  | 'foreground_bash'
  | 'error'

export interface PendingInboxPreviewTarget {
  kind: 'file'
  filePath: string
  viewMode: 'preview' | 'code'
  sshConnectionId?: string
}

export interface PendingInboxItem {
  id: string
  taskId: string
  type: PendingInboxItemType
  title: string
  description?: string
  toolUseId?: string
  createdAt: number
  resolvedAt?: number
  target?: PendingInboxPreviewTarget
}

/**
 * Buffered state for a task whose UI is not currently visible.
 *
 * Structure:
 * - `patchedMessagesById`: in-place modifications of messages that already existed
 *   in chat-store when streaming started (or could be seeded from chat-store on demand).
 * - `addedMessagesById` + `addedMessageIds`: brand-new messages created by the agent
 *   while the task was in the background. The ordered id array preserves insertion
 *   order for deterministic replay when the task is brought back to the foreground.
 *
 * Refactored from the previous design (which used JSON.parse(JSON.stringify(msg))
 * for every delta and had O(n) findIndex on every append) to use Immer's structural
 * sharing and Record lookups, removing the per-delta GC pressure entirely.
 */
export interface InboxBufferedTaskState {
  patchedMessagesById: Record<string, UnifiedMessage>
  addedMessagesById: Record<string, UnifiedMessage>
  addedMessageIds: string[]
  unreadCount: number
  lastEventAt: number | null
}

interface InboxStore {
  tasks: Record<string, InboxBufferedTaskState>
  inboxItems: PendingInboxItem[]
  unreadCountsByTask: Record<string, number>
  blockedCountsByTask: Record<string, number>
  ensureTaskState: (taskId: string) => void
  /**
   * Insert a message into the buffer as either a patched clone (of an existing chat-store
   * message) or a brand-new added message. No-op if the message id is already buffered.
   */
  seedBufferedMessage: (
    taskId: string,
    message: UnifiedMessage,
    kind: 'patched' | 'added'
  ) => void
  /**
   * Locate a buffered message (patched or added) and apply the mutator in-place via Immer.
   * If the message isn't in the buffer yet, a seed is created using `seedResolver` — which
   * is called with no access to chat-store here to avoid a cyclic import. Callers are
   * responsible for passing a resolver that can look up the current chat-store snapshot.
   * If `seedResolver` returns undefined, an empty assistant placeholder is created so the
   * mutation is never silently dropped.
   */
  mutateBufferedMessageInPlace: (
    taskId: string,
    messageId: string,
    seedResolver: () => UnifiedMessage | undefined,
    mutator: (message: UnifiedMessage) => void
  ) => void
  /**
   * Queue a buffered mutation to be applied in the next microtask, coalescing multiple
   * mutations into a single Immer produce. Use `flushPendingMutationsNow()` to drain
   * the queue synchronously (e.g. before taking a snapshot).
   */
  queueBufferedMutation: (
    taskId: string,
    messageId: string,
    seedResolver: () => UnifiedMessage | undefined,
    mutator: (message: UnifiedMessage) => void
  ) => void
  flushPendingMutationsNow: () => void
  /**
   * Atomically clear and return the buffered state for a taskItem. Used when flushing
   * the buffer back to the chat-store so that any deltas arriving during the flush go
   * to the new foreground path (chat-store) instead of being overwritten by the flush.
   */
  takeTaskSnapshot: (taskId: string) => InboxBufferedTaskState | null
  markTaskUpdate: (taskId: string) => void
  clearBufferedTask: (taskId: string) => void
  addInboxItem: (item: Omit<PendingInboxItem, 'id' | 'createdAt'> & { id?: string }) => string
  resolveInboxItem: (itemId: string) => void
  resolveInboxItemByToolUseId: (toolUseId: string) => void
  clearTask: (taskId: string) => void
}

function createEmptyTaskState(): InboxBufferedTaskState {
  return {
    patchedMessagesById: {},
    addedMessagesById: {},
    addedMessageIds: [],
    unreadCount: 0,
    lastEventAt: null
  }
}

function incrementBlockedCount(
  counts: Record<string, number>,
  taskId: string,
  type: PendingInboxItemType
): void {
  if (type === 'error') return
  counts[taskId] = (counts[taskId] ?? 0) + 1
}

function decrementBlockedCount(
  counts: Record<string, number>,
  taskId: string,
  type: PendingInboxItemType
): void {
  if (type === 'error') return
  const next = (counts[taskId] ?? 1) - 1
  if (next <= 0) {
    delete counts[taskId]
  } else {
    counts[taskId] = next
  }
}

function isSamePreviewTarget(
  left?: PendingInboxPreviewTarget,
  right?: PendingInboxPreviewTarget
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.kind === right.kind &&
    left.filePath === right.filePath &&
    left.viewMode === right.viewMode &&
    left.sshConnectionId === right.sshConnectionId
  )
}

/**
 * Structured clone of a message. Used sparingly — only when seeding the buffer from a
 * chat-store message (so subsequent mutations don't leak into the foreground) and when
 * taking a snapshot for flush. The per-delta mutation path goes through Immer and does
 * NOT clone.
 */
function cloneMessageStructured(message: UnifiedMessage): UnifiedMessage {
  if (typeof structuredClone === 'function') {
    return structuredClone(message)
  }
  return JSON.parse(JSON.stringify(message)) as UnifiedMessage
}

// --- Microtask-coalesced mutation queue ---
// Background mutations arrive per-delta (~33 ms each). Queueing them and flushing in a
// single Immer produce per microtask reduces Zustand set() calls by 3-6x during streaming.
interface PendingBgMutation {
  taskId: string
  messageId: string
  seedResolver: () => UnifiedMessage | undefined
  mutator: (message: UnifiedMessage) => void
}
const _pendingBgMutations: PendingBgMutation[] = []
let _bgMutationScheduled = false

function applyMutationBatch(
  state: { tasks: Record<string, InboxBufferedTaskState> },
  batch: PendingBgMutation[]
): void {
  for (const { taskId, messageId, seedResolver, mutator } of batch) {
    const taskItem = (state.tasks[taskId] ??= createEmptyTaskState())

    const patched = taskItem.patchedMessagesById[messageId]
    if (patched) {
      mutator(patched)
      continue
    }

    const added = taskItem.addedMessagesById[messageId]
    if (added) {
      mutator(added)
      continue
    }

    const seed = seedResolver()
    const cloned: UnifiedMessage = seed
      ? cloneMessageStructured(seed)
      : { id: messageId, role: 'assistant', content: [], createdAt: Date.now() }
    taskItem.patchedMessagesById[messageId] = cloned
    mutator(cloned)
  }
}

export const useInboxStore = create<InboxStore>()(
  immer((set, get) => ({
    tasks: {},
    inboxItems: [],
    unreadCountsByTask: {},
    blockedCountsByTask: {},

    ensureTaskState: (taskId) => {
      set((state) => {
        state.tasks[taskId] ??= createEmptyTaskState()
      })
    },

    seedBufferedMessage: (taskId, message, kind) => {
      set((state) => {
        const taskItem = (state.tasks[taskId] ??= createEmptyTaskState())
        if (kind === 'patched') {
          if (taskItem.patchedMessagesById[message.id]) return
          taskItem.patchedMessagesById[message.id] = cloneMessageStructured(message)
          return
        }
        // kind === 'added'
        if (taskItem.addedMessagesById[message.id]) return
        taskItem.addedMessagesById[message.id] = cloneMessageStructured(message)
        taskItem.addedMessageIds.push(message.id)
        if (taskItem.addedMessageIds.length > MAX_BUFFERED_ADDED_MESSAGES) {
          const overflow = taskItem.addedMessageIds.length - MAX_BUFFERED_ADDED_MESSAGES
          const removed = taskItem.addedMessageIds.splice(0, overflow)
          for (const id of removed) {
            delete taskItem.addedMessagesById[id]
          }
        }
      })
    },

    mutateBufferedMessageInPlace: (taskId, messageId, seedResolver, mutator) => {
      set((state) => {
        const taskItem = (state.tasks[taskId] ??= createEmptyTaskState())

        // 1. Already buffered as a patch — mutate in place.
        const patched = taskItem.patchedMessagesById[messageId]
        if (patched) {
          mutator(patched)
          return
        }

        // 2. Already buffered as an added message — mutate in place.
        const added = taskItem.addedMessagesById[messageId]
        if (added) {
          mutator(added)
          return
        }

        // 3. Need to seed. Prefer resolver-provided snapshot (usually from chat-store).
        //    If the message isn't resolvable anywhere, create an empty placeholder so
        //    deltas are never silently dropped — they'll be merged back as a new message
        //    when the task flushes to the foreground.
        const seed = seedResolver()
        const cloned: UnifiedMessage = seed
          ? cloneMessageStructured(seed)
          : {
              id: messageId,
              role: 'assistant',
              content: [],
              createdAt: Date.now()
            }
        taskItem.patchedMessagesById[messageId] = cloned
        mutator(cloned)
      })
    },

    queueBufferedMutation: (taskId, messageId, seedResolver, mutator) => {
      _pendingBgMutations.push({ taskId, messageId, seedResolver, mutator })
      if (!_bgMutationScheduled) {
        _bgMutationScheduled = true
        queueMicrotask(() => {
          _bgMutationScheduled = false
          if (_pendingBgMutations.length === 0) return
          const batch = _pendingBgMutations.splice(0)
          set((state) => {
            applyMutationBatch(state, batch)
          })
        })
      }
    },

    flushPendingMutationsNow: () => {
      _bgMutationScheduled = false
      if (_pendingBgMutations.length === 0) return
      const batch = _pendingBgMutations.splice(0)
      set((state) => {
        applyMutationBatch(state, batch)
      })
    },

    takeTaskSnapshot: (taskId) => {
      get().flushPendingMutationsNow()
      const taskItem = get().tasks[taskId]
      if (!taskItem) return null

      // Take a structural snapshot BEFORE mutating state, so what we return is stable.
      const snapshot: InboxBufferedTaskState = {
        patchedMessagesById: { ...taskItem.patchedMessagesById },
        addedMessagesById: { ...taskItem.addedMessagesById },
        addedMessageIds: [...taskItem.addedMessageIds],
        unreadCount: taskItem.unreadCount,
        lastEventAt: taskItem.lastEventAt
      }

      set((state) => {
        delete state.tasks[taskId]
        delete state.unreadCountsByTask[taskId]
      })

      return snapshot
    },

    markTaskUpdate: (taskId) => {
      set((state) => {
        const taskItem =
          state.tasks[taskId] ?? (state.tasks[taskId] = createEmptyTaskState())
        const nextUnread = taskItem.unreadCount + 1
        taskItem.unreadCount = nextUnread
        taskItem.lastEventAt = Date.now()
        state.unreadCountsByTask[taskId] = nextUnread
      })
    },

    clearBufferedTask: (taskId) => {
      set((state) => {
        if (!state.tasks[taskId]) return
        delete state.tasks[taskId]
        delete state.unreadCountsByTask[taskId]
      })
    },

    addInboxItem: (item) => {
      const toolUseId = item.toolUseId?.trim() || undefined
      const taskId = item.taskId
      const type = item.type
      const title = item.title.trim()

      if (!taskId || !title) return ''

      const existing = get().inboxItems.find(
        (candidate) =>
          candidate.taskId === taskId &&
          candidate.type === type &&
          ((toolUseId && candidate.toolUseId === toolUseId) ||
            (!toolUseId &&
              candidate.title === title &&
              candidate.description === item.description &&
              isSamePreviewTarget(candidate.target, item.target)))
      )
      if (existing) return existing.id

      const nextId = item.id?.trim() || nanoid()
      set((state) => {
        state.inboxItems.unshift({
          id: nextId,
          taskId,
          type,
          title,
          ...(item.description ? { description: item.description } : {}),
          ...(toolUseId ? { toolUseId } : {}),
          ...(item.target ? { target: item.target } : {}),
          createdAt: Date.now()
        })
        incrementBlockedCount(state.blockedCountsByTask, taskId, type)
      })
      return nextId
    },

    resolveInboxItem: (itemId) => {
      if (!itemId) return
      set((state) => {
        const idx = state.inboxItems.findIndex((candidate) => candidate.id === itemId)
        if (idx === -1) return
        const item = state.inboxItems[idx]
        if (item.resolvedAt) return
        state.inboxItems.splice(idx, 1)
        decrementBlockedCount(state.blockedCountsByTask, item.taskId, item.type)
      })
    },

    resolveInboxItemByToolUseId: (toolUseId) => {
      if (!toolUseId) return
      set((state) => {
        const remaining: PendingInboxItem[] = []
        for (const item of state.inboxItems) {
          if (item.toolUseId === toolUseId && !item.resolvedAt) {
            decrementBlockedCount(state.blockedCountsByTask, item.taskId, item.type)
          } else {
            remaining.push(item)
          }
        }
        state.inboxItems = remaining
      })
    },

    clearTask: (taskId) => {
      set((state) => {
        delete state.tasks[taskId]
        delete state.unreadCountsByTask[taskId]
        state.inboxItems = state.inboxItems.filter((item) => item.taskId !== taskId)
        delete state.blockedCountsByTask[taskId]
      })
    }
  }))
)
