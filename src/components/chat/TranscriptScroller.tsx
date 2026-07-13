import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import type { ContentBlock, UnifiedMessage, ToolResultContent } from '@/lib/api/types'
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
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@/components/ui/message-scroller'
import {
  UserMessageLocator,
  buildUserLocatorItem,
  parseLocatorContent,
  parseLocatorMeta,
  type UserMessageLocatorItem,
  type UserMessageLocatorSource,
  type UserMessageIndexRow
} from './transcript/user-message-locator'
import {
  TranscriptRow,
  areTranscriptScrollerPropsEqual,
} from './transcript/transcript-row'
import type { TranscriptScrollerProps, TranscriptRow as TranscriptRowType } from './transcript/types'
import type { ToolResultsLookup } from './transcript/types'
import {
  TAIL_STATIC_MESSAGE_COUNT,
  TAIL_LIVE_MESSAGE_COUNT,
  PENDING_ASSISTANT_ROW_KEY_PREFIX,
  USER_LOCATOR_HIGHLIGHT_MS,
  MIN_RENDERABLE_HISTORY_ROWS,
  MESSAGE_COLUMN_CLASS
} from './transcript/constants'

const log = createLogger('TranscriptScroller')

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
type TeamStoreSnapshot = ReturnType<typeof useTeamStore.getState>

const EMPTY_MESSAGES: UnifiedMessage[] = []
const EMPTY_TEAM_HISTORY: ActiveTeam[] = []
const EMPTY_USER_LOCATOR_ROWS: UserMessageIndexRow[] = []

interface TaskData {
  messages: UnifiedMessage[]
  messagesLoaded: boolean
  messageCount: number
  workingFolder?: string
  loadedRangeStart: number
}

interface TeamData {
  activeTeam: ActiveTeam | null
  teamHistory: ActiveTeam[]
  isTeamRunning: boolean
  hasOrchestrationData: boolean
  signature: string
}

const EMPTY_TASK_DATA: TaskData = {
  messages: EMPTY_MESSAGES,
  messagesLoaded: false,
  messageCount: 0,
  loadedRangeStart: 0,
  workingFolder: undefined
}

const EMPTY_TEAM_DATA: TeamData = {
  activeTeam: null,
  teamHistory: EMPTY_TEAM_HISTORY,
  isTeamRunning: false,
  hasOrchestrationData: false,
  signature: 'empty'
}

const teamSelectionCache = new Map<string, TeamData>()

// ─── helpers (unchanged) ───────────────────────────────────────────

function getMessageToolUseIds(message: UnifiedMessage): string[] {
  if (!Array.isArray(message.content)) return []
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => block.id)
    .filter(Boolean)
}

function hasCompleteTailToolExecutionResults(state: TailToolExecutionState | null): boolean {
  if (!state || state.toolUseBlocks.length === 0) return false
  return state.toolUseBlocks.every((toolUse) => state.toolResultMap.has(toolUse.id))
}

function buildTeamMemberRenderSignature(team: ActiveTeam): string {
  return team.members
    .map((m) =>
      [m.id, m.name, m.role ?? '', m.status, String(m.iteration),
       String(m.currentTaskId ?? ''), String(m.startedAt), String(m.completedAt ?? ''),
       m.streamingText ?? '', String(m.toolCalls.length)].join(':'))
    .join('|')
}

function buildTeamTaskRenderSignature(team: ActiveTeam): string {
  return team.tasks
    .map((t) => [t.id, t.subject, t.status, t.owner ?? '', t.description ?? '', t.report ?? ''].join(':'))
    .join('|')
}

function buildTeamMessageRenderSignature(team: ActiveTeam): string {
  const last = team.messages[team.messages.length - 1]
  return [String(team.messages.length), last?.id ?? '', last?.summary ?? '', last?.timestamp ?? ''].join(':')
}

function buildTeamRenderSignature(team: ActiveTeam): string {
  return [team.name, team.taskId ?? '', String(team.createdAt),
    buildTeamMemberRenderSignature(team), buildTeamTaskRenderSignature(team),
    buildTeamMessageRenderSignature(team)].join('::')
}

function isActiveTeamRunning(team: ActiveTeam): boolean {
  return team.tasks.some((t) => t.status !== 'completed') ||
    team.members.some((m) => m.status === 'working' || m.status === 'waiting')
}

function selectTaskData(state: ChatStoreSnapshot, taskId: string | null | undefined): TaskData {
  if (!taskId) return EMPTY_TASK_DATA
  const idx = state.tasksById[taskId]
  if (idx === undefined) return EMPTY_TASK_DATA
  const t = state.tasks[idx]
  return {
    messages: t.messages ?? EMPTY_MESSAGES,
    messagesLoaded: t.messagesLoaded ?? false,
    messageCount: t.messageCount ?? 0,
    workingFolder: t.workingFolder,
    loadedRangeStart: t.loadedRangeStart ?? 0
  }
}

function selectTeamData(state: TeamStoreSnapshot, taskId: string | null | undefined): TeamData {
  if (!taskId) return EMPTY_TEAM_DATA
  const activeTeam = state.activeTeams[taskId] ?? null
  let teamHistory = EMPTY_TEAM_HISTORY
  const parts: string[] = []

  if (activeTeam) parts.push(`active:${buildTeamRenderSignature(activeTeam)}`)
  for (const team of state.teamHistory) {
    if (team.taskId !== taskId) continue
    if (teamHistory === EMPTY_TEAM_HISTORY) teamHistory = []
    teamHistory.push(team)
    parts.push(`history:${buildTeamRenderSignature(team)}`)
  }

  const signature = parts.join('')
  const cached = teamSelectionCache.get(taskId)
  if (cached?.signature === signature) return cached

  const next: TeamData = {
    activeTeam, teamHistory,
    isTeamRunning: activeTeam ? isActiveTeamRunning(activeTeam) : false,
    hasOrchestrationData: Boolean(activeTeam) || teamHistory !== EMPTY_TEAM_HISTORY,
    signature
  }
  teamSelectionCache.set(taskId, next)
  return next
}

// ─── View layer (inside Provider — can use hooks) ──────────────────

interface TranscriptScrollerViewProps {
  // data
  messages: UnifiedMessage[]
  messageLookup: Map<string, UnifiedMessage>
  toolResultsLookup: Map<string, ToolResultsLookup>
  rows: TranscriptRowType[]
  userLocatorItems: UserMessageLocatorItem[]
  loadedRangeStart: number
  activeTaskId: string | null
  targetTaskId: string | null | undefined
  streamingMessageId: string | null
  hasStreamingMessage: boolean
  taskAssistantMessageIds: readonly string[]
  taskToolUseIds: readonly string[]
  taskRequestRetryState: import('@/lib/agent/types').RequestRetryState | null
  pendingAssistantMessage: UnifiedMessage
  showPendingAssistantRow: boolean
  lastMessageRowIndex: number

  // state
  highlightedMessageId: string | null
  setHighlightedMessageId: React.Dispatch<React.SetStateAction<string | null>>
  isLoadingOlderMessages: boolean

  // actions
  loadOlderMessages: () => Promise<number>
  onRetry?: () => void
  onContinue?: () => void
  onDeleteMessage?: (messageId: string) => void
  onRollbackMessage?: (messageId: string) => void
}

function TranscriptScrollerView({
  messages,
  messageLookup,
  toolResultsLookup,
  rows,
  userLocatorItems,
  loadedRangeStart,
  activeTaskId,
  targetTaskId,
  streamingMessageId,
  hasStreamingMessage,
  taskAssistantMessageIds,
  taskToolUseIds,
  taskRequestRetryState,
  pendingAssistantMessage,
  showPendingAssistantRow,
  lastMessageRowIndex,
  highlightedMessageId,
  setHighlightedMessageId,
  isLoadingOlderMessages,
  loadOlderMessages,
  onRetry,
  onContinue,
  onDeleteMessage,
  onRollbackMessage,
}: TranscriptScrollerViewProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { scrollToMessage } = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const visibility = useMessageScrollerVisibility()

  const highlightedMessageTimerRef = React.useRef<number | null>(null)

  // ── active locator from visibility ──
  const activeUserLocatorMessageId = React.useMemo(() => {
    if (userLocatorItems.length === 0) return null
    if (visibility.visibleMessageIds.length > 0) {
      for (const id of visibility.visibleMessageIds) {
        if (userLocatorItems.some((item) => item.id === id)) return id
      }
    }
    return visibility.currentAnchorId
  }, [visibility, userLocatorItems])

  // ── jump to user message ──
  const handleJumpToUserMessage = React.useCallback(
    async (item: UserMessageLocatorItem): Promise<void> => {
      const messageId = item.id

      const tryScroll = (): boolean => {
        const ok = scrollToMessage(messageId, { behavior: 'smooth' })
        if (ok) {
          setHighlightedMessageId(messageId)
          if (highlightedMessageTimerRef.current !== null) {
            window.clearTimeout(highlightedMessageTimerRef.current)
          }
          highlightedMessageTimerRef.current = window.setTimeout(() => {
            setHighlightedMessageId((prev) => (prev === messageId ? null : prev))
            highlightedMessageTimerRef.current = null
          }, USER_LOCATOR_HIGHLIGHT_MS)
        }
        return ok
      }

      if (tryScroll()) return
      if (!activeTaskId) return

      // message not loaded yet — load then retry
      await useChatStore.getState().loadTaskMessages(activeTaskId)
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
      })
      tryScroll()
    },
    [activeTaskId, scrollToMessage, setHighlightedMessageId]
  )

  // ── trigger load older when scrolled to top ──
  React.useEffect(() => {
    if (scrollable.start && !isLoadingOlderMessages && loadedRangeStart > 0) {
      void loadOlderMessages()
    }
  }, [scrollable.start, isLoadingOlderMessages, loadedRangeStart, loadOlderMessages])

  // ── cleanup timers ──
  React.useEffect(() => {
    return () => {
      if (highlightedMessageTimerRef.current !== null) {
        window.clearTimeout(highlightedMessageTimerRef.current)
      }
    }
  }, [])

  // ── render ──
  return (
    <MessageScroller.Root className="relative min-h-0 flex-1">
      <MessageScroller.Viewport
        preserveScrollOnPrepend
        aria-label={t('messageList.ariaLabel', { defaultValue: 'Conversation transcript' })}
      >
        <MessageScroller.Content aria-busy={hasStreamingMessage}>
          {/* Load older */}
          {loadedRangeStart > 0 && (
            <MessageScrollerItem messageId="load-older">
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
            </MessageScrollerItem>
          )}

          {/* Message rows */}
          {(() => {
            const liveCutoffIndex = Math.max(0, lastMessageRowIndex - TAIL_LIVE_MESSAGE_COUNT)

            return rows.map((row, rowIndex) => {
              const disableAnimation =
                lastMessageRowIndex >= 0
                  ? rowIndex >= Math.max(0, lastMessageRowIndex - (TAIL_STATIC_MESSAGE_COUNT - 1))
                  : false

              // pending assistant placeholder
              if (row.type === 'pending-assistant') {
                return (
                  <MessageScrollerItem key={row.key} messageId={row.key}>
                    <TranscriptRow
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
                      highlightMessageId={highlightedMessageId}
                      requestRetryState={taskRequestRetryState ?? null}
                      onRetry={onRetry}
                      onContinue={onContinue}
                      onDeleteMessage={onDeleteMessage}
                      onRollbackMessage={onRollbackMessage}
                    />
                  </MessageScrollerItem>
                )
              }

              const { messageId, isLastUserMessage, isLastAssistantMessage, showContinue } = row.data
              const message = messageLookup.get(messageId)
              if (!message) return null

              const isStreaming = streamingMessageId === messageId
              const rowRenderMode = !isStreaming && rowIndex < liveCutoffIndex ? 'static' : undefined

              return (
                <MessageScrollerItem
                  key={row.key}
                  messageId={messageId}
                >
                  <TranscriptRow
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
                </MessageScrollerItem>
              )
            })
          })()}
        </MessageScroller.Content>
      </MessageScroller.Viewport>

      <MessageScrollerButton />

      <UserMessageLocator
        items={userLocatorItems}
        activeMessageId={activeUserLocatorMessageId}
        onJump={handleJumpToUserMessage}
      />
    </MessageScroller.Root>
  )
}

// ─── Data layer (outside Provider — no scroll hooks) ───────────────

function TranscriptScrollerData(props: TranscriptScrollerProps): React.JSX.Element {
  const { taskId, onRetry, onContinue, onDeleteMessage, onRollbackMessage } = props
  const { t } = useTranslation('chat')
  const currentActiveTaskId = useChatStore((s) => s.activeTaskId)
  const targetTaskId = taskId ?? currentActiveTaskId

  const taskData = useChatStore(useShallow((s) => selectTaskData(s, targetTaskId)))
  const { messages, messagesLoaded, messageCount: activeTaskMessageCount, loadedRangeStart } = taskData

  const streamingMessageId = useChatStore((s) =>
    targetTaskId ? (s.streamingMessages[targetTaskId] ?? null) : null)
  const activeTaskId = targetTaskId

  const hasStreamingMessage = useChatStore((s) =>
    activeTaskId ? Boolean(s.streamingMessages[activeTaskId]) : false)

  const { isTaskRunning: isAgentTaskRunning } =
    useAgentStore((s) => selectTaskScopedAgentState(s, activeTaskId, { mode: 'coarse' }))

  const primaryTaskStatus = useAgentStore((s) =>
    activeTaskId ? (s.runningTasks[activeTaskId] ?? null) : null)

  const { isTeamRunning } = useTeamStore((s) => selectTeamData(s, activeTaskId))

  const isPrimaryTaskRunning = primaryTaskStatus === 'running' || primaryTaskStatus === 'retrying'
  const isTaskRunning = isAgentTaskRunning || isTeamRunning || hasStreamingMessage

  const taskRequestRetryState = useAgentStore((s) =>
    activeTaskId ? (s.taskRequestRetryState[activeTaskId] ?? null) : null)

  // ── transcript analysis ──
  const transcriptAnalysis = React.useMemo(
    () => buildTranscriptStaticAnalysis(messages), [messages])
  const { messageLookup, toolResultsLookup, tailToolExecutionState } = transcriptAnalysis

  // ── state ──
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = React.useState(false)
  const [userLocatorSnapshot, setUserLocatorSnapshot] = React.useState<{
    taskId: string | null; rows: UserMessageIndexRow[]
  }>({ taskId: null, rows: EMPTY_USER_LOCATOR_ROWS })

  const userLocatorRows =
    userLocatorSnapshot.taskId === activeTaskId ? userLocatorSnapshot.rows : EMPTY_USER_LOCATOR_ROWS

  // ── derived data ──
  const continueAssistantMessageId = React.useMemo(() => {
    if (streamingMessageId || isTaskRunning) return null
    if (!hasCompleteTailToolExecutionResults(tailToolExecutionState)) return null
    return tailToolExecutionState?.assistantMessageId ?? null
  }, [isTaskRunning, streamingMessageId, tailToolExecutionState])

  const showPendingAssistantRow = (isPrimaryTaskRunning || isTeamRunning) && !streamingMessageId

  const pendingAssistantRowKey = React.useMemo(
    () => `${PENDING_ASSISTANT_ROW_KEY_PREFIX}:${activeTaskId ?? currentActiveTaskId ?? 'active'}`,
    [activeTaskId, currentActiveTaskId])

  const pendingAssistantMessage = React.useMemo<UnifiedMessage>(
    () => ({ id: pendingAssistantRowKey, role: 'assistant', content: '', createdAt: 0 }),
    [pendingAssistantRowKey])

  const renderableMessages = React.useMemo(
    () => buildChatRenderableMessageMetaFromAnalysis(
      transcriptAnalysis, streamingMessageId, continueAssistantMessageId),
    [continueAssistantMessageId, streamingMessageId, transcriptAnalysis])

  const assistantChangeTargets = React.useMemo(
    () => messages
      .filter((m) => m.role === 'assistant')
      .map((m) => ({ messageId: m.id, toolUseIds: getMessageToolUseIds(m) })),
    [messages])

  const taskAssistantMessageIds = React.useMemo(
    () => assistantChangeTargets.map((t) => t.messageId), [assistantChangeTargets])

  const taskToolUseIds = React.useMemo(
    () => Array.from(new Set(assistantChangeTargets.flatMap((t) => t.toolUseIds))),
    [assistantChangeTargets])

  // ── user locator items ──
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

    messages.forEach((message, idx) => {
      if (message.role !== 'user') return
      const existing = sourcesById.get(message.id)
      sourcesById.set(message.id, {
        id: message.id, content: message.content, meta: message.meta,
        createdAt: message.createdAt,
        sortOrder: existing?.sortOrder ?? loadedRangeStart + idx,
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

  // ── rows ──
  const rows = React.useMemo(() => {
    const next: TranscriptRowType[] = renderableMessages.map((m) => ({
      type: 'message', key: m.messageId, data: m }))
    if (showPendingAssistantRow) {
      next.push({ type: 'pending-assistant', key: pendingAssistantRowKey })
    }
    return next
  }, [pendingAssistantRowKey, renderableMessages, showPendingAssistantRow])

  const isAwaitingInitialMessages =
    Boolean(activeTaskId) && messages.length === 0 &&
    (!messagesLoaded || activeTaskMessageCount > 0 || loadedRangeStart > 0)

  const lastMessageRowIndex = rows.length - 1

  // ── autoScroll: always enabled — the scroller natively releases on scroll-away
  // and re-engages via MessageScrollerButton / scrollToEnd().
  const autoScroll = true

  // ── effects ──
  React.useEffect(() => {
    let cancelled = false
    if (!activeTaskId) { setUserLocatorSnapshot({ taskId: null, rows: EMPTY_USER_LOCATOR_ROWS }); return }
    const load = async () => {
      try {
        const rows = await tauriCommands.invoke('db:messages:list-user', activeTaskId) as UserMessageIndexRow[] | null
        if (!cancelled) setUserLocatorSnapshot({ taskId: activeTaskId, rows: Array.isArray(rows) ? rows : EMPTY_USER_LOCATOR_ROWS })
      } catch (err) {
        log.error('Failed to load user message locator rows:', err)
        if (!cancelled) setUserLocatorSnapshot({ taskId: activeTaskId, rows: EMPTY_USER_LOCATOR_ROWS })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeTaskId, activeTaskMessageCount])

  React.useEffect(() => {
    if (!activeTaskId) return
    void useChatStore.getState().loadTaskMessages(activeTaskId)
  }, [activeTaskId])

  React.useEffect(() => {
    if (!activeTaskId || !streamingMessageId) return
    if (messages.some((m) => m.id === streamingMessageId)) return
    void useChatStore.getState().loadTaskMessages(activeTaskId, true)
  }, [activeTaskId, messages, streamingMessageId])

  // ── load older messages ──
  const loadOlderMessages = React.useCallback(async (): Promise<number> => {
    if (!activeTaskId || isLoadingOlderMessages || loadedRangeStart <= 0) return 0
    setIsLoadingOlderMessages(true)
    try {
      return await useChatStore.getState().loadOlderTaskMessages(activeTaskId)
    } finally {
      setIsLoadingOlderMessages(false)
    }
  }, [activeTaskId, isLoadingOlderMessages, loadedRangeStart])

  React.useEffect(() => {
    if (!activeTaskId || isAwaitingInitialMessages || isLoadingOlderMessages) return
    if (loadedRangeStart <= 0 || renderableMessages.length >= MIN_RENDERABLE_HISTORY_ROWS) return
    void loadOlderMessages()
  }, [activeTaskId, isAwaitingInitialMessages, isLoadingOlderMessages, loadOlderMessages, loadedRangeStart, renderableMessages.length])

  // ── skeleton / empty ──
  if (isAwaitingInitialMessages) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pt-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${MESSAGE_COLUMN_CLASS} space-y-2 ${i % 2 === 0 ? 'self-start' : 'self-end'}`}>
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (messages.length === 0 && !showPendingAssistantRow) {
    return <div className="min-h-0 flex-1" />
  }

  // ── main: wrap view in Provider ──
  const view = (
    <TranscriptScrollerView
      messages={messages}
      messageLookup={messageLookup}
      toolResultsLookup={toolResultsLookup}
      rows={rows}
      userLocatorItems={userLocatorItems}
      loadedRangeStart={loadedRangeStart}
      activeTaskId={activeTaskId}
      targetTaskId={targetTaskId}
      streamingMessageId={streamingMessageId}
      hasStreamingMessage={hasStreamingMessage}
      taskAssistantMessageIds={taskAssistantMessageIds}
      taskToolUseIds={taskToolUseIds}
      taskRequestRetryState={taskRequestRetryState ?? null}
      pendingAssistantMessage={pendingAssistantMessage}
      showPendingAssistantRow={showPendingAssistantRow}
      lastMessageRowIndex={lastMessageRowIndex}
      highlightedMessageId={highlightedMessageId}
      setHighlightedMessageId={setHighlightedMessageId}
      isLoadingOlderMessages={isLoadingOlderMessages}
      loadOlderMessages={loadOlderMessages}
      onRetry={onRetry}
      onContinue={onContinue}
      onDeleteMessage={onDeleteMessage}
      onRollbackMessage={onRollbackMessage}
    />
  )

  const content = (
    <MessageScrollerProvider autoScroll={autoScroll} defaultScrollPosition="last-anchor">
      {view}
    </MessageScrollerProvider>
  )

  return isStreamingPerformanceEnabled() ? (
    <React.Profiler
      id="TranscriptScroller"
      onRender={(_id, phase, actualDuration, baseDuration) => {
        recordStreamingReactCommit(actualDuration, { phase, baseDuration })
      }}
    >
      {content}
    </React.Profiler>
  ) : content
}

// ─── export ────────────────────────────────────────────────────────

export const TranscriptScroller = React.memo(
  TranscriptScrollerData,
  areTranscriptScrollerPropsEqual
)
