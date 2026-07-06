import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import type {
  UnifiedMessage,
  ContentBlock,
  ImageBlock,
  ThinkingBlock,
  ToolUseBlock
} from '../lib/api/types'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { useAgentStore } from './agent-store'
import { useTeamStore } from './team-store'
import { useTodoStore } from './todo-store'
import { usePlanStore } from './plan-store'
import { useUIStore } from './ui-store'
import { useInboxStore } from './inbox-store'
import { useProviderStore } from './provider-store'
import { useInputDraftStore } from './input-draft-store'
import { invalidateVisibleTaskCache } from '../lib/agent/task-runtime-router'
import { agentStream } from '@/services/tauri-api/agent-stream-events'
import { parseChatRoute } from '../lib/chat-route'
import { summarizeToolInputForHistory } from '../lib/tools/tool-input-sanitizer'
import type {
  Task,
  TaskPromptSnapshot,
  ImageGenerationTiming,
  CreateTaskOptions
} from './chat/types'
import {
  bumpMessageWriteGeneration,
  enqueueTaskMessageWrite,
  dbCreateTask,
  dbUpdateTask,
  dbDeleteTask,
  sanitizeMessageContentForPersistence,
  dbAddMessage,
  dbAddMessageBatch,
  resolveMessageSortOrder,
  dbUpsertMessage,
  dbClearMessages,
  dbTruncateMessagesFrom
} from './chat/persistence'
import { flushDb } from '@/lib/db/json-store'
import { createLogger } from '@/lib/logger'
import i18n from '@/locales'

const log = createLogger('ChatStore')

// Sentinel for a task that has no user/AI-assigned title yet. Stored empty so
// the displayed placeholder can be localized at render time without persisting
// a specific language in the DB.
const UNTITLED_TASK_TITLE = ''
import {
  syncTasksById,
  getTaskByIdFromState,
  dedupeTasksById,
  MESSAGE_LOAD_SNAPSHOT_TAIL_SIZE,
  matchesMessageLoadSnapshot,
  bumpMessageRevision
} from './chat/task-helpers'

// --- Streaming persistence ---
import {
  _streamingDirtyMessageIds,
  _activeStreamingMessageIds,
  startStreamingPeriodicFlush,
  stopStreamingPeriodicFlush,
  _deferredMessageAdds,
  clearDeferredMessageAdds,
  flushDeferredMessageAdds,
  dbFlushMessage,
  dbFlushMessageImmediate,
  clearPendingMessageFlushes
} from './chat/stream-persistence'

// --- RAF delta flush ---
import {
  _pendingStreamDeltas,
  _scheduleStreamDeltaFlush,
  _streamingBackfillBlockedTaskIds,
  stripThinkTagMarkers,
  backfillStreamingMessage,
  flushPendingStreamDeltasForMessage,
  initStreamFlush
} from './chat/stream-flush'

// --- Message serialization ---
import {
  rowToTask,
  mergeTaskSummary,
  rowToMessage,
  cloneMessagesForNewTask,
  trimTaskMessageWindow,
  type TaskRow
} from './chat/message-serialization'

// --- Message loading ---
import {
  MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE,
  loadRequestContextMessages,
  mergeLoadedMessagesWithResident,
  releaseDormantTaskMemory
} from './chat/message-loading'

// --- Message sanitization ---
import {
  isToolResultOnlyUserMessage,
  sanitizeToolBlocksForResend
} from './chat/message-sanitization'

// --- Local helpers (kept here because they depend on module-scoped streaming state) ---

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

// Initial tail shown the instant the user switches into a task. Small on
// purpose so the switch renders in ~1 frame. Older history streams in via
// the scroll-to-top load-more row.
const INITIAL_TASK_DISPLAY_PAGE_SIZE = 20
const RECENT_TASK_MESSAGE_PAGE_SIZE = 40

function cloneImportedMessages(messages: UnifiedMessage[] | undefined): UnifiedMessage[] {
  const source = Array.isArray(messages) ? messages : []
  return cloneMessagesForNewTask(source)
}

function hasMeaningfulAssistantContent(message: UnifiedMessage): boolean {
  if (message.role !== 'assistant') return true
  if (typeof message.content === 'string') return message.content.trim().length > 0
  if (!Array.isArray(message.content)) return false

  return message.content.some((block) => {
    switch (block.type) {
      case 'text':
        return block.text.trim().length > 0
      case 'thinking':
        return block.thinking.trim().length > 0 || !!block.encryptedContent
      case 'tool_use':
      case 'image':
      case 'image_error':
      case 'agent_error':
        return true
      default:
        return false
    }
  })
}

// --- Store ---

export interface ChatStore {
  tasks: Task[]
  /**
   * taskId -> index into `tasks`. Maintained by syncTasksById whenever the tasks
   * array shape changes. Enables O(1) per-task lookups (hot path: flushStreamDeltas,
   * MessageList selector), replacing previous O(n) tasks.find() scans.
   */
  tasksById: Record<string, number>
  activeTaskId: string | null
  _loaded: boolean

  // Initialization
  loadFromDb: () => Promise<void>
  loadRecentTaskMessages: (taskId: string, force?: boolean, limit?: number) => Promise<void>
  loadOlderTaskMessages: (taskId: string, limit?: number) => Promise<number>
  loadTaskMessages: (taskId: string, force?: boolean) => Promise<void>
  loadWindowTaskMessages: (taskId: string, offset: number, limit: number) => Promise<void>
  getTaskMessagesForRequest: (
    taskId: string,
    options?: {
      includeTrailingAssistantPlaceholder?: boolean
      requestContextMaxMessages?: number | null
    }
  ) => Promise<UnifiedMessage[]>
  // Task CRUD
  createTask: (options?: CreateTaskOptions) => string
  deleteTask: (id: string) => void
  setActiveTask: (id: string | null) => void
  updateTaskTitle: (id: string, title: string) => void
  setWorkingFolder: (taskId: string, folder: string) => void
  updateTaskModel: (taskId: string, providerId: string, modelId: string) => void
  clearTaskModelBinding: (taskId: string) => void
  setTaskPlanId: (taskId: string, planId: string | null) => void
  setTaskPromptSnapshot: (taskId: string, snapshot: TaskPromptSnapshot) => void
  clearTaskPromptSnapshot: (taskId: string) => void
  clearTaskMessages: (taskId: string) => void
  duplicateTask: (taskId: string) => Promise<string | null>
  forkTaskFromMessage: (taskId: string, messageId: string) => Promise<string | null>
  togglePinTask: (taskId: string) => void
  restoreTask: (task: Task) => void
  importTask: (task: Task) => string
  importTasks: (tasks: Task[]) => string
  upsertTaskFromSync: (
    row: TaskRow,
    options?: { preserveLoadedMessages?: boolean }
  ) => void
  removeTaskFromSync: (taskId: string) => void
  removeLastAssistantMessage: (taskId: string) => boolean
  removeLastUserMessage: (taskId: string) => void
  truncateMessagesFrom: (taskId: string, fromIndex: number) => void
  replaceTaskMessages: (taskId: string, messages: UnifiedMessage[]) => void
  sanitizeToolErrorsForResend: (taskId: string) => void
  stripOldSystemReminders: (taskId: string) => void

  // Message operations
  addMessage: (taskId: string, msg: UnifiedMessage) => void
  beginUserTurn: (
    taskId: string,
    userMsg: UnifiedMessage | null,
    assistantMsg: UnifiedMessage | null,
    streamingMessageId: string | null
  ) => void
  updateMessage: (taskId: string, msgId: string, patch: Partial<UnifiedMessage>) => void
  appendTextDelta: (taskId: string, msgId: string, text: string) => void
  appendThinkingDelta: (taskId: string, msgId: string, thinking: string) => void
  setThinkingEncryptedContent: (
    taskId: string,
    msgId: string,
    encryptedContent: string,
    provider: 'anthropic' | 'openai-responses' | 'google'
  ) => void
  completeThinking: (taskId: string, msgId: string) => void
  appendToolUse: (taskId: string, msgId: string, toolUse: ToolUseBlock) => void
  updateToolUseInput: (
    taskId: string,
    msgId: string,
    toolUseId: string,
    input: Record<string, unknown>
  ) => void
  appendContentBlock: (taskId: string, msgId: string, block: ContentBlock) => void

  /**
   * Atomically merge a background-task snapshot into the foreground chat-store.
   * Called by flushBackgroundTaskToForeground after a task is brought back to the front.
   * Handles both patched (existing message updates) and added (new messages) without relying
   * on the loaded window — if a patched message isn't currently resident, it's inserted as new.
   */
  applyBackgroundSnapshot: (
    taskId: string,
    snapshot: {
      patchedMessagesById: Record<string, UnifiedMessage>
      addedMessagesById: Record<string, UnifiedMessage>
      addedMessageIds: string[]
    }
  ) => void

  // Streaming state (per-task)
  streamingMessageId: string | null
  /** Per-task streaming message map — allows concurrent agents across tasks */
  streamingMessages: Record<string, string>
  setStreamingMessageId: (taskId: string, id: string | null) => void
  /** Image generation state (per-message) - using Record instead of Set for Immer compatibility */
  generatingImageMessages: Record<string, boolean>
  imageGenerationTimings: Record<string, ImageGenerationTiming>
  generatingImagePreviews: Record<string, ImageBlock>
  setGeneratingImage: (msgId: string, generating: boolean, occurredAt?: number) => void
  setGeneratingImagePreview: (msgId: string, preview: ImageBlock | null) => void

  // Helpers
  getActiveTask: () => Task | undefined
  getLatestTaskByPlanId: (planId: string) => Task | undefined
  getTaskMessages: (taskId: string) => UnifiedMessage[]
  recoverFromWebviewOom: (taskId?: string | null) => Promise<void>
  releaseDormantTasks: () => void
}

export const useChatStore = create<ChatStore>()(
  immer((set, get) => ({
    tasks: [],
    tasksById: {},
    activeTaskId: null,
    streamingMessageId: null,
    streamingMessages: {},
    generatingImageMessages: {},
    imageGenerationTimings: {},
    generatingImagePreviews: {},
    _loaded: false,

    loadRecentTaskMessages: async (taskId, force = false, limit) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task) return
      const knownCount = task.messageCount ?? task.messages.length
      const taskTailMessageIds = task.messages
        .slice(-MESSAGE_LOAD_SNAPSHOT_TAIL_SIZE)
        .map((message) => message.id)
      const requestedLimit = Math.max(
        MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE,
        Math.min(
          limit ?? MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE,
          knownCount || MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE
        )
      )
      if (!force && task.messagesLoaded && task.messages.length > 0) {
        const loadedAtTail = task.loadedRangeEnd === knownCount
        if (loadedAtTail && task.messages.length >= requestedLimit) return
      }
      // The DB task row's message_count may be stale (e.g. 0 when messages exist)
      // because dbUpdateTask never writes message_count. Always verify against
      // the actual messages table before deciding the task is empty.
      let effectiveKnownCount = knownCount
      if (knownCount === 0) {
        const actualCount = (await tauriCommands.invoke('db:messages:count', taskId)) as number
        if (actualCount === 0) {
          set((state) => {
            const target = state.tasks.find((s) => s.id === taskId)
            if (!target) return
            target.messages = []
            target.messagesLoaded = true
            target.messageCount = 0
            target.loadedRangeStart = 0
            target.loadedRangeEnd = 0
            target.lastKnownMessageCount = 0
          })
          return
        }
        effectiveKnownCount = actualCount
      }
      try {
        const fetchLimit = Math.max(
          MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE,
          Math.min(limit ?? INITIAL_TASK_DISPLAY_PAGE_SIZE, effectiveKnownCount)
        )
        let windowStart = Math.max(0, effectiveKnownCount - fetchLimit)
        let msgRows = (await tauriCommands.invoke('db:messages:list-page', {
          taskId,
          limit: fetchLimit,
          offset: windowStart
        })) as MessageRow[]

        if (msgRows.length === 0 && effectiveKnownCount > 0) {
          const actualCount = (await tauriCommands.invoke('db:messages:count', taskId)) as number
          if (actualCount !== effectiveKnownCount) {
            effectiveKnownCount = actualCount
            windowStart = Math.max(0, effectiveKnownCount - fetchLimit)
            msgRows = (await tauriCommands.invoke('db:messages:list-page', {
              taskId,
              limit: fetchLimit,
              offset: windowStart
            })) as MessageRow[]
          }
        }

        let messages = msgRows.map(rowToMessage)
        let messageSortOrders = msgRows.map((row) => row.sort_order)

        while (
          windowStart > 0 &&
          messages.length > 0 &&
          messages.every((message) => isToolResultOnlyUserMessage(message))
        ) {
          const prependCount = Math.min(fetchLimit, windowStart)
          const prependOffset = Math.max(0, windowStart - prependCount)
          const prependRows = (await tauriCommands.invoke('db:messages:list-page', {
            taskId,
            limit: prependCount,
            offset: prependOffset
          })) as MessageRow[]
          const prependMessages = prependRows.map(rowToMessage)
          const prependSortOrders = prependRows.map((row) => row.sort_order)
          if (prependMessages.length === 0) break
          messages = [...prependMessages, ...messages]
          messageSortOrders = [...prependSortOrders, ...messageSortOrders]
          windowStart = prependOffset
        }

        const latestTask = get().tasks.find((s) => s.id === taskId)
        if (!matchesMessageLoadSnapshot(latestTask, knownCount, taskTailMessageIds)) {
          return
        }

        set((state) => {
          const target = state.tasks.find((s) => s.id === taskId)
          if (!target || !matchesMessageLoadSnapshot(target, knownCount, taskTailMessageIds)) {
            return
          }
          if (
            !force &&
            target.messagesLoaded &&
            target.loadedRangeStart === 0 &&
            target.loadedRangeEnd >= effectiveKnownCount &&
            target.messages.length >= effectiveKnownCount
          ) {
            return
          }
          const merged = mergeLoadedMessagesWithResident(
            target,
            messages,
            windowStart,
            Math.max(windowStart + messages.length, ...messageSortOrders.map((order) => order + 1)),
            effectiveKnownCount,
            messageSortOrders
          )
          target.messages = merged.messages
          target.messagesLoaded = true
          target.messageCount = merged.messageCount
          target.loadedRangeStart = merged.loadedRangeStart
          target.loadedRangeEnd = merged.loadedRangeEnd
          target.lastKnownMessageCount = merged.messageCount
        })
      } catch (err) {
        log.error('Failed to load recent task messages:', err)
      }
    },

    loadOlderTaskMessages: async (taskId, limit = RECENT_TASK_MESSAGE_PAGE_SIZE) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task) return 0
      if (!task.messagesLoaded) {
        await get().loadRecentTaskMessages(taskId)
      }
      const latest = get().tasks.find((s) => s.id === taskId)
      if (!latest) return 0
      const olderCount = Math.max(0, latest.loadedRangeStart)
      if (olderCount === 0) return 0
      const nextCount = Math.min(limit, olderCount)
      let offset = olderCount - nextCount
      try {
        const msgRows = (await tauriCommands.invoke('db:messages:list-page', {
          taskId,
          limit: nextCount,
          offset
        })) as MessageRow[]
        let olderMessages = msgRows.map(rowToMessage)

        while (
          offset > 0 &&
          olderMessages.length > 0 &&
          olderMessages.every((message) => isToolResultOnlyUserMessage(message))
        ) {
          const prependCount = Math.min(limit, offset)
          const prependOffset = Math.max(0, offset - prependCount)
          const prependRows = (await tauriCommands.invoke('db:messages:list-page', {
            taskId,
            limit: prependCount,
            offset: prependOffset
          })) as MessageRow[]
          const prependMessages = prependRows.map(rowToMessage)
          if (prependMessages.length === 0) break
          olderMessages = [...prependMessages, ...olderMessages]
          offset = prependOffset
        }

        if (olderMessages.length === 0) return 0
        set((state) => {
          const target = state.tasks.find((s) => s.id === taskId)
          if (!target) return
          const existingIds = new Set(target.messages.map((message) => message.id))
          const merged = olderMessages.filter((message) => !existingIds.has(message.id))
          if (merged.length === 0) return
          target.messages = [...merged, ...target.messages]
          target.messagesLoaded = true
          target.loadedRangeStart = offset
          target.loadedRangeEnd = Math.max(target.loadedRangeEnd, offset + target.messages.length)
          target.lastKnownMessageCount = target.messageCount
        })
        return olderMessages.length
      } catch (err) {
        log.error('Failed to load older task messages:', err)
        return 0
      }
    },

    loadTaskMessages: async (taskId, force = false) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task) return
      const knownCount = task.messageCount ?? task.messages.length
      const taskTailMessageIds = task.messages
        .slice(-MESSAGE_LOAD_SNAPSHOT_TAIL_SIZE)
        .map((message) => message.id)
      const shouldSkip =
        !force &&
        task.messagesLoaded &&
        task.loadedRangeStart === 0 &&
        knownCount <= task.messages.length
      if (shouldSkip) return
      try {
        const msgRows = (await tauriCommands.invoke('db:messages:list', taskId)) as MessageRow[]
        const messages = msgRows.map(rowToMessage)
        const messageSortOrders = msgRows.map((row) => row.sort_order)
        const latestTask = get().tasks.find((s) => s.id === taskId)
        if (!matchesMessageLoadSnapshot(latestTask, knownCount, taskTailMessageIds)) {
          return
        }
        set((state) => {
          const target = state.tasks.find((s) => s.id === taskId)
          if (!target || !matchesMessageLoadSnapshot(target, knownCount, taskTailMessageIds)) {
            return
          }
          const merged = mergeLoadedMessagesWithResident(
            target,
            messages,
            0,
            Math.max(messages.length, ...messageSortOrders.map((order) => order + 1)),
            messages.length,
            messageSortOrders
          )
          target.messages = merged.messages
          target.messagesLoaded = true
          target.messageCount = merged.messageCount
          target.loadedRangeStart = merged.loadedRangeStart
          target.loadedRangeEnd = merged.loadedRangeEnd
          target.lastKnownMessageCount = merged.messageCount
        })
      } catch (err) {
        log.error('Failed to load task messages:', err)
      }
    },

    loadWindowTaskMessages: async (taskId, offset, limit) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task) return
      const knownCount = task.messageCount ?? task.messages.length
      const taskTailMessageIds = task.messages
        .slice(-MESSAGE_LOAD_SNAPSHOT_TAIL_SIZE)
        .map((message) => message.id)
      const safeOffset = Math.max(0, offset)
      const safeLimit = Math.max(MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE, limit)
      try {
        const msgRows = (await tauriCommands.invoke('db:messages:list-page', {
          taskId,
          limit: safeLimit,
          offset: safeOffset
        })) as MessageRow[]
        const messages = msgRows.map(rowToMessage)
        const messageSortOrders = msgRows.map((row) => row.sort_order)
        const latestTask = get().tasks.find((s) => s.id === taskId)
        if (!matchesMessageLoadSnapshot(latestTask, knownCount, taskTailMessageIds)) {
          return
        }
        set((state) => {
          const target = state.tasks.find((s) => s.id === taskId)
          if (!target || !matchesMessageLoadSnapshot(target, knownCount, taskTailMessageIds)) {
            return
          }
          const merged = mergeLoadedMessagesWithResident(
            target,
            messages,
            safeOffset,
            Math.max(safeOffset + messages.length, ...messageSortOrders.map((order) => order + 1)),
            knownCount,
            messageSortOrders
          )
          target.messages = merged.messages
          target.messagesLoaded = true
          target.messageCount = merged.messageCount
          target.loadedRangeStart = merged.loadedRangeStart
          target.loadedRangeEnd = merged.loadedRangeEnd
          target.lastKnownMessageCount = merged.messageCount
        })
      } catch (err) {
        log.error('Failed to load window task messages:', err)
      }
    },

    getTaskMessagesForRequest: async (taskId, options) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task) return []
      const includeTrailingAssistantPlaceholder =
        options?.includeTrailingAssistantPlaceholder ?? true

      let messages = await loadRequestContextMessages(task, options?.requestContextMaxMessages)
      const sanitized = sanitizeToolBlocksForResend(messages)
      messages = sanitized.messages

      // Always strip empty assistant messages — they cause API errors ("must not be empty").
      // When includeTrailingAssistantPlaceholder is true we still keep a trailing assistant
      // message that has real content (used for the "continue" bubble path).
      messages = messages.filter((message, index) => {
        if (message.role !== 'assistant') return true
        if (hasMeaningfulAssistantContent(message)) return true
        // Keep a trailing assistant placeholder only when the caller explicitly opts in
        // (i.e. continuing on an existing bubble that already has content).
        if (includeTrailingAssistantPlaceholder && index === messages.length - 1) return true
        return false
      })

      return messages
    },

    loadFromDb: async () => {
      try {
        const isInitialLoad = !get()._loaded
        const initialRoute =
          isInitialLoad && typeof window !== 'undefined'
            ? parseChatRoute(window.location.hash)
            : null
        const taskRows = (await tauriCommands.invoke('db:tasks:list')) as TaskRow[]

        const tasks: Task[] = taskRows.map((row) => {
          const task = rowToTask(row, [])
          if (task.messageCount === 0) {
            task.messagesLoaded = true
            task.loadedRangeStart = 0
            task.loadedRangeEnd = 0
            task.lastKnownMessageCount = 0
          }
          return task
        })

        let nextActiveTaskId: string | null = null

        set((state) => {
          state.tasks = tasks
          syncTasksById(state)
          state._loaded = true

          const routeTaskId =
            initialRoute?.taskId &&
            tasks.some((task) => task.id === initialRoute.taskId)
              ? initialRoute.taskId
              : null
          const preservedActiveTaskId =
            state.activeTaskId &&
            tasks.some((task) => task.id === state.activeTaskId)
              ? state.activeTaskId
              : null

          nextActiveTaskId = isInitialLoad
            ? routeTaskId
            : (preservedActiveTaskId ?? tasks[0]?.id ?? null)
          state.activeTaskId = nextActiveTaskId
        })

        if (nextActiveTaskId) {
          const activeTask = tasks.find((s) => s.id === nextActiveTaskId)
          if (activeTask?.providerId && activeTask?.modelId) {
            const providerStore = useProviderStore.getState()
            if (activeTask.providerId !== providerStore.activeProviderId) {
              providerStore.setActiveProvider(activeTask.providerId)
            }
            if (activeTask.modelId !== providerStore.activeModelId) {
              providerStore.setActiveModel(activeTask.modelId)
            }
          }
          await get().loadRecentTaskMessages(nextActiveTaskId)

          void Promise.all([
            useTodoStore.getState().loadPlanItemsForTask(nextActiveTaskId),
            usePlanStore.getState().loadPlanForTask(nextActiveTaskId)
          ])
            .then(([, activePlan]) => {
              usePlanStore.getState().setActivePlan(activePlan?.id ?? null)
            })
            .catch((error) => {
              log.error('Failed to load active task extras:', error)
            })
        } else {
          useTodoStore.getState().clearPlanItems()
          usePlanStore.getState().setActivePlan(null)
        }
        useUIStore.getState().syncTaskScopedState(nextActiveTaskId)
        get().releaseDormantTasks()
      } catch (err) {
        log.error('Failed to load from DB:', err)
        set({ _loaded: true })
      }
    },

    createTask: (options) => {
      const id = nanoid()
      const now = Date.now()
      const { activeProviderId, activeModelId } = useProviderStore.getState()

      const taskProviderId = activeProviderId || undefined
      const taskModelId = activeModelId || undefined

      const newTask: Task = {
        id,
        title: UNTITLED_TASK_TITLE,
        messages: [],
        messageCount: 0,
        messagesLoaded: true,
        loadedRangeStart: 0,
        loadedRangeEnd: 0,
        lastKnownMessageCount: 0,
        createdAt: now,
        updatedAt: now,
        planId: options?.planId ?? undefined,
        providerId: taskProviderId,
        modelId: taskModelId
      }
      set((state) => {
        state.tasks.push(newTask)
        syncTasksById(state)
        state.activeTaskId = id
      })
      dbCreateTask(newTask)
      useTodoStore.getState().clearPlanItems()
      usePlanStore.getState().setActivePlan(null)
      useUIStore.getState().syncTaskScopedState(id)
      get().releaseDormantTasks()
      return id
    },

    deleteTask: (id) => {
      const deletedTask = get().tasks.find((task) => task.id === id)
      const wasActiveTask = get().activeTaskId === id
      const deletedStreamingMsgId = get().streamingMessages[id]
      let nextActiveId: string | null = null

      set((state) => {
        const idx = state.tasks.findIndex((s) => s.id === id)
        if (idx !== -1) {
          state.tasks.splice(idx, 1)
          syncTasksById(state)
        }

        if (wasActiveTask) {
          state.activeTaskId = null
        }

        nextActiveId = state.activeTaskId
        delete state.streamingMessages[id]
      })

      // Clean up deferred streaming state for deleted task
      if (deletedStreamingMsgId) {
        _activeStreamingMessageIds.delete(deletedStreamingMsgId)
        _streamingDirtyMessageIds.delete(deletedStreamingMsgId)
      }
      clearDeferredMessageAdds(id)

      const agentState = useAgentStore.getState()
      const wasLiveTask = agentState.liveTaskId === id
      agentState.setTaskStatus(id, null)
      agentState.purgeTaskData(id)
      useInboxStore.getState().clearTask(id)
      if (wasLiveTask) {
        agentState.resetLiveTaskExecution(id)
      }
      useTeamStore.getState().clearTaskTeam(id)
      const plan = usePlanStore.getState().getPlanByTask(id)
      if (plan) usePlanStore.getState().deletePlan(plan.id)
      useTodoStore.getState().deletePlanItemTasks(id)
      useInputDraftStore.getState().removeTaskDraft(id)
      clearPendingMessageFlushes(deletedTask?.messages.map((message) => message.id) ?? [])
      for (const messageId of deletedTask?.messages.map((message) => message.id) ?? []) {
        _streamingDirtyMessageIds.delete(messageId)
      }
      dbDeleteTask(id)

      if (wasLiveTask) {
        agentState.switchToolCallTask(null, nextActiveId)
      }

      if (nextActiveId) {
        void get()
          .loadRecentTaskMessages(nextActiveId)
          .finally(() => get().releaseDormantTasks())
        void useTodoStore.getState().loadPlanItemsForTask(nextActiveId)
        const planStore = usePlanStore.getState()
        void planStore.loadPlanForTask(nextActiveId).then((loadedPlan) => {
          if (useChatStore.getState().activeTaskId !== nextActiveId) return
          usePlanStore.getState().setActivePlan(loadedPlan?.id ?? null)
        })
      } else {
        useTodoStore.getState().clearPlanItems()
        usePlanStore.getState().setActivePlan(null)
      }
      useUIStore.getState().syncTaskScopedState(nextActiveId)
      if (wasActiveTask && !nextActiveId) {
        useUIStore.getState().navigateToHome()
      }
      get().releaseDormantTasks()
    },

    setActiveTask: (id) => {
      const prevId = get().activeTaskId
      invalidateVisibleTaskCache()
      if (prevId && prevId !== id) {
        agentStream.notifyTaskVisibility(prevId, false)
      }
      if (id) {
        agentStream.notifyTaskVisibility(id, true)
      }
      set((state) => {
        state.activeTaskId = id
        state.streamingMessageId = id ? (state.streamingMessages[id] ?? null) : null
      })
      useUIStore.getState().syncTaskScopedState(id)
      get().releaseDormantTasks()
      // Switch per-task tool calls in agent-store
      useAgentStore.getState().switchToolCallTask(prevId, id)
      // Restore per-task model selection to global provider store
      if (id) {
        const task = get().tasks.find((s) => s.id === id)
        if (task?.providerId && task?.modelId) {
          const providerStore = useProviderStore.getState()
          if (task.providerId !== providerStore.activeProviderId) {
            providerStore.setActiveProvider(task.providerId)
          }
          if (task.modelId !== providerStore.activeModelId) {
            providerStore.setActiveModel(task.modelId)
          }
        }
      }
      // Load tasks for the new task
      if (id) {
        void useTodoStore.getState().loadPlanItemsForTask(id)
        void get()
          .loadRecentTaskMessages(id)
          .finally(() => get().releaseDormantTasks())
        const planStore = usePlanStore.getState()
        const activePlan = planStore.getPlanByTask(id)
        planStore.setActivePlan(activePlan?.id ?? null)
        void planStore.loadPlanForTask(id).then((loadedPlan) => {
          if (useChatStore.getState().activeTaskId !== id) return
          usePlanStore.getState().setActivePlan(loadedPlan?.id ?? activePlan?.id ?? null)
        })
      } else {
        useTodoStore.getState().clearPlanItems()
        usePlanStore.getState().setActivePlan(null)
        usePlanStore.getState().releaseDormantPlans(null)
      }
    },

    updateTaskTitle: (id, title) => {
      const now = Date.now()
      set((state) => {
        const task = state.tasks.find((s) => s.id === id)
        if (task) {
          task.title = title
          task.updatedAt = now
        }
      })
      dbUpdateTask(id, { title, updatedAt: now })
    },

    setWorkingFolder: (taskId, folder) => {
      const task = get().tasks.find((item) => item.id === taskId)
      if (!task) return

      set((state) => {
        const target = state.tasks.find((item) => item.id === taskId)
        if (target) {
          target.workingFolder = folder
          delete target.promptSnapshot
          target.updatedAt = Date.now()
        }
      })
      dbUpdateTask(taskId, { workingFolder: folder, updatedAt: Date.now() })
    },

    updateTaskModel: (taskId, providerId, modelId) => {
      const now = Date.now()
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (task) {
          task.providerId = providerId
          task.modelId = modelId
          delete task.promptSnapshot
          task.updatedAt = now
        }
      })
      dbUpdateTask(taskId, { providerId, modelId, updatedAt: now })
    },

    clearTaskModelBinding: (taskId) => {
      const now = Date.now()
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (task) {
          delete task.providerId
          delete task.modelId
          delete task.promptSnapshot
          task.updatedAt = now
        }
      })
      dbUpdateTask(taskId, { providerId: null, modelId: null, updatedAt: now })
    },

    setTaskPlanId: (taskId, planId) => {
      const now = Date.now()
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (task) {
          task.planId = planId ?? undefined
          task.updatedAt = now
        }
      })
      dbUpdateTask(taskId, { planId, updatedAt: now })
    },

    setTaskPromptSnapshot: (taskId, snapshot) => {
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (!task) return
        task.promptSnapshot = {
          systemPrompt: snapshot.systemPrompt,
          toolDefs: snapshot.toolDefs.slice(),
          workingFolder: snapshot.workingFolder,
          sshConnectionId: snapshot.sshConnectionId,
          contextCacheKey: snapshot.contextCacheKey
        }
      })
    },

    clearTaskPromptSnapshot: (taskId) => {
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (!task?.promptSnapshot) return
        delete task.promptSnapshot
      })
    },

    togglePinTask: (taskId) => {
      let pinned = false
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (task) {
          task.pinned = !task.pinned
          pinned = task.pinned
        }
      })
      dbUpdateTask(taskId, { pinned })
    },

    restoreTask: (task) => {
      const normalizedTask: Task = {
        ...task,
        promptSnapshot: undefined,
        workingFolder: task.workingFolder,
        sshConnectionId: task.sshConnectionId,
        messageCount: task.messageCount ?? task.messages.length,
        messagesLoaded: task.messagesLoaded ?? true,
        loadedRangeStart: task.loadedRangeStart ?? 0,
        loadedRangeEnd: task.loadedRangeEnd ?? task.messages.length,
        lastKnownMessageCount:
          task.lastKnownMessageCount ?? task.messageCount ?? task.messages.length
      }
      set((state) => {
        state.tasks.push(normalizedTask)
        syncTasksById(state)
        state.activeTaskId = normalizedTask.id
      })
      dbCreateTask(normalizedTask)
      normalizedTask.messages.forEach((msg, i) => dbAddMessage(normalizedTask.id, msg, i))
      useTodoStore.getState().clearPlanItems()
      const activePlan = usePlanStore.getState().getPlanByTask(normalizedTask.id)
      usePlanStore.getState().setActivePlan(activePlan?.id ?? null)
      useUIStore.getState().syncTaskScopedState(normalizedTask.id)
    },

    importTask: (task) => {

      const importedMessages = cloneImportedMessages(task.messages)
      const normalizedTask: Task = {
        ...task,
        id: nanoid(),
        messages: importedMessages,
        messageCount: importedMessages.length,
        messagesLoaded: true,
        loadedRangeStart: 0,
        loadedRangeEnd: importedMessages.length,
        lastKnownMessageCount: importedMessages.length,
        promptSnapshot: undefined,
        workingFolder: task.workingFolder,
        sshConnectionId: task.sshConnectionId
      }

      set((state) => {
        state.tasks.push(normalizedTask)
        syncTasksById(state)
        state.activeTaskId = normalizedTask.id
      })
      dbCreateTask(normalizedTask)
      normalizedTask.messages.forEach((msg, i) => dbAddMessage(normalizedTask.id, msg, i))
      useTodoStore.getState().clearPlanItems()
      const activePlan = usePlanStore.getState().getPlanByTask(normalizedTask.id)
      usePlanStore.getState().setActivePlan(activePlan?.id ?? null)
      useUIStore.getState().syncTaskScopedState(normalizedTask.id)
      return normalizedTask.id
    },

    importTasks: (importedTasks) => {
      const importedIds: string[] = []
      for (const task of importedTasks) {
        const importedId = get().importTask(task)
        importedIds.push(importedId)
      }

      set((state) => {
        state.activeTaskId = importedIds[0] ?? state.activeTaskId
      })

      return importedIds[0] ?? ''
    },

    upsertTaskFromSync: (row, options) => {
      const syncedTask = rowToTask(row, [])
      const activeTaskId = get().activeTaskId

      set((state) => {
        const existing = dedupeTasksById(state, row.id)
        if (existing) {
          mergeTaskSummary(existing, syncedTask, options)
        } else {
          state.tasks.push(syncedTask)
          syncTasksById(state)
        }

        if (state.activeTaskId === row.id) {
          state.streamingMessageId = state.streamingMessages[row.id] ?? null
        }
      })

      if (activeTaskId === row.id && syncedTask.providerId && syncedTask.modelId) {
        const providerStore = useProviderStore.getState()
        if (providerStore.activeProviderId !== syncedTask.providerId) {
          providerStore.setActiveProvider(syncedTask.providerId)
        }
        if (providerStore.activeModelId !== syncedTask.modelId) {
          providerStore.setActiveModel(syncedTask.modelId)
        }
      }

      get().releaseDormantTasks()
    },

    removeTaskFromSync: (taskId) => {
      const deletedTask = get().tasks.find((task) => task.id === taskId)
      if (!deletedTask) return

      const wasActiveTask = get().activeTaskId === taskId

      set((state) => {
        state.tasks = state.tasks.filter((task) => task.id !== taskId)
        syncTasksById(state)

        if (wasActiveTask) {
          state.activeTaskId = null
        }

        delete state.streamingMessages[taskId]
        state.streamingMessageId = state.activeTaskId
          ? (state.streamingMessages[state.activeTaskId] ?? null)
          : null
      })

      bumpMessageWriteGeneration(taskId)
      clearDeferredMessageAdds(taskId)
      clearPendingMessageFlushes(deletedTask.messages.map((message) => message.id))
      for (const messageId of deletedTask.messages.map((message) => message.id)) {
        _streamingDirtyMessageIds.delete(messageId)
      }

      const agentState = useAgentStore.getState()
      const wasLiveTask = agentState.liveTaskId === taskId
      agentState.setTaskStatus(taskId, null)
      agentState.purgeTaskData(taskId)
      useInboxStore.getState().clearTask(taskId)
      if (wasLiveTask) {
        agentState.resetLiveTaskExecution(taskId)
        agentState.switchToolCallTask(taskId, null)
      }
      useTeamStore.getState().clearTaskTeam(taskId)
      const plan = usePlanStore.getState().getPlanByTask(taskId)
      if (plan) usePlanStore.getState().deletePlan(plan.id)
      useTodoStore.getState().deletePlanItemTasks(taskId)
      useInputDraftStore.getState().removeTaskDraft(taskId)
      clearPendingMessageFlushes(deletedTask.messages.map((message) => message.id))
      useUIStore.getState().syncTaskScopedState(useChatStore.getState().activeTaskId)

      if (wasActiveTask) {
        useTodoStore.getState().clearPlanItems()
        usePlanStore.getState().setActivePlan(null)

        useUIStore.getState().navigateToHome()
      }

      get().releaseDormantTasks()
    },

    clearTaskMessages: (taskId) => {
      const now = Date.now()
      const deletedMessageIds =
        get()
          .tasks.find((s) => s.id === taskId)
          ?.messages.map((message) => message.id) ?? []
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (task) {
          task.messages = []
          task.messageCount = 0
          task.messagesLoaded = true
          task.loadedRangeStart = 0
          task.loadedRangeEnd = 0
          task.lastKnownMessageCount = 0
          delete task.promptSnapshot
          task.updatedAt = now
        }
      })
      clearPendingMessageFlushes(deletedMessageIds)
      clearDeferredMessageAdds(taskId)
      for (const messageId of deletedMessageIds) {
        _streamingDirtyMessageIds.delete(messageId)
      }
      dbClearMessages(taskId)
      dbUpdateTask(taskId, { updatedAt: now, messageCount: 0 })
      useAgentStore.getState().purgeTaskData(taskId)
      useInboxStore.getState().clearTask(taskId)
      useAgentStore.getState().resetLiveTaskExecution(taskId)
      useTeamStore.getState().clearTaskTeam(taskId)
      const plan = usePlanStore.getState().getPlanByTask(taskId)
      if (plan) usePlanStore.getState().deletePlan(plan.id)
      useTodoStore.getState().deletePlanItemTasks(taskId)
      useInputDraftStore.getState().removeTaskDraft(taskId)
    },

    duplicateTask: async (taskId) => {
      await get().loadTaskMessages(taskId)
      const source = get().tasks.find((s) => s.id === taskId)
      if (!source) return null
      const newId = nanoid()
      const now = Date.now()
      const clonedMessages = cloneMessagesForNewTask(source.messages)
      const newTask: Task = {
        id: newId,
        title: source.title
          ? i18n.t('layout:sidebar.copyOf', { title: source.title })
          : UNTITLED_TASK_TITLE,
        messages: clonedMessages,
        messageCount: clonedMessages.length,
        messagesLoaded: true,
        loadedRangeStart: 0,
        loadedRangeEnd: clonedMessages.length,
        lastKnownMessageCount: clonedMessages.length,
        createdAt: now,
        updatedAt: now,
        workingFolder: source.workingFolder,
        sshConnectionId: source.sshConnectionId,
        providerId: source.providerId,
        modelId: source.modelId
      }
      set((state) => {
        state.tasks.push(newTask)
        syncTasksById(state)
        state.activeTaskId = newId
      })
      dbCreateTask(newTask)
      clonedMessages.forEach((msg, i) => dbAddMessage(newId, msg, i))
      useTodoStore.getState().clearPlanItems()
      usePlanStore.getState().setActivePlan(null)
      useUIStore.getState().syncTaskScopedState(newId)
      return newId
    },

    forkTaskFromMessage: async (taskId, messageId) => {
      await get().loadTaskMessages(taskId)
      const source = get().tasks.find((s) => s.id === taskId)
      if (!source) return null

      const messageIndex = source.messages.findIndex((message) => message.id === messageId)
      if (messageIndex < 0) return null

      const newId = nanoid()
      const now = Date.now()
      const clonedMessages = cloneMessagesForNewTask(source.messages.slice(0, messageIndex + 1))
      const newTask: Task = {
        id: newId,
        title: source.title,
        messages: clonedMessages,
        messageCount: clonedMessages.length,
        messagesLoaded: true,
        loadedRangeStart: 0,
        loadedRangeEnd: clonedMessages.length,
        lastKnownMessageCount: clonedMessages.length,
        createdAt: now,
        updatedAt: now,
        workingFolder: source.workingFolder,
        sshConnectionId: source.sshConnectionId,
        providerId: source.providerId,
        modelId: source.modelId
      }

      set((state) => {
        state.tasks.push(newTask)
        syncTasksById(state)
        state.activeTaskId = newId
      })

      dbCreateTask(newTask)
      clonedMessages.forEach((msg, i) => dbAddMessage(newId, msg, i))
      useTodoStore.getState().clearPlanItems()
      usePlanStore.getState().setActivePlan(null)
      useUIStore.getState().syncTaskScopedState(newId)
      return newId
    },

    removeLastAssistantMessage: (taskId) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task || task.messages.length === 0) return false
      // Find the last assistant message, skipping trailing tool_result-only user messages
      let assistantIdx = -1
      for (let i = task.messages.length - 1; i >= 0; i--) {
        const m = task.messages[i]
        if (m.role === 'assistant') {
          assistantIdx = i
          break
        }
        // Skip tool_result-only user messages (they are API-level, not real user input)
        if (
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.every((b) => b.type === 'tool_result')
        )
          continue
        break // hit a real user message or something else — stop
      }
      if (assistantIdx < 0) return false
      const deletedMessageIds = task.messages.slice(assistantIdx).map((message) => message.id)
      // Truncate from the assistant message onward (removes it + trailing tool_result messages)
      set((state) => {
        const s = state.tasks.find((s) => s.id === taskId)
        if (s) {
          s.messages.splice(assistantIdx)
          s.messageCount = s.messages.length
          s.loadedRangeStart = 0
          s.loadedRangeEnd = s.messages.length
          s.lastKnownMessageCount = s.messages.length
        }
      })
      const newLen = get().tasks.find((s) => s.id === taskId)?.messages.length ?? 0
      clearPendingMessageFlushes(deletedMessageIds)
      clearDeferredMessageAdds(taskId, newLen)
      for (const messageId of deletedMessageIds) {
        _streamingDirtyMessageIds.delete(messageId)
      }
      dbTruncateMessagesFrom(taskId, newLen)
      return true
    },

    removeLastUserMessage: (taskId) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task || task.messages.length === 0) return
      const lastMsg = task.messages[task.messages.length - 1]
      if (lastMsg.role !== 'user') return
      const deletedMessageIds = [lastMsg.id]
      set((state) => {
        const s = state.tasks.find((s) => s.id === taskId)
        if (s && s.messages.length > 0 && s.messages[s.messages.length - 1].role === 'user') {
          s.messages.pop()
          s.messageCount = s.messages.length
          s.loadedRangeStart = 0
          s.loadedRangeEnd = s.messages.length
          s.lastKnownMessageCount = s.messages.length
        }
      })
      const newLen = get().tasks.find((s) => s.id === taskId)?.messages.length ?? 0
      clearPendingMessageFlushes(deletedMessageIds)
      clearDeferredMessageAdds(taskId, newLen)
      for (const messageId of deletedMessageIds) {
        _streamingDirtyMessageIds.delete(messageId)
      }
      dbTruncateMessagesFrom(taskId, newLen)
    },

    truncateMessagesFrom: (taskId, fromIndex) => {
      const deletedMessageIds =
        get()
          .tasks.find((s) => s.id === taskId)
          ?.messages.slice(Math.max(0, fromIndex))
          .map((message) => message.id) ?? []
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (task && fromIndex >= 0 && fromIndex < task.messages.length) {
          task.messages.splice(fromIndex)
          task.messageCount = task.messages.length
          task.loadedRangeStart = 0
          task.loadedRangeEnd = task.messages.length
          task.lastKnownMessageCount = task.messages.length
          task.updatedAt = Date.now()
        }
      })
      clearPendingMessageFlushes(deletedMessageIds)
      clearDeferredMessageAdds(taskId, fromIndex)
      for (const messageId of deletedMessageIds) {
        _streamingDirtyMessageIds.delete(messageId)
      }
      dbTruncateMessagesFrom(taskId, fromIndex)
      dbUpdateTask(taskId, { updatedAt: Date.now(), messageCount: fromIndex })
    },

    replaceTaskMessages: (taskId, messages) => {
      const now = Date.now()
      const previousMessageIds =
        get()
          .tasks.find((s) => s.id === taskId)
          ?.messages.map((message) => message.id) ?? []
      const revisedMessages = messages.map((message) => ({
        ...message,
        _revision: (message._revision ?? 0) + 1
      }))
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (!task) return
        task.messages = revisedMessages
        task.messageCount = revisedMessages.length
        task.messagesLoaded = true
        task.loadedRangeStart = 0
        task.loadedRangeEnd = revisedMessages.length
        task.lastKnownMessageCount = revisedMessages.length
        task.updatedAt = now
      })
      bumpMessageWriteGeneration(taskId)
      clearDeferredMessageAdds(taskId)
      const replacedMessageIds = [
        ...new Set([...previousMessageIds, ...revisedMessages.map((message) => message.id)])
      ]
      clearPendingMessageFlushes(replacedMessageIds)
      for (const messageId of replacedMessageIds) {
        _streamingDirtyMessageIds.delete(messageId)
      }
      const streamingMsgId = get().streamingMessages[taskId]
      if (streamingMsgId) {
        _streamingDirtyMessageIds.delete(streamingMsgId)
      }
      enqueueTaskMessageWrite(taskId, () =>
        tauriCommands.invoke('db:messages:replace', {
          taskId,
          messages: revisedMessages.map((msg, i) => ({
            id: msg.id,
            role: msg.role,
            content: JSON.stringify(sanitizeMessageContentForPersistence(msg.content)),
            meta: msg.meta ? JSON.stringify(msg.meta) : null,
            createdAt: msg.createdAt,
            usage: msg.usage ? JSON.stringify(msg.usage) : null,
            sortOrder: i
          }))
        })
      )
      dbUpdateTask(taskId, { updatedAt: now, messageCount: revisedMessages.length })
    },

    sanitizeToolErrorsForResend: (taskId) => {
      const task = get().tasks.find((s) => s.id === taskId)
      if (!task || task.messages.length === 0) return
      const sanitized = sanitizeToolBlocksForResend(task.messages)
      if (!sanitized.changed) return
      get().replaceTaskMessages(taskId, sanitized.messages)
    },

    stripOldSystemReminders: (taskId) => {
      const changedMsgIds = new Set<string>()
      set((state) => {
        const task = state.tasks.find((s) => s.id === taskId)
        if (!task || task.messages.length === 0) return

        let changed = false
        for (const msg of task.messages) {
          if (msg.role !== 'user') continue
          if (typeof msg.content === 'string') continue
          if (!Array.isArray(msg.content)) continue

          // Filter out system-reminder blocks from user messages
          const filtered = msg.content.filter((block) => {
            if (block.type === 'text' && typeof block.text === 'string') {
              return !/^<system-remind(?:er)?>/i.test(block.text.trim())
            }
            return true
          })

          if (filtered.length !== msg.content.length) {
            msg.content = filtered
            changed = true
            changedMsgIds.add(msg.id)
          }
        }

        if (changed) {
          task.updatedAt = Date.now()
        }
      })

      // Persist changes to DB
      const task = get().tasks.find((s) => s.id === taskId)
      if (task && task.messages.length > 0) {
        const changedMsgs = task.messages.filter((m) => changedMsgIds.has(m.id))
        for (const msg of changedMsgs) {
          dbUpsertMessage(taskId, msg, resolveMessageSortOrder(task, msg.id))
        }
        if (changedMsgs.length > 0) {
          dbUpdateTask(taskId, { updatedAt: task.updatedAt })
        }
      }
    },

    addMessage: (taskId, msg) => {
      let sortOrder = 0
      let shouldPersist = false
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        shouldPersist = true
        sortOrder = task.messageCount
        if (!task.messagesLoaded) {
          task.messagesLoaded = true
          task.messages = []
          task.loadedRangeStart = task.messageCount
          task.loadedRangeEnd = task.messageCount
        }
        msg._revision = (msg._revision ?? 0) + 1
        task.messages.push(msg)
        task.messageCount += 1
        task.loadedRangeEnd = task.messageCount
        task.lastKnownMessageCount = task.messageCount
        trimTaskMessageWindow(task)
        task.updatedAt = Date.now()
        releaseDormantTaskMemory(state)
      })
      if (!shouldPersist) return
      if (get().streamingMessages[taskId]) {
        if (isToolResultOnlyUserMessage(msg)) {
          // Tool-result messages are appended while the assistant bubble is still
          // streaming. Persist them silently so DB-backed reloads and queued turns
          // can still reconstruct the tool chain without broadcasting a reload.
          dbUpsertMessage(taskId, msg, sortOrder)
        } else {
          _deferredMessageAdds.push({ taskId, msg, sortOrder })
        }
        return
      }
      dbAddMessage(taskId, msg, sortOrder)
      dbUpdateTask(taskId, { updatedAt: Date.now(), messageCount: sortOrder + 1 })
    },

    beginUserTurn: (taskId, userMsg, assistantMsg, streamingMessageId) => {
      let userSortOrder = 0
      let assistantSortOrder = 0
      let shouldPersistUser = false
      let shouldPersistAssistant = false
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        if (!task.messagesLoaded) {
          task.messagesLoaded = true
          task.messages = []
          task.loadedRangeStart = task.messageCount
          task.loadedRangeEnd = task.messageCount
        }
        if (userMsg) {
          shouldPersistUser = true
          userSortOrder = task.messageCount
          userMsg._revision = (userMsg._revision ?? 0) + 1
          task.messages.push(userMsg)
          task.messageCount += 1
        }
        if (assistantMsg) {
          shouldPersistAssistant = true
          assistantSortOrder = task.messageCount
          assistantMsg._revision = (assistantMsg._revision ?? 0) + 1
          task.messages.push(assistantMsg)
          task.messageCount += 1
        }
        task.loadedRangeEnd = task.messageCount
        task.lastKnownMessageCount = task.messageCount
        trimTaskMessageWindow(task)
        task.updatedAt = Date.now()

        if (streamingMessageId !== null) {
          _streamingBackfillBlockedTaskIds.delete(taskId)
          state.streamingMessages[taskId] = streamingMessageId
          if (taskId === state.activeTaskId) {
            state.streamingMessageId = streamingMessageId
          }
        }

        releaseDormantTaskMemory(state)
      })
      if (streamingMessageId !== null) {
        _activeStreamingMessageIds.add(streamingMessageId)
        startStreamingPeriodicFlush(taskId, streamingMessageId, get)
      }
      const now = Date.now()
      const batch: Array<{ msg: UnifiedMessage; sortOrder: number }> = []
      if (shouldPersistUser && userMsg) batch.push({ msg: userMsg, sortOrder: userSortOrder })
      if (shouldPersistAssistant && assistantMsg)
        batch.push({ msg: assistantMsg, sortOrder: assistantSortOrder })
      if (batch.length > 0) {
        const target = getTaskByIdFromState(get(), taskId)
        dbAddMessageBatch(taskId, batch)
        dbUpdateTask(taskId, { updatedAt: now, messageCount: target?.messageCount ?? batch.length })
        // Force-flush the user message and assistant placeholder to disk immediately,
        // so they survive a crash that occurs before the first periodic streaming flush.
        flushDb().catch(() => {})
      }
    },

    updateMessage: (taskId, msgId, patch) => {
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        const msg = task.messages.find((m) => m.id === msgId)
        if (msg) {
          Object.assign(msg, patch)
          bumpMessageRevision(msg)
        }
      })
      if (_activeStreamingMessageIds.has(msgId)) {
        _streamingDirtyMessageIds.add(msgId)
        return
      }
      const task = getTaskByIdFromState(get(), taskId)
      const msg = task?.messages.find((m) => m.id === msgId)
      if (msg) dbUpsertMessage(taskId, msg, resolveMessageSortOrder(task, msgId))
    },

    appendTextDelta: (taskId, msgId, text) => {
      _pendingStreamDeltas.push({ kind: 'text', taskId, msgId, text })
      _scheduleStreamDeltaFlush()
    },

    appendThinkingDelta: (taskId, msgId, thinking) => {
      const cleanedThinking = stripThinkTagMarkers(thinking)
      if (!cleanedThinking) return
      _pendingStreamDeltas.push({ kind: 'thinking', taskId, msgId, thinking: cleanedThinking })
      _scheduleStreamDeltaFlush()
    },

    setThinkingEncryptedContent: (taskId, msgId, encryptedContent, provider) => {
      if (!encryptedContent) return

      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        const msg = task.messages.find((m) => m.id === msgId)
        if (!msg) return
        backfillStreamingMessage(state, taskId, msgId)
        bumpMessageRevision(msg)

        const now = Date.now()
        if (typeof msg.content === 'string') {
          const existingText = msg.content
          msg.content = [
            {
              type: 'thinking',
              thinking: '',
              encryptedContent,
              encryptedContentProvider: provider,
              startedAt: now
            },
            ...(existingText ? [{ type: 'text' as const, text: existingText }] : [])
          ]
          return
        }

        const blocks = msg.content as ContentBlock[]
        let targetThinkingBlock: ThinkingBlock | null = null
        let providerMatchedThinkingBlock: ThinkingBlock | null = null

        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]
          if (block.type !== 'thinking') continue

          const thinkingBlock = block as ThinkingBlock
          if (!thinkingBlock.encryptedContent) {
            targetThinkingBlock = thinkingBlock
            break
          }

          if (
            !providerMatchedThinkingBlock &&
            thinkingBlock.encryptedContentProvider === provider
          ) {
            providerMatchedThinkingBlock = thinkingBlock
          }
        }

        if (!targetThinkingBlock && providerMatchedThinkingBlock) {
          targetThinkingBlock = providerMatchedThinkingBlock
        }

        if (targetThinkingBlock) {
          targetThinkingBlock.encryptedContent = encryptedContent
          targetThinkingBlock.encryptedContentProvider = provider
        } else {
          blocks.push({
            type: 'thinking',
            thinking: '',
            encryptedContent,
            encryptedContentProvider: provider,
            startedAt: now
          })
        }
      })

      const task = getTaskByIdFromState(get(), taskId)
      const msg = task?.messages.find((m) => m.id === msgId)
      if (msg) dbFlushMessage(taskId, msg, get)
    },

    completeThinking: (taskId, msgId) => {
      flushPendingStreamDeltasForMessage(taskId, msgId, get, set)
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        const msg = task.messages.find((m) => m.id === msgId)
        if (!msg || typeof msg.content === 'string') return

        const blocks = msg.content as ContentBlock[]
        for (const block of blocks) {
          if (block.type === 'thinking' && !block.completedAt) {
            block.completedAt = Date.now()
          }
        }
        bumpMessageRevision(msg)
      })
      // Immediate persist after thinking completes
      const task = getTaskByIdFromState(get(), taskId)
      const msg = task?.messages.find((m) => m.id === msgId)
      if (msg) dbFlushMessageImmediate(taskId, msg, get)
    },

    appendToolUse: (taskId, msgId, toolUse) => {
      flushPendingStreamDeltasForMessage(taskId, msgId, get, set)
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        const msg = task.messages.find((m) => m.id === msgId)
        if (!msg) return
        backfillStreamingMessage(state, taskId, msgId)

        const normalizedToolUse: ToolUseBlock = {
          ...toolUse,
          input: summarizeToolInputForHistory(toolUse.name, toolUse.input)
        }
        if (typeof msg.content === 'string') {
          msg.content = msg.content
            ? [{ type: 'text', text: msg.content }, normalizedToolUse]
            : [normalizedToolUse]
        } else {
          const blocks = msg.content as ContentBlock[]
          const existingIndex = normalizedToolUse.id
            ? blocks.findIndex(
                (block): block is ToolUseBlock =>
                  block.type === 'tool_use' && block.id === normalizedToolUse.id
              )
            : -1

          if (existingIndex === -1) {
            blocks.push(normalizedToolUse)
          } else {
            blocks[existingIndex] = {
              ...(blocks[existingIndex] as ToolUseBlock),
              ...normalizedToolUse,
              input: normalizedToolUse.input
            }
          }
        }
        bumpMessageRevision(msg)
      })
      // Persist immediately for tool use blocks
      const task = getTaskByIdFromState(get(), taskId)
      const msg = task?.messages.find((m) => m.id === msgId)
      if (msg) dbFlushMessageImmediate(taskId, msg, get)
    },

    updateToolUseInput: (taskId, msgId, toolUseId, input) => {
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        const msg = task.messages.find((m) => m.id === msgId)
        if (!msg || typeof msg.content === 'string') return

        const block = (msg.content as ContentBlock[]).find(
          (b) => b.type === 'tool_use' && (b as ToolUseBlock).id === toolUseId
        ) as ToolUseBlock | undefined
        if (block) {
          block.input = summarizeToolInputForHistory(block.name, input)
          bumpMessageRevision(msg)
        }
      })
      const task = getTaskByIdFromState(get(), taskId)
      const msg = task?.messages.find((m) => m.id === msgId)
      if (msg) dbFlushMessage(taskId, msg, get)
    },

    appendContentBlock: (taskId, msgId, block) => {
      flushPendingStreamDeltasForMessage(taskId, msgId, get, set)
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return
        const msg = task.messages.find((m) => m.id === msgId)
        if (!msg) return
        backfillStreamingMessage(state, taskId, msgId)

        if (typeof msg.content === 'string') {
          msg.content = msg.content ? [{ type: 'text', text: msg.content }, block] : [block]
        } else {
          ;(msg.content as ContentBlock[]).push(block)
        }
        bumpMessageRevision(msg)
      })
      const task = getTaskByIdFromState(get(), taskId)
      const msg = task?.messages.find((m) => m.id === msgId)
      if (msg) dbFlushMessageImmediate(taskId, msg, get)
    },

    applyBackgroundSnapshot: (taskId, snapshot) => {
      let mergedAny = false
      set((state) => {
        const task = getTaskByIdFromState(state, taskId)
        if (!task) return

        // 1. Apply patched messages: existing -> override fields, missing -> insert as new.
        //    This eliminates the "silent updateMessage failure when id isn't in the loaded window" bug.
        for (const [msgId, bufferedMsg] of Object.entries(snapshot.patchedMessagesById)) {
          const existing = task.messages.find((m) => m.id === msgId)
          if (existing) {
            existing.content = bufferedMsg.content
            if (bufferedMsg.usage) existing.usage = bufferedMsg.usage
            if (bufferedMsg.providerResponseId) {
              existing.providerResponseId = bufferedMsg.providerResponseId
            }
            bumpMessageRevision(existing)
            mergedAny = true
          } else {
            const cloned: UnifiedMessage = { ...bufferedMsg, _revision: 1 }
            task.messages.push(cloned)
            task.messageCount = Math.max(task.messageCount, task.messages.length)
            task.loadedRangeEnd = task.messageCount
            task.lastKnownMessageCount = task.messageCount
            mergedAny = true
          }
        }

        // 2. Apply added messages in insertion order; skip duplicates.
        for (const msgId of snapshot.addedMessageIds) {
          if (task.messages.some((m) => m.id === msgId)) continue
          const msg = snapshot.addedMessagesById[msgId]
          if (!msg) continue
          const cloned: UnifiedMessage = { ...msg, _revision: 1 }
          task.messages.push(cloned)
          task.messageCount = Math.max(task.messageCount, task.messages.length)
          task.loadedRangeEnd = task.messageCount
          task.lastKnownMessageCount = task.messageCount
          mergedAny = true
        }

        if (mergedAny) {
          task.updatedAt = Date.now()
        }
      })

      if (!mergedAny) return

      // Persist merged messages to DB (fire-and-forget, debounced per message).
      const task = getTaskByIdFromState(get(), taskId)
      if (!task) return
      const mergedIds = new Set<string>([
        ...Object.keys(snapshot.patchedMessagesById),
        ...snapshot.addedMessageIds
      ])
      for (const msg of task.messages) {
        if (!mergedIds.has(msg.id)) continue
        dbFlushMessageImmediate(taskId, msg, get)
      }
      dbUpdateTask(taskId, { updatedAt: task.updatedAt })
    },

    setStreamingMessageId: (taskId, id) => {
      const prevStreamingMsgId = get().streamingMessages[taskId]
      set((state) => {
        if (id) {
          _streamingBackfillBlockedTaskIds.delete(taskId)
          state.streamingMessages[taskId] = id
        } else {
          _streamingBackfillBlockedTaskIds.add(taskId)
          delete state.streamingMessages[taskId]
        }
        releaseDormantTaskMemory(state)
        // Sync convenience field when updating the active task
        if (taskId === state.activeTaskId) {
          state.streamingMessageId = id
        }
      })

      if (id) {
        _activeStreamingMessageIds.add(id)
        startStreamingPeriodicFlush(taskId, id, get)
      }

      if (!id && prevStreamingMsgId) {
        flushPendingStreamDeltasForMessage(taskId, prevStreamingMsgId, get, set)
        stopStreamingPeriodicFlush(taskId)
        _activeStreamingMessageIds.delete(prevStreamingMsgId)
        flushDeferredMessageAdds(taskId)
        if (_streamingDirtyMessageIds.has(prevStreamingMsgId)) {
          _streamingDirtyMessageIds.delete(prevStreamingMsgId)
          const task = getTaskByIdFromState(get(), taskId)
          const msg = task?.messages.find((m) => m.id === prevStreamingMsgId)
          if (msg) dbFlushMessageImmediate(taskId, msg, get)
        }
        const task = getTaskByIdFromState(get(), taskId)
        dbUpdateTask(taskId, { updatedAt: Date.now(), messageCount: task?.messageCount ?? 0 })
        // Force-flush the JSON DB to disk immediately after streaming ends
        // to minimize the window where a close/crash could lose messages.
        flushDb().catch(() => {})
      }
    },

    setGeneratingImage: (msgId, generating, occurredAt = Date.now()) =>
      set((state) => {
        const timing = state.imageGenerationTimings[msgId]
        if (generating) {
          state.generatingImageMessages[msgId] = true
          if (!timing || timing.completedAt) {
            state.imageGenerationTimings[msgId] = { startedAt: occurredAt }
          }
        } else {
          delete state.generatingImageMessages[msgId]
          if (timing?.startedAt && !timing.completedAt) {
            timing.completedAt = occurredAt
          }
        }
      }),

    setGeneratingImagePreview: (msgId, preview) =>
      set((state) => {
        if (preview) {
          state.generatingImagePreviews[msgId] = preview
        } else {
          delete state.generatingImagePreviews[msgId]
        }
      }),

    getActiveTask: () => {
      const state = get()
      if (!state.activeTaskId) return undefined
      return getTaskByIdFromState(state, state.activeTaskId)
    },

    getLatestTaskByPlanId: (planId) => {
      if (!planId) return undefined
      return [...get().tasks]
        .filter((task) => task.planId === planId)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    },

    getTaskMessages: (taskId) => {
      const task = getTaskByIdFromState(get(), taskId)
      return task?.messages ?? []
    },

    recoverFromWebviewOom: async (taskId) => {
      const targetTaskId = taskId ?? get().activeTaskId

      set((state) => {
        state.tasks = state.tasks.map((task) => {
          if (task.id === targetTaskId) {
            return {
              ...task,
              messages: [],
              messagesLoaded: task.messageCount === 0,
              loadedRangeStart: task.messageCount,
              loadedRangeEnd: task.messageCount,
              lastKnownMessageCount: task.messageCount,
              promptSnapshot: undefined
            }
          }

          return {
            ...task,
            messages: [],
            messagesLoaded: task.messageCount === 0,
            loadedRangeStart: task.messageCount,
            loadedRangeEnd: task.messageCount,
            lastKnownMessageCount: task.messageCount,
            promptSnapshot: undefined
          }
        })
        syncTasksById(state)
        state.streamingMessages = targetTaskId
          ? Object.fromEntries(
              Object.entries(state.streamingMessages).filter(([key]) => key === targetTaskId)
            )
          : {}
        state.streamingMessageId = targetTaskId
          ? (state.streamingMessages[targetTaskId] ?? null)
          : null
      })

      useAgentStore.getState().trimDormantTaskData(targetTaskId ? [targetTaskId] : [])
      if (targetTaskId) {
        useInboxStore.getState().clearTask(targetTaskId)
      }
      useTodoStore.getState().releaseDormantPlanItems(targetTaskId ? [targetTaskId] : [])
      usePlanStore.getState().releaseDormantPlans(targetTaskId ?? null)

      if (targetTaskId) {
        await get().loadRecentTaskMessages(targetTaskId, true, 40)
        await useTodoStore.getState().loadPlanItemsForTask(targetTaskId)
        const planStore = usePlanStore.getState()
        const activePlan = await planStore.loadPlanForTask(targetTaskId)
        planStore.setActivePlan(activePlan?.id ?? null)
      } else {
        useTodoStore.getState().clearPlanItems()
        usePlanStore.getState().setActivePlan(null)
      }

      get().releaseDormantTasks()
    },

    releaseDormantTasks: () => {
      set((state) => {
        releaseDormantTaskMemory(state)
        state.streamingMessageId = state.activeTaskId
          ? (state.streamingMessages[state.activeTaskId] ?? null)
          : null
      })
    }
  }))
)

// --- RAF delta flush (wired after store creation to avoid TDZ) ---

initStreamFlush(useChatStore.getState, useChatStore.setState)
