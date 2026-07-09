import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ArrowDown } from 'lucide-react'
import type { ContentBlock, UnifiedMessage } from '@/lib/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { useTeamStore, type ActiveTeam } from '@/stores/team-store'
import {
  buildChatRenderableMessageMetaFromAnalysis,
  buildTranscriptStaticAnalysis,
  type TailToolExecutionState
} from '@/lib/chat/transcript-utils'
import { isStreamingPerformanceEnabled, recordStreamingReactCommit } from '@/lib/devtools/streaming-performance'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { selectTaskScopedAgentState } from '@/lib/agent/task-scoped-agent-state'
import { createLogger } from '@/lib/logger'
import {
  UserMessageLocator,
  buildUserLocatorItem,
  parseLocatorContent,
  parseLocatorMeta,
  findPendingAskUserQuestion,
  type UserMessageLocatorItem,
  type UserMessageLocatorSource,
  type UserMessageIndexRow
} from './message-list/UserMessageLocator'
import {
  useAutoScrollActions,
  useStreamingAutoScrollPoll,
  getDistanceToBottom
} from '@/hooks/use-auto-scroll'
import {
  MessageRow,
  areMessageListPropsEqual
} from './message-list/message-comparators'
import type { MessageListProps, MessageListRow, AutoScrollMode } from './message-list/types'
import {
  TAIL_STATIC_MESSAGE_COUNT,
  TAIL_LIVE_MESSAGE_COUNT,
  INITIAL_SCROLL_SETTLE_FRAMES,
  FOLLOW_BOTTOM_SETTLE_FRAMES,
  AUTO_SCROLL_MIN_DELTA,
  OLDER_MESSAGE_LOAD_SCROLL_THRESHOLD,
  PENDING_ASSISTANT_ROW_KEY_PREFIX,
  USER_LOCATOR_SCROLL_OFFSET,
  USER_LOCATOR_HIGHLIGHT_MS,
  MIN_RENDERABLE_HISTORY_ROWS,
  MESSAGE_COLUMN_CLASS
} from './message-list/constants'

const log = createLogger('MessageList')

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
type TeamStoreSnapshot = ReturnType<typeof useTeamStore.getState>

const EMPTY_MESSAGES: UnifiedMessage[] = []
const EMPTY_TEAM_HISTORY: ActiveTeam[] = []
const EMPTY_USER_LOCATOR_ROWS: UserMessageIndexRow[] = []

interface MessageListTaskSelection {
  messages: UnifiedMessage[]
  messagesLoaded: boolean
  messageCount: number
  workingFolder?: string
  loadedRangeStart: number
}

interface TaskScopedTeamSelection {
  activeTeam: ActiveTeam | null
  teamHistory: ActiveTeam[]
  isTeamRunning: boolean
  hasOrchestrationData: boolean
  signature: string
}

const EMPTY_MESSAGE_LIST_TASK_SELECTION: MessageListTaskSelection = {
  messages: EMPTY_MESSAGES,
  messagesLoaded: false,
  messageCount: 0,
  loadedRangeStart: 0,
  workingFolder: undefined
}

const EMPTY_TASK_TEAM_SELECTION: TaskScopedTeamSelection = {
  activeTeam: null,
  teamHistory: EMPTY_TEAM_HISTORY,
  isTeamRunning: false,
  hasOrchestrationData: false,
  signature: 'empty'
}

const taskMemoryScopedTeamSelectionCache = new Map<string, TaskScopedTeamSelection>()

function getMessageToolUseIds(message: UnifiedMessage): string[] {
  if (!Array.isArray(message.content)) return []
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => {
      return block.type === 'tool_use'
    })
    .map((block) => block.id)
    .filter(Boolean)
}

function hasCompleteTailToolExecutionResults(state: TailToolExecutionState | null): boolean {
  if (!state || state.toolUseBlocks.length === 0) return false

  return state.toolUseBlocks.every((toolUse) => state.toolResultMap.has(toolUse.id))
}

function buildTeamMemberRenderSignature(team: ActiveTeam): string {
  return team.members
    .map((member) =>
      [
        member.id,
        member.name,
        member.role ?? '',
        member.status,
        String(member.iteration),
        String(member.currentTaskId ?? ''),
        String(member.startedAt),
        String(member.completedAt ?? ''),
        member.streamingText ?? '',
        String(member.toolCalls.length)
      ].join(':')
    )
    .join('|')
}

function buildTeamTaskRenderSignature(team: ActiveTeam): string {
  return team.tasks
    .map((task) =>
      [
        task.id,
        task.subject,
        task.status,
        task.owner ?? '',
        task.description ?? '',
        task.report ?? ''
      ].join(':')
    )
    .join('|')
}

function buildTeamMessageRenderSignature(team: ActiveTeam): string {
  const lastMessage = team.messages[team.messages.length - 1]
  return [
    String(team.messages.length),
    lastMessage?.id ?? '',
    lastMessage?.summary ?? '',
    lastMessage?.timestamp ?? ''
  ].join(':')
}

function buildTeamRenderSignature(team: ActiveTeam): string {
  return [
    team.name,
    team.taskId ?? '',
    String(team.createdAt),
    buildTeamMemberRenderSignature(team),
    buildTeamTaskRenderSignature(team),
    buildTeamMessageRenderSignature(team)
  ].join('::')
}

function isActiveTeamRunning(team: ActiveTeam): boolean {
  return (
    team.tasks.some((task) => task.status !== 'completed') ||
    team.members.some((member) => member.status === 'working' || member.status === 'waiting')
  )
}

function selectMessageListTask(
  state: ChatStoreSnapshot,
  taskId: string | null | undefined
): MessageListTaskSelection {
  if (!taskId) return EMPTY_MESSAGE_LIST_TASK_SELECTION

  const idx = state.tasksById[taskId]
  if (idx === undefined) return EMPTY_MESSAGE_LIST_TASK_SELECTION

  const taskItem = state.tasks[idx]
  return {
    messages: taskItem.messages ?? EMPTY_MESSAGES,
    messagesLoaded: taskItem.messagesLoaded ?? false,
    messageCount: taskItem.messageCount ?? 0,
    workingFolder: taskItem.workingFolder,
    loadedRangeStart: taskItem.loadedRangeStart ?? 0
  }
}

function selectTaskScopedTeamState(
  state: TeamStoreSnapshot,
  taskId: string | null | undefined
): TaskScopedTeamSelection {
  if (!taskId) return EMPTY_TASK_TEAM_SELECTION

  const activeTeam = state.activeTeams[taskId] ?? null
  let teamHistory = EMPTY_TEAM_HISTORY
  const signatureParts: string[] = []

  if (activeTeam) {
    signatureParts.push(`active:${buildTeamRenderSignature(activeTeam)}`)
  }

  for (const team of state.teamHistory) {
    if (team.taskId !== taskId) continue
    if (teamHistory === EMPTY_TEAM_HISTORY) teamHistory = []
    teamHistory.push(team)
    signatureParts.push(`history:${buildTeamRenderSignature(team)}`)
  }

  const signature = signatureParts.join('')
  const cached = taskMemoryScopedTeamSelectionCache.get(taskId)
  if (cached?.signature === signature) return cached

  const nextSelection: TaskScopedTeamSelection = {
    activeTeam,
    teamHistory,
    isTeamRunning: activeTeam ? isActiveTeamRunning(activeTeam) : false,
    hasOrchestrationData: Boolean(activeTeam) || teamHistory !== EMPTY_TEAM_HISTORY,
    signature
  }

  taskMemoryScopedTeamSelectionCache.set(taskId, nextSelection)
  return nextSelection
}

function MessageListInner(props: MessageListProps): React.JSX.Element {
  const {
    taskId,
    onRetry,
    onContinue,
    onDeleteMessage,
    onRollbackMessage,
  } = props
  const { t } = useTranslation('chat')
  const currentActiveTaskId = useChatStore((s) => s.activeTaskId)
  const targetTaskId = taskId ?? currentActiveTaskId
  const taskSelection = useChatStore(
    useShallow((s) => selectMessageListTask(s, targetTaskId))
  )
  const {
    messages,
    messagesLoaded: activeTaskLoaded,
    messageCount: activeTaskMessageCount,
    loadedRangeStart
  } = taskSelection
  const streamingMessageId = useChatStore((s) =>
    targetTaskId ? (s.streamingMessages[targetTaskId] ?? null) : null
  )
  const activeTaskId = targetTaskId
  const isMainChatTask =
    !taskId && Boolean(activeTaskId) && activeTaskId === currentActiveTaskId
  const hasStreamingMessage = useChatStore((s) =>
    activeTaskId ? Boolean(s.streamingMessages[activeTaskId]) : false
  )
  const {
    hasActiveToolCallOutput,
    isTaskRunning: isAgentTaskRunning
  } = useAgentStore((s) => selectTaskScopedAgentState(s, activeTaskId, { mode: 'coarse' }))
  const primaryTaskStatus = useAgentStore((s) =>
    activeTaskId ? (s.runningTasks[activeTaskId] ?? null) : null
  )
  const {
    isTeamRunning
  } = useTeamStore((s) => selectTaskScopedTeamState(s, activeTaskId))
  const isPrimaryTaskRunning =
    primaryTaskStatus === 'running' || primaryTaskStatus === 'retrying'
  const isTaskRunning = isAgentTaskRunning || isTeamRunning || hasStreamingMessage
  const taskRequestRetryState = useAgentStore((s) =>
    activeTaskId ? (s.taskRequestRetryState[activeTaskId] ?? null) : null
  )
  const isTaskOutputting = hasStreamingMessage || hasActiveToolCallOutput
  const canTaskTriggerStreamingAutoScroll =
        isMainChatTask && isTaskOutputting

  const transcriptAnalysis = React.useMemo(
    () => buildTranscriptStaticAnalysis(messages),
    [messages]
  )
  const {
    messageLookup,
    toolResultsLookup,
    tailToolExecutionState
  } = transcriptAnalysis

  const listRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const pendingInitialScrollTaskIdRef = React.useRef<string | null>(null)
  const autoScrollModeRef = React.useRef<AutoScrollMode>('off')
  const scheduledScrollFrameRef = React.useRef<number | null>(null)
  const highlightedMessageTimerRef = React.useRef<number | null>(null)
  const lastScrollOffsetRef = React.useRef(0)
  const programmaticScrollUntilRef = React.useRef(0)
  const wasTaskOutputtingRef = React.useRef(isTaskOutputting)
  const [isAtBottom, setIsAtBottom] = React.useState(true)
  const [activeUserLocatorMessageId, setActiveUserLocatorMessageId] = React.useState<string | null>(
    null
  )
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = React.useState(false)
  const [userLocatorSnapshot, setUserLocatorSnapshot] = React.useState<{
    taskId: string | null
    rows: UserMessageIndexRow[]
  }>({ taskId: null, rows: EMPTY_USER_LOCATOR_ROWS })
  const userLocatorRows =
    userLocatorSnapshot.taskId === activeTaskId
      ? userLocatorSnapshot.rows
      : EMPTY_USER_LOCATOR_ROWS

  const continueAssistantMessageId = React.useMemo(() => {
    if (streamingMessageId || isTaskRunning) return null
    if (!hasCompleteTailToolExecutionResults(tailToolExecutionState)) return null
    return tailToolExecutionState?.assistantMessageId ?? null
  }, [isTaskRunning, streamingMessageId, tailToolExecutionState])
  const showPendingAssistantRow = (isPrimaryTaskRunning || isTeamRunning) && !streamingMessageId
  const pendingAssistantRowKey = React.useMemo(
    () =>
      `${PENDING_ASSISTANT_ROW_KEY_PREFIX}:${activeTaskId ?? currentActiveTaskId ?? 'active'}`,
    [activeTaskId, currentActiveTaskId]
  )
  const pendingAssistantMessage = React.useMemo<UnifiedMessage>(
    () => ({
      id: pendingAssistantRowKey,
      role: 'assistant',
      content: '',
      createdAt: 0
    }),
    [pendingAssistantRowKey]
  )

  const renderableMessages = React.useMemo(
    () =>
      buildChatRenderableMessageMetaFromAnalysis(
        transcriptAnalysis,
        streamingMessageId,
        continueAssistantMessageId
      ),
    [continueAssistantMessageId, streamingMessageId, transcriptAnalysis]
  )
  const assistantChangeTargets = React.useMemo(
    () =>
      messages
        .filter((message) => message.role === 'assistant')
        .map((message) => ({
          messageId: message.id,
          toolUseIds: getMessageToolUseIds(message)
        })),
    [messages]
  )
  const taskAssistantMessageIds = React.useMemo(
    () => assistantChangeTargets.map((target) => target.messageId),
    [assistantChangeTargets]
  )
  const taskToolUseIds = React.useMemo(
    () => Array.from(new Set(assistantChangeTargets.flatMap((target) => target.toolUseIds))),
    [assistantChangeTargets]
  )

  const userLocatorItems = React.useMemo<UserMessageLocatorItem[]>(() => {
    const sourcesById = new Map<string, UserMessageLocatorSource>()

    for (const row of userLocatorRows) {
      if (row.role !== 'user') continue
      sourcesById.set(row.id, {
        id: row.id,
        content: parseLocatorContent(row.content),
        meta: parseLocatorMeta(row.meta),
        createdAt: row.created_at,
        sortOrder: row.sort_order
      })
    }

    messages.forEach((message, messageIndex) => {
      if (message.role !== 'user') return
      const existing = sourcesById.get(message.id)
      sourcesById.set(message.id, {
        id: message.id,
        content: message.content,
        meta: message.meta,
        createdAt: message.createdAt,
        sortOrder: existing?.sortOrder ?? loadedRangeStart + messageIndex,
        source: message.source
      })
    })

    return [...sourcesById.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .reduce<UserMessageLocatorItem[]>((items, source) => {
        const item = buildUserLocatorItem(source, items.length + 1, activeTaskMessageCount, t)
        return item ? [...items, item] : items
      }, [])
  }, [activeTaskMessageCount, loadedRangeStart, messages, t, userLocatorRows])

  React.useEffect(() => {
    let cancelled = false

    if (!activeTaskId) {
      setUserLocatorSnapshot({ taskId: null, rows: EMPTY_USER_LOCATOR_ROWS })
      return
    }

    const loadUserLocatorRows = async (): Promise<void> => {
      try {
        const rows = (await tauriCommands.invoke('db:messages:list-user', activeTaskId)) as
          | UserMessageIndexRow[]
          | null
        if (!cancelled) {
          setUserLocatorSnapshot({
            taskId: activeTaskId,
            rows: Array.isArray(rows) ? rows : EMPTY_USER_LOCATOR_ROWS
          })
        }
      } catch (err) {
        log.error('Failed to load user message locator rows:', err)
        if (!cancelled) {
          setUserLocatorSnapshot({ taskId: activeTaskId, rows: EMPTY_USER_LOCATOR_ROWS })
        }
      }
    }

    void loadUserLocatorRows()

    return () => {
      cancelled = true
    }
  }, [activeTaskId, activeTaskMessageCount])

  const rows = React.useMemo(() => {
    const nextRows: MessageListRow[] = renderableMessages.map((message) => ({
      type: 'message',
      key: message.messageId,
      data: message
    }))
    if (showPendingAssistantRow) {
      nextRows.push({ type: 'pending-assistant', key: pendingAssistantRowKey })
    }
    return nextRows
  }, [pendingAssistantRowKey, renderableMessages, showPendingAssistantRow])
  const pendingAskUserQuestion = React.useMemo(
    () => findPendingAskUserQuestion(rows, toolResultsLookup, messageLookup),
    [messageLookup, rows, toolResultsLookup]
  )
  const isAwaitingInitialMessages =
    Boolean(activeTaskId) &&
    messages.length === 0 &&
    (!activeTaskLoaded || activeTaskMessageCount > 0 || loadedRangeStart > 0)

  const lastMessageRowIndex = rows.length - 1
  const userLocatorItemById = React.useMemo(
    () => new Map(userLocatorItems.map((item) => [item.id, item])),
    [userLocatorItems]
  )

  // --- auto-scroll ---
  const {
    canAutoScroll,
    markProgrammaticScroll,
    scrollToBottomImmediate,
    syncBottomState
  } = useAutoScrollActions({
    listRef,
    rowsLength: rows.length,
    isTaskOutputting,
    canTaskTriggerStreamingAutoScroll,
    autoScrollModeRef,
    programmaticScrollUntilRef,
    lastScrollOffsetRef,
    setIsAtBottom
  })

  const requestScrollToBottom = React.useCallback(
    ({
      behavior = 'auto',
      force = false,
      maxFrames = 1
    }: {
      behavior?: ScrollBehavior
      force?: boolean
      maxFrames?: number
    } = {}) => {
      if (scheduledScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledScrollFrameRef.current)
      }

      let framesLeft = Math.max(1, maxFrames)
      const run = (): void => {
        scheduledScrollFrameRef.current = null
        const ref = listRef.current
        if (!ref) return
        if (!force && !canAutoScroll()) return

        if (force || getDistanceToBottom(ref) > AUTO_SCROLL_MIN_DELTA) {
          scrollToBottomImmediate(behavior)
        }
        framesLeft -= 1
        if (framesLeft > 0) {
          scheduledScrollFrameRef.current = window.requestAnimationFrame(run)
          return
        }
        syncBottomState()
      }

      scheduledScrollFrameRef.current = window.requestAnimationFrame(run)
    },
    [canAutoScroll, scrollToBottomImmediate, syncBottomState]
  )

  useStreamingAutoScrollPoll({
    canTaskTriggerStreamingAutoScroll,
    pendingAskUserQuestion,
    canAutoScroll,
    requestScrollToBottom
  })

  // --- sync active locator ---
  const syncActiveUserLocator = React.useCallback(() => {
    const ref = listRef.current
    if (!ref || userLocatorItems.length === 0) {
      setActiveUserLocatorMessageId((prev) => (prev === null ? prev : null))
      return
    }

    const containerTop = ref.getBoundingClientRect().top
    let nearestVisibleId: string | null = null
    let nearestVisibleDistance = Number.POSITIVE_INFINITY

    for (const element of ref.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const messageId = element.dataset.messageId
      if (!messageId || !userLocatorItemById.has(messageId)) continue

      const distance = Math.abs(element.getBoundingClientRect().top - containerTop)
      if (distance < nearestVisibleDistance) {
        nearestVisibleDistance = distance
        nearestVisibleId = messageId
      }
    }

    if (nearestVisibleId) {
      setActiveUserLocatorMessageId((prev) => (prev === nearestVisibleId ? prev : nearestVisibleId))
      return
    }

    const scrollableDistance = Math.max(1, ref.scrollHeight - ref.clientHeight)
    const scrollProgress = Math.min(1, Math.max(0, ref.scrollTop / scrollableDistance))
    let nextActiveId = userLocatorItems[0]?.id ?? null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const item of userLocatorItems) {
      const distance = Math.abs(item.position - scrollProgress)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nextActiveId = item.id
      }
    }

    setActiveUserLocatorMessageId((prev) => (prev === nextActiveId ? prev : nextActiveId))
  }, [userLocatorItemById, userLocatorItems])

  // --- jump to user message ---
  const handleJumpToUserMessage = React.useCallback(
    async (item: UserMessageLocatorItem): Promise<void> => {
      const messageId = item.id
      const scrollToTarget = (): boolean => {
        const ref = listRef.current
        if (!ref) return false

        const target = Array.from(ref.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (element) => element.dataset.messageId === messageId
        )
        if (!target) return false

        autoScrollModeRef.current = 'off'
        markProgrammaticScroll()
        setActiveUserLocatorMessageId(messageId)
        setHighlightedMessageId(messageId)
        ref.scrollTo({
          top: Math.max(0, target.offsetTop - USER_LOCATOR_SCROLL_OFFSET),
          behavior: 'smooth'
        })

        if (highlightedMessageTimerRef.current !== null) {
          window.clearTimeout(highlightedMessageTimerRef.current)
        }
        highlightedMessageTimerRef.current = window.setTimeout(() => {
          setHighlightedMessageId((prev) => (prev === messageId ? null : prev))
          highlightedMessageTimerRef.current = null
        }, USER_LOCATOR_HIGHLIGHT_MS)

        return true
      }

      if (scrollToTarget()) return
      if (!activeTaskId) return

      await useChatStore.getState().loadTaskMessages(activeTaskId)

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      })

      scrollToTarget()
    },
    [activeTaskId, markProgrammaticScroll]
  )

  // --- load older messages ---
  const loadOlderMessages = React.useCallback(async (): Promise<number> => {
    if (!activeTaskId || isLoadingOlderMessages || loadedRangeStart <= 0) return 0

    const ref = listRef.current
    const previousScrollHeight = ref?.scrollHeight ?? 0
    const previousScrollTop = ref?.scrollTop ?? 0

    autoScrollModeRef.current = 'off'
    setIsLoadingOlderMessages(true)
    try {
      const loaded = await useChatStore.getState().loadOlderTaskMessages(activeTaskId)
      if (loaded <= 0) return 0

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      })

      const nextRef = listRef.current
      if (nextRef) {
        const scrollDelta = nextRef.scrollHeight - previousScrollHeight
        if (scrollDelta !== 0) {
          markProgrammaticScroll()
          nextRef.scrollTop = Math.max(0, previousScrollTop + scrollDelta)
        }
      }
      syncBottomState()
      syncActiveUserLocator()
      return loaded
    } finally {
      setIsLoadingOlderMessages(false)
    }
  }, [
    activeTaskId,
    isLoadingOlderMessages,
    loadedRangeStart,
    markProgrammaticScroll,
    syncActiveUserLocator,
    syncBottomState
  ])

  // --- scroll handler ---
  const handleListScroll = React.useCallback(() => {
    syncBottomState()
    syncActiveUserLocator()
    const ref = listRef.current
    if (
      ref &&
      !isLoadingOlderMessages &&
      loadedRangeStart > 0 &&
      ref.scrollTop <= OLDER_MESSAGE_LOAD_SCROLL_THRESHOLD
    ) {
      void loadOlderMessages()
    }
  }, [
    isLoadingOlderMessages,
    loadOlderMessages,
    loadedRangeStart,
    syncActiveUserLocator,
    syncBottomState
  ])

  // --- init effects ---
  React.useEffect(() => {
    if (!activeTaskId) return
    void useChatStore.getState().loadTaskMessages(activeTaskId)
  }, [activeTaskId])

  React.useEffect(() => {
    if (!activeTaskId || !streamingMessageId) return

    const hasStreamingMessageInView = messages.some((message) => message.id === streamingMessageId)
    if (hasStreamingMessageInView) return

    void useChatStore.getState().loadTaskMessages(activeTaskId, true)
  }, [activeTaskId, messages, streamingMessageId])

  React.useLayoutEffect(() => {
    pendingInitialScrollTaskIdRef.current = activeTaskId
    lastScrollOffsetRef.current = 0
    programmaticScrollUntilRef.current = 0
  }, [activeTaskId])

  React.useLayoutEffect(() => {
    if (!activeTaskId) return
    if (pendingInitialScrollTaskIdRef.current !== activeTaskId) return
    if (!(messages.length > 0 || streamingMessageId)) return

    if (isTaskOutputting) {
      autoScrollModeRef.current = 'stream'
      requestScrollToBottom({ force: true, maxFrames: INITIAL_SCROLL_SETTLE_FRAMES })
    } else {
      requestScrollToBottom({ force: true, maxFrames: INITIAL_SCROLL_SETTLE_FRAMES })
    }

    pendingInitialScrollTaskIdRef.current = null
  }, [
    activeTaskId,
    isTaskOutputting,
    messages.length,
    requestScrollToBottom,
    streamingMessageId
  ])

  React.useEffect(() => {
    const wasOutputting = wasTaskOutputtingRef.current
    if (!wasOutputting && isTaskOutputting && isAtBottom && !pendingAskUserQuestion) {
      autoScrollModeRef.current = 'stream'
    } else if (wasOutputting && !isTaskOutputting && autoScrollModeRef.current === 'stream') {
      autoScrollModeRef.current = 'off'
    }
    wasTaskOutputtingRef.current = isTaskOutputting
  }, [isAtBottom, isTaskOutputting, pendingAskUserQuestion])

  React.useEffect(() => {
    if (pendingAskUserQuestion) return
    if (!canAutoScroll()) return
    requestScrollToBottom({ maxFrames: FOLLOW_BOTTOM_SETTLE_FRAMES })
  }, [canAutoScroll, pendingAskUserQuestion, requestScrollToBottom, rows.length])

  React.useEffect(() => {
    if (!activeTaskId || isAwaitingInitialMessages || isLoadingOlderMessages) return
    if (loadedRangeStart <= 0 || renderableMessages.length >= MIN_RENDERABLE_HISTORY_ROWS) return
    void loadOlderMessages()
  }, [
    activeTaskId,
    isAwaitingInitialMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
    loadedRangeStart,
    renderableMessages.length
  ])

  React.useEffect(() => {
    syncActiveUserLocator()
  }, [syncActiveUserLocator])

  React.useEffect(() => {
    return () => {
      if (scheduledScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledScrollFrameRef.current)
      }
      if (highlightedMessageTimerRef.current !== null) {
        window.clearTimeout(highlightedMessageTimerRef.current)
      }
    }
  }, [])

  const scrollToBottom = React.useCallback(() => {
    autoScrollModeRef.current = 'user'
    setIsAtBottom(true)
    requestScrollToBottom({ behavior: 'smooth', force: true })
  }, [requestScrollToBottom])

  // --- skeleton ---
  if (isAwaitingInitialMessages) {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pt-6">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={`${MESSAGE_COLUMN_CLASS} space-y-2 ${
              index % 2 === 0 ? 'self-start' : 'self-end'
            }`}
          >
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  // --- empty ---
  if (messages.length === 0 && !showPendingAssistantRow) {
    return <div className="flex-1" />
  }

  // --- main content ---
  const messageListContent = (
    <div ref={containerRef} className="relative flex-1" data-message-list>
      <div
        ref={listRef}
        className="absolute inset-0 overflow-y-auto"
        data-message-content
        style={{ overflowAnchor: 'none' }}
        onScroll={handleListScroll}
      >
        {loadedRangeStart > 0 && (
          <div className={`${MESSAGE_COLUMN_CLASS} flex justify-center pb-3 pt-3`}>
            <button
              type="button"
              className="rounded-full border border-border/70 bg-background/92 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-70"
              onClick={() => void loadOlderMessages()}
              disabled={isLoadingOlderMessages}
            >
              {isLoadingOlderMessages
                ? t('messageList.loadingOlder')
                : t('messageList.loadOlder', { count: loadedRangeStart })}
            </button>
          </div>
        )}
        {(() => {
          const liveCutoffIndex = Math.max(0, lastMessageRowIndex - TAIL_LIVE_MESSAGE_COUNT)

          return rows.map((row, rowIndex) => {
            const disableAnimation =
              lastMessageRowIndex >= 0
                ? rowIndex >= Math.max(0, lastMessageRowIndex - (TAIL_STATIC_MESSAGE_COUNT - 1))
                : false

            if (row.type === 'pending-assistant') {
              return (
                <MessageRow
                  key={row.key}
                  message={pendingAssistantMessage}
                  taskId={targetTaskId}
                  taskAssistantMessageIds={taskAssistantMessageIds}
                  taskToolUseIds={taskToolUseIds}
                  isStreaming
                  isLastUserMessage={false}
                  isLastAssistantMessage
                  showContinue={false}
                  disableAnimation={disableAnimation}
                  toolResults={undefined}
                  anchorMessageId={null}
                  highlightMessageId={highlightedMessageId}
                  requestRetryState={taskRequestRetryState ?? null}
                  onRetry={onRetry}
                  onContinue={onContinue}
                  onDeleteMessage={onDeleteMessage}
                  onRollbackMessage={onRollbackMessage}
                />
              )
            }

            const { messageId, isLastUserMessage, isLastAssistantMessage, showContinue } = row.data
            const message = messageLookup.get(messageId)
            if (!message) return null

            const isStreaming = streamingMessageId === messageId
            const rowRenderMode = !isStreaming && rowIndex < liveCutoffIndex ? 'static' : undefined

            return (
              <MessageRow
                key={row.key}
                message={message}
                taskId={targetTaskId}
                taskAssistantMessageIds={taskAssistantMessageIds}
                taskToolUseIds={taskToolUseIds}
                isStreaming={isStreaming}
                isLastUserMessage={isLastUserMessage}
                isLastAssistantMessage={isLastAssistantMessage}
                showContinue={showContinue}
                disableAnimation={disableAnimation}
                toolResults={toolResultsLookup.get(messageId)}
                anchorMessageId={null}
                highlightMessageId={highlightedMessageId}
                renderMode={rowRenderMode}
                requestRetryState={
                  isLastAssistantMessage ? (taskRequestRetryState ?? null) : null
                }
                onRetry={onRetry}
                onContinue={onContinue}
                onDeleteMessage={onDeleteMessage}
                onRollbackMessage={onRollbackMessage}
              />
            )
          })
        })()}
      </div>

      <UserMessageLocator
        items={userLocatorItems}
        activeMessageId={activeUserLocatorMessageId}
        onJump={handleJumpToUserMessage}
      />

      {!isAtBottom && messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground hover:shadow-xl"
        >
          <ArrowDown className="size-3" />
          {t('messageList.scrollToBottom')}
        </button>
      )}
    </div>
  )

  return isStreamingPerformanceEnabled() ? (
    <React.Profiler
      id="MessageList"
      onRender={(_id, phase, actualDuration, baseDuration) => {
        recordStreamingReactCommit(actualDuration, { phase, baseDuration })
      }}
    >
      {messageListContent}
    </React.Profiler>
  ) : (
    messageListContent
  )
}

export const MessageList = React.memo(MessageListInner, areMessageListPropsEqual)
