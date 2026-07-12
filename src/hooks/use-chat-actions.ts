import { useCallback, useEffect } from 'react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import { useChatStore } from '@/stores/chat-store'
import {
  useSettingsStore
} from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'
import { useAgentStore } from '@/stores/agent-store'
import { useInboxStore } from '@/stores/inbox-store'
import { useUIStore } from '@/stores/ui-store'
import { buildRuntimeReminder } from '@/lib/agent/dynamic-context'
import { toolRegistry } from '@/lib/agent/tool-registry'
import {
  decodeStructuredToolResult,
  encodeToolError,
  isStructuredToolErrorText
} from '@/lib/tools/tool-result-format'
import { buildAgentSystemPrompt, resolveEnvironmentContext } from '@/lib/agent/system-prompt'
import { WORKER_ONLY_TOOLS } from '@/lib/agent/teams/agent-tools'
import { useTeamStore } from '@/stores/team-store'
import { tauriCommands } from '@/services/tauri-api/command-client'

import type { ToolContext } from '@/lib/tools/tool-types'

import { useTodoStore } from '@/stores/todo-store'
import { useInputDraftStore, getTaskInputDraftKey } from '@/stores/input-draft-store'
import { generateTaskTitle } from '@/lib/api/generate-title'
import {
  RESPONSES_TASK_SCOPE_AGENT_MAIN,
  withResponsesTaskScope
} from '@/lib/api/responses-task-policy'
import type {
  UnifiedMessage,
  TokenUsage,
  RequestDebugInfo,
  ContentBlock,
  RequestTiming,
  ToolResultContent,
  MessageContextSnapshot
} from '@/lib/api/types'
import { setLastDebugInfo, setRequestTraceInfo } from '@/lib/debug-store'
import {
  QUEUED_IMAGE_ONLY_TEXT,
  cloneImageAttachments,
  extractEditableUserMessageDraft,
  imageAttachmentToContentBlock,
  isEditableUserMessage,
  type EditableUserMessageDraft,
  type ImageAttachment
} from '@/lib/chat/image-attachments'
import { type AgentEvent, type AgentLoopConfig, type ToolCallState } from '@/lib/agent/types'
import { ApiStreamError } from '@/services/tauri-api/api-stream'
import {
  compressMessages,
  mergeCompressedMessagesIntoConversation,
  resolveCompressionContextLength,
  resolveCompressionReservedOutputBudget,
  resolveCompressionThreshold
} from '@/lib/agent/context-compression'
import { runAgentLoop } from '@/lib/agent/agent-loop'
import {
  liveToolInputSignature,
  summarizeToolInputForHistory,
  summarizeToolInputForLiveCard
} from '@/lib/tools/tool-input-sanitizer'
import { recordStreamingToolArgsDuration } from '@/lib/devtools/streaming-performance'
import {
  addRuntimeMessage,
  appendRuntimeContentBlock,
  appendRuntimeTextDelta,
  appendRuntimeToolUse,
  completeRuntimeThinking,
  flushRuntimeForegroundMutations,
  flushBackgroundTaskToForeground,
  isTaskForeground,
  mergeRuntimeMessageUsage,
  setRuntimeThinkingEncryptedContent,
  updateRuntimeMessage,
  updateRuntimeToolUseInput
} from '@/lib/agent/task-runtime-router'
import {
  emitTaskRuntimeControlSync,
  emitTaskRuntimeSync,
} from '@/lib/agent/task-runtime-sync'

import {
  createStreamDeltaBuffer,
  type StreamDeltaBuffer,
  type LiveToolInputThrottleEntry,
  STREAM_DELTA_FLUSH_MS,
  BACKGROUND_STREAM_DELTA_FLUSH_MS,
  TOOL_INPUT_FLUSH_MS,
  AGENT_TOOL_INPUT_FLUSH_MS,
  BACKGROUND_TOOL_INPUT_FLUSH_MS
} from '@/lib/chat/stream-delta-buffer'
import {
  buildProviderConfigWithRuntimeSettings,
  resolveMainRequestProvider,
  estimateCurrentIterationContextTokens,
  summarizeActiveTeamForPromptCache
} from '@/lib/chat/provider-utils'
import type { CompressionConfig } from '@/lib/agent/context-compression'
import { loadMemoryIndex } from '@/lib/agent/memory-files'
import { buildPromptCacheKey, haveSameToolDefinitions } from '@/lib/chat/prompt-cache-key'
import { refreshDynamicToolCatalog } from '@/lib/tools/dynamic-tool-catalog'
import { registerCoreToolsOnce } from '@/lib/tools/registration'
import {
  getTailToolExecutionState,
  type TailToolExecutionState
} from '@/lib/chat/transcript-utils'

import {
  extractMessagePlainText,
  normalizeContinuationErrorMessage,
  shouldSuppressTransientRuntimeError,
} from '@/lib/chat/message-utils'
import {
  buildStreamingContextUsage,
  estimateContextTokensFromDebugInfo,
  findPersistedContextLength,
  getConfiguredMaxParallelTools,
  normalizeUsageWithEstimatedContext,
  requestPreciseResponsesContextTokens,
  shouldRequestPreciseResponsesContextTokens,
  shouldUseEstimatedContextTokens,
} from '@/lib/agent/context-estimation'

import {
  getTaskAbortController,
  setTaskAbortController,
  deleteTaskAbortController,
  isContinuingToolExecution,
  markContinuingToolExecution,
  unmarkContinuingToolExecution,
  registerAbortTeam,
  registerSetStreamingNull,
  stopTaskLocally,
} from '@/lib/agent/task-abort-control'

import {
  setSendMessageFn,
  getSendMessageFn,
  ensureTeamLeadListener,
  scheduleDrain,
  dispatchNextQueuedMessage,
  resetTeamAutoTrigger,
  unpauseAutoTrigger,
  resetAutoTriggerCount,
  registerHasActiveTaskRun,
} from '@/lib/agent/teams/auto-trigger'

import { useManualCompression } from './use-manual-compression'

import { createLogger } from '@/lib/logger'
import {
  ensureNotificationPermission,
  notifyTaskComplete,
  notifyApprovalNeeded,
  notifyTaskError,
  isAppFocused,
} from '@/services/notifications'

const log = createLogger('ChatActions')

async function abortAllTeammatesLazy(): Promise<void> {
  const { abortAllTeammates } = await import('@/lib/agent/teams/teammate-runner')
  abortAllTeammates()
}

// Clean up module-level Maps when tasks are deleted to prevent unbounded growth.
let knownTaskIds: Set<string> | null = null
useChatStore.subscribe((state) => {
  const currentIds = new Set(state.tasks.map((s) => s.id))
  if (knownTaskIds) {
    for (const id of knownTaskIds) {
      if (!currentIds.has(id)) {
        clearPendingTaskMessages(id)
      }
    }
  }
  knownTaskIds = currentIds
})

function addMessageWithSync(taskId: string, message: UnifiedMessage): void {
  useChatStore.getState().addMessage(taskId, message)
  emitTaskRuntimeSync({ kind: 'add_message', taskId, message })
}
void addMessageWithSync

function hasActiveTaskRun(taskId: string): boolean {
  const hasAbortController = Boolean(getTaskAbortController(taskId))
  const hasStreamingMessage = Boolean(useChatStore.getState().streamingMessages[taskId])
  return hasAbortController || hasStreamingMessage
}

function setStreamingMessageIdWithSync(taskId: string, messageId: string | null): void {
  if (messageId === null) {
    flushRuntimeForegroundMutations()
  }
  useChatStore.getState().setStreamingMessageId(taskId, messageId)
  emitTaskRuntimeSync({ kind: 'set_streaming_message', taskId, messageId })
}

function setGeneratingImageWithSync(messageId: string, generating: boolean): void {
  const occurredAt = Date.now()
  useChatStore.getState().setGeneratingImage(messageId, generating, occurredAt)
  emitTaskRuntimeSync({ kind: 'set_generating_image', messageId, generating, occurredAt })
}

function setGeneratingImagePreviewWithSync(messageId: string, preview: ContentBlock | null): void {
  useChatStore
    .getState()
    .setGeneratingImagePreview(messageId, preview?.type === 'image' ? preview : null)
  emitTaskRuntimeSync({
    kind: 'set_generating_image_preview',
    messageId,
    preview
  })
}

function resolveTaskWorkingFolder(
  taskItem?: { workingFolder?: string | null } | null,
  fallbackWorkingFolder?: string | null
): string | undefined {
  return taskItem?.workingFolder?.trim() || fallbackWorkingFolder?.trim() || undefined
}

// Re-exports from pending-messages.ts
import {
  type MessageSource,
  type SendMessageOptions,
  type PendingTaskMessageItem,
  QUEUED_MESSAGE_SYSTEM_REMIND,
  setPendingTaskDispatchPaused,
  replaceTaskPendingMessages,
  enqueuePendingTaskMessage,
  hasPendingTaskMessages,
  clearPendingTaskMessages,
  subscribePendingTaskMessages,
  getPendingTaskMessages,
  getPendingTaskMessageCountForTask,
  isPendingTaskDispatchPaused,
  updatePendingTaskMessageDraft,
  removePendingTaskMessage,
  hasPendingTaskMessagesForTask
} from '@/lib/chat/pending-messages'

export {
  type MessageSource,
  type SendMessageOptions,
  type PendingTaskMessageItem,
  clearPendingTaskMessages,
  subscribePendingTaskMessages,
  getPendingTaskMessages,
  getPendingTaskMessageCountForTask,
  isPendingTaskDispatchPaused,
  updatePendingTaskMessageDraft,
  removePendingTaskMessage,
  hasPendingTaskMessagesForTask
}

// Re-exports — consumers import these directly from use-chat-actions.ts
export { abortTask } from '@/lib/agent/task-abort-control'
export {
  resetTeamAutoTrigger,
  dispatchNextQueuedMessageForTask,
} from '@/lib/agent/teams/auto-trigger'

function getTaskProgressSnapshot(taskId: string): string {
  const tasks = useTodoStore.getState().getPlanItemsByTask(taskId)
  const pending = tasks.filter((task) => task.status === 'pending').length
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length
  const completed = tasks.filter((task) => task.status === 'completed').length
  return `${tasks.length}:${pending}:${inProgress}:${completed}`
}

function shouldClearCompletedTaskTasks(taskId: string): boolean {
  const tasks = useTodoStore.getState().getPlanItemsByTask(taskId)
  return tasks.length > 0 && tasks.every((task) => task.status === 'completed')
}

const LONG_RUNNING_COMPLETION_RE =
  /(全部(?:任务|工作|事项).{0,12}(?:完成|已完成)|任务(?:已|已经)?全部完成|all tasks? (?:are )?(?:complete|completed)|work is complete|completed successfully|finished successfully|no further action(?:s)? needed)/i

function assistantLooksComplete(message?: UnifiedMessage): boolean {
  return LONG_RUNNING_COMPLETION_RE.test(extractMessagePlainText(message))
}

function hasLiveToolOrBackgroundWork(taskId: string): boolean {
  const agentState = useAgentStore.getState()
  const toolCalls =
    agentState.liveTaskId === taskId
      ? [...agentState.executedToolCalls]
      : [
          ...(agentState.taskToolCallsCache[taskId]?.executed ?? [])
        ]
  const hasToolStillRunning = toolCalls.some(
    (toolCall) =>
      toolCall.status === 'streaming' ||
      toolCall.status === 'running'
  )
  if (hasToolStillRunning) return true

  return Object.values(agentState.backgroundProcesses).some(
    (process) => process.taskId === taskId && process.status === 'running'
  )
}

function shouldAutoContinueLongRunningRun(options: {
  taskId: string
  assistantMessageId: string
  loopEndReason: 'completed' | 'max_iterations' | 'aborted' | 'error' | null
  runUsedTools: boolean
  preRunTaskSnapshot: string
  verificationPassIndex: number
}): boolean {
  const {
    taskId,
    assistantMessageId,
    loopEndReason,
    runUsedTools,
    preRunTaskSnapshot,
    verificationPassIndex
  } = options

  if (loopEndReason === 'aborted' || loopEndReason === 'error') return false
  if (hasPendingTaskMessages(taskId) || isPendingTaskDispatchPaused(taskId))
    return false
  const activeStatus = useAgentStore.getState().runningTasks[taskId]
  if (activeStatus === 'running' || activeStatus === 'retrying') return false

  const messages = useChatStore.getState().getTaskMessages(taskId)
  const assistantMessage = messages.find((message) => message.id === assistantMessageId)
  const taskSnapshotChanged = getTaskProgressSnapshot(taskId) !== preRunTaskSnapshot
  const tasks = useTodoStore.getState().getPlanItemsByTask(taskId)
  const hasUnfinishedTasks = tasks.some(
    (task) => task.status === 'pending' || task.status === 'in_progress'
  )
  const tailToolExecution = getTailToolExecutionState(messages)
  const hasPendingToolExecution = Boolean(
    tailToolExecution?.toolUseBlocks.some(
      (toolUse) => !tailToolExecution.toolResultMap.has(toolUse.id)
    )
  )
  const completeBySelfReport = assistantLooksComplete(assistantMessage)

  if (hasUnfinishedTasks || hasPendingToolExecution || hasLiveToolOrBackgroundWork(taskId)) {
    return true
  }

  if (loopEndReason !== 'completed') {
    return true
  }

  // Tool usage alone is too weak a signal to keep auto-continuing for multiple
  // long-running verification passes. Read-only Bash checks in particular can
  // make the run look stuck while it re-verifies the same state repeatedly.
  if (taskSnapshotChanged) {
    return !completeBySelfReport && verificationPassIndex < 2
  }

  if (runUsedTools) {
    return !completeBySelfReport && verificationPassIndex < 1
  }

  if (!completeBySelfReport) {
    return verificationPassIndex < 2
  }

  return false
}

interface EditableUserMessageTarget {
  index: number
  draft: EditableUserMessageDraft
}

interface RetryAssistantTarget {
  assistantIndex: number
  userIndex: number
  draft: EditableUserMessageDraft
}

type ChatStoreState = ReturnType<typeof useChatStore.getState>

function findLastEditableUserMessage(messages: UnifiedMessage[]): EditableUserMessageTarget | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isEditableUserMessage(message)) {
      continue
    }

    return {
      index,
      draft: extractEditableUserMessageDraft(message.content)
    }
  }

  return null
}

function isToolResultOnlyUserMessage(message: UnifiedMessage): boolean {
  return (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.every((block) => block.type === 'tool_result')
  )
}

function findRetryAssistantTarget(
  messages: UnifiedMessage[],
  assistantMessageId: string
): RetryAssistantTarget | null {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId && message.role === 'assistant'
  )
  if (assistantIndex < 0) return null

  let userIndex = -1
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isEditableUserMessage(message)) continue
    userIndex = index
    break
  }
  if (userIndex < 0) return null

  return {
    assistantIndex,
    userIndex,
    draft: extractEditableUserMessageDraft(messages[userIndex].content)
  }
}

function shouldReloadTaskMessagesForMutation(
  chatStore: ChatStoreState,
  taskId: string
): boolean {
  const taskItem = chatStore.tasks.find((item) => item.id === taskId)
  if (!taskItem) return false

  const knownCount = taskItem.messageCount ?? taskItem.messages.length
  return (
    !taskItem.messagesLoaded ||
    taskItem.messages.length === 0 ||
    taskItem.loadedRangeStart > 0 ||
    taskItem.loadedRangeEnd < knownCount
  )
}

async function resolveTaskMessageTarget<T>(
  chatStore: ChatStoreState,
  taskId: string,
  resolver: (messages: UnifiedMessage[]) => T | null
): Promise<{ messages: UnifiedMessage[]; target: T | null }> {
  // Edit / retry / delete rely on absolute message positions. If the task is
  // currently showing only a paged window, a resident-array index is not the
  // same as the DB sort order and follow-up truncation will target the wrong
  // rows. Reload the full transcript before resolving the mutation target.
  if (shouldReloadTaskMessagesForMutation(chatStore, taskId)) {
    await chatStore.loadTaskMessages(taskId, true)
  }

  const messages = chatStore.getTaskMessages(taskId)
  const target = resolver(messages)
  return { messages, target }
}

function buildDeletedMessages(
  messages: UnifiedMessage[],
  messageId: string
): UnifiedMessage[] | null {
  const targetIndex = messages.findIndex((message) => message.id === messageId)
  if (targetIndex < 0) return null

  const target = messages[targetIndex]
  let deleteEnd = targetIndex + 1

  if (target.role === 'assistant') {
    while (deleteEnd < messages.length && isToolResultOnlyUserMessage(messages[deleteEnd])) {
      deleteEnd += 1
    }
  } else if (isEditableUserMessage(target)) {
    while (deleteEnd < messages.length && !isEditableUserMessage(messages[deleteEnd])) {
      deleteEnd += 1
    }
  } else {
    return null
  }

  return [...messages.slice(0, targetIndex), ...messages.slice(deleteEnd)]
}

function ensureRequestContainsExpectedUserMessage(
  messages: UnifiedMessage[],
  expectedUserMessage?: UnifiedMessage | null
): UnifiedMessage[] {
  if (!expectedUserMessage || expectedUserMessage.role !== 'user') {
    return messages
  }

  if (messages.some((message) => message.id === expectedUserMessage.id)) {
    return messages
  }

  log.warn('[ChatActions] Restoring missing user message in request payload', {
    messageId: expectedUserMessage.id,
    role: expectedUserMessage.role,
    existingMessageIds: messages.map((message) => message.id)
  })

  return [...messages, expectedUserMessage]
}

function extractToolErrorMessage(output: unknown): string | undefined {
  if (typeof output !== 'string' || !isStructuredToolErrorText(output)) return undefined
  const parsed = decodeStructuredToolResult(output)
  if (!parsed || Array.isArray(parsed)) return undefined
  return typeof parsed.error === 'string' ? parsed.error : undefined
}

function reconcileIterationToolResults(
  taskId: string,
  toolResults: { toolUseId: string; content: ToolResultContent; isError?: boolean }[]
): void {
  if (toolResults.length === 0) return

  const agentStore = useAgentStore.getState()
  const taskToolCalls = agentStore.taskToolCallsCache[taskId]
  const candidates = [
    ...agentStore.executedToolCalls,
    ...(taskToolCalls?.executed ?? [])
  ]
  const completedAt = Date.now()
  const seen = new Set<string>()

  for (const result of toolResults) {
    if (!result.toolUseId || seen.has(result.toolUseId)) continue
    seen.add(result.toolUseId)

    const existing = candidates.find((toolCall) => toolCall.id === result.toolUseId)
    if (!existing) continue

    if (
      (existing.status === 'completed' || existing.status === 'error') &&
      existing.output !== undefined
    ) {
      continue
    }

    const isError = result.isError === true
    const errorMessage = isError ? extractToolErrorMessage(result.content) : undefined
    const patch: Partial<ToolCallState> = {
      status: isError ? 'error' : 'completed',
      output: result.content,
      ...(errorMessage ? { error: errorMessage } : {}),
      completedAt
    }

    agentStore.updateToolCall(result.toolUseId, patch, taskId)
  }
}

function getStoredToolCallResult(
  taskId: string,
  toolUseId: string
): { content: ToolResultContent; isError: boolean; error?: string } | null {
  const agentState = useAgentStore.getState()
  const taskCache = agentState.taskToolCallsCache[taskId]
  const candidates = [
    ...agentState.executedToolCalls,
    ...(taskCache?.executed ?? [])
  ]

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const toolCall = candidates[index]
    if (toolCall.id !== toolUseId || toolCall.output === undefined) continue
    return {
      content: toolCall.output,
      isError: toolCall.status === 'error',
      error: toolCall.error
    }
  }

  return null
}

function collectAvailableContinuationToolResults(
  taskId: string,
  tailToolExecution: TailToolExecutionState
): {
  toolResultsById: Map<string, { content: ToolResultContent; isError?: boolean }>
  missingToolUses: TailToolExecutionState['toolUseBlocks']
} {
  const toolResultsById = new Map(tailToolExecution.toolResultMap)
  const missingToolUses: TailToolExecutionState['toolUseBlocks'] = []

  for (const toolUse of tailToolExecution.toolUseBlocks) {
    if (toolResultsById.has(toolUse.id)) continue

    const cachedResult = getStoredToolCallResult(taskId, toolUse.id)
    if (cachedResult) {
      toolResultsById.set(toolUse.id, {
        content: cachedResult.content,
        isError: cachedResult.isError
      })
      continue
    }

    missingToolUses.push(toolUse)
  }

  return { toolResultsById, missingToolUses }
}

// Wire up: hasActiveTaskRun dependency needed by team-auto-trigger
registerHasActiveTaskRun(hasActiveTaskRun)

// Wire up: abort team callback for task-abort-control
registerAbortTeam((taskId: string) => {
  const team = useTeamStore.getState().activeTeams[taskId] ?? null
  if (!team) return

  resetTeamAutoTrigger()
  abortAllTeammatesLazy()
})

// Wire up: setStreamingNull for task-abort-control
registerSetStreamingNull((taskId: string) => {
  setStreamingMessageIdWithSync(taskId, null)
})

/** Tasks that have already received an auto-generated title (one-shot per task) */
const _autoRenamedTaskIds = new Set<string>()

function hasSameMessageIdSequence(left: UnifiedMessage[], right: UnifiedMessage[]): boolean {
  return (
    left.length === right.length && left.every((message, index) => message.id === right[index]?.id)
  )
}

// 0 => unlimited iterations (run until loop_end by completion/error/abort)
const DEFAULT_AGENT_MAX_ITERATIONS = 0

function shouldHandleAgentEventAfterAbort(event: AgentEvent): boolean {
  switch (event.type) {
    case 'tool_call_result':
    case 'iteration_end':
    case 'message_end':
    case 'loop_end':
    case 'error':
      return true
    default:
      return false
  }
}

function applyRequestRetryState(
  taskId: string,
  event: Extract<AgentEvent, { type: 'request_retry' }>
): void {
  useAgentStore.getState().setTaskRequestRetryState(taskId, {
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    delayMs: event.delayMs,
    ...(event.statusCode ? { statusCode: event.statusCode } : {}),
    reason: event.reason
  })
}

function clearRequestRetryState(taskId: string): void {
  useAgentStore.getState().setTaskRequestRetryState(taskId, null)
}

export type ManualCompressionResult = 'compressed' | 'skipped' | 'blocked' | 'failed'

export function useChatActions(): {
  sendMessage: (
    text: string,
    images?: ImageAttachment[],
    source?: MessageSource,
    targetTaskId?: string,
    reuseAssistantMessageId?: string,
    options?: SendMessageOptions
  ) => Promise<void>
  stopStreaming: () => void
  continueLastToolExecution: () => Promise<void>
  retryLastMessage: () => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  rollbackMessage: (messageId: string) => Promise<void>
  manualCompressContext: (focusPrompt?: string) => Promise<ManualCompressionResult>
} {
  const activeTaskId = useChatStore((state) => state.activeTaskId)
  const { t } = useTranslation('chat')

  useEffect(() => {
    if (!activeTaskId) return
    let cancelled = false
    // IIFE so we can await inside useEffect. The cancelled flag avoids applying the
    // snapshot if the user switches away again mid-flush (rare but possible during
    // rapid taskItem hopping). The flush itself is idempotent — if cancelled fires the
    // snapshot has already been atomically drained by takeTaskSnapshot, so the data
    // is not lost.
    ;(async () => {
      try {
        await flushBackgroundTaskToForeground(activeTaskId)
      } catch (err) {
        if (!cancelled) log.error('flush background failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTaskId])

  const sendMessage = useCallback(
    async (
      text: string,
      images?: ImageAttachment[],
      source?: MessageSource,
      targetTaskId?: string,
      reuseAssistantMessageId?: string,
      options?: SendMessageOptions
    ): Promise<void> => {
      // Reset auto-trigger counter and unpause when user manually sends a message
      if (source !== 'team') {
        resetAutoTriggerCount()
        unpauseAutoTrigger()
      }

      const chatStore = useChatStore.getState()
      const settings = useSettingsStore.getState()
      const agentStore = useAgentStore.getState()
      const uiStore = useUIStore.getState()

      const providerStore = useProviderStore.getState()

      if (targetTaskId && !chatStore.tasks.some((s) => s.id === targetTaskId)) {
        // Task may have been created externally (e.g. channel auto-reply in the native backend).
        // Try reloading from DB before giving up.
        log.debug(`Task ${targetTaskId} not in store, reloading from DB...`)
        await useChatStore.getState().loadFromDb()
        const refreshedStore = useChatStore.getState()
        if (!refreshedStore.tasks.some((s) => s.id === targetTaskId)) {
          log.warn(
            `Task ${targetTaskId} still not found after DB reload, aborting`
          )
          replaceTaskPendingMessages(targetTaskId, [])
          return
        }
      }

      // Ensure we have an active task
      let taskId = targetTaskId ?? chatStore.activeTaskId
      if (!taskId) {
        taskId = chatStore.createTask()
      }
      if (source !== 'continue') {
        // Reset the back-to-back Task dedup guard on every fresh user turn —
        // the guard is only meant to block immediate retries within one loop,
        // not carry over into new user messages.
      }
      await chatStore.loadRecentTaskMessages(taskId)

      const inMemoryMessages = chatStore.getTaskMessages(taskId)
      const existingAssistantMessage =
        source === 'continue' && reuseAssistantMessageId
          ? inMemoryMessages.find(
              (message) => message.id === reuseAssistantMessageId && message.role === 'assistant'
            )
          : undefined

      const hasActiveRun = hasActiveTaskRun(taskId)
      const taskRunStatus = useAgentStore.getState().runningTasks[taskId]
      const statusIsRunning = taskRunStatus === 'running' || taskRunStatus === 'retrying'
      const hasPendingQueue = hasPendingTaskMessages(taskId)
      const isQueueDispatchPaused = isPendingTaskDispatchPaused(taskId)

      if (
        source !== 'continue' &&
        isQueueDispatchPaused &&
        hasPendingQueue &&
        source !== 'queued'
      ) {
        enqueuePendingTaskMessage(taskId, {
          text,
          images,
          source,
          options
        })
        if (source === undefined) {
          setPendingTaskDispatchPaused(taskId, false)
          dispatchNextQueuedMessage(taskId)
        }
        return
      }

      if (
        source !== 'continue' &&
        isQueueDispatchPaused &&
        source === undefined &&
        !hasPendingQueue
      ) {
        setPendingTaskDispatchPaused(taskId, false)
      }

      const shouldQueue =
        source !== 'continue' && (hasActiveRun || (statusIsRunning && source !== 'queued'))

      if (shouldQueue) {
        enqueuePendingTaskMessage(taskId, {
          text,
          images,
          source,
          options
        })
        return
      }

      let preflightIndicatorActive = false
      const clearPreflightIndicator = (): void => {
        if (!preflightIndicatorActive) return
        clearRequestRetryState(taskId)
        agentStore.setTaskStatus(taskId, null)
        preflightIndicatorActive = false
      }

      agentStore.setTaskStatus(taskId, 'running')
      preflightIndicatorActive = true

      try {
        if (
          options?.clearCompletedTasksOnTurnStart &&
          source !== 'continue' &&
          source !== 'team' &&
          shouldClearCompletedTaskTasks(taskId)
        ) {
          useTodoStore.getState().deletePlanItemTasks(taskId)
        }

        const _resolvedTask = useChatStore.getState().tasks.find((s) => s.id === taskId)
        const providerResolution = await resolveMainRequestProvider({
          taskId
        })
        const baseProviderConfig = buildProviderConfigWithRuntimeSettings(
          providerResolution.providerConfig,
          providerResolution.modelConfig,
          taskId,
          settings
        )

        if (
          !baseProviderConfig ||
          (!baseProviderConfig.apiKey && baseProviderConfig.requiresApiKey !== false)
        ) {
          clearPreflightIndicator()
          toast.error(t('errors.apiKeyRequired'), {
            description: t('errors.configureProvider'),
            action: { label: t('errors.openSettings'), onClick: () => uiStore.openSettingsPage('provider') }
          })
          return
        }

        if (baseProviderConfig.providerId) {
          const provider = providerStore.providers.find(
            (item) => item.id === baseProviderConfig.providerId
          )
          if (!provider?.apiKey) {
            clearPreflightIndicator()
            const authHint = t('errors.configureApiKey')
            toast.error(t('errors.authenticationRequired'), {
              description: authHint,
              action: {
                label: t('errors.openSettings'),
                onClick: () => uiStore.openSettingsPage('provider')
              }
            })
            return
          }
        }

        // After a manual abort, stale errored/orphaned tool blocks can remain at tail
        // and break the next request. Clean them before appending new user input.
        chatStore.sanitizeToolErrorsForResend(taskId)

        baseProviderConfig.taskId = taskId

        // Ensure workspace is set on the task before building context snapshot.
        // This handles the case where the user selected a workspace on the home page
        // (where taskId was null at selection time, so setWorkingFolder couldn't be called).
        if (options?.workspace && taskId) {
          const currentTask = useChatStore.getState().tasks.find((s) => s.id === taskId)
          if (currentTask && !currentTask.workingFolder) {
            chatStore.setWorkingFolder(taskId, options.workspace)
          }
        }

        // Add user message (multi-modal when images attached)
        const isQueuedInsertion = source === 'queued'
        const shouldAppendUserMessage = source !== 'continue'
        let expectedUserRequestMessage: UnifiedMessage | null = null
        if (shouldAppendUserMessage) {
          let userContent: string | ContentBlock[]
          const textBlocks: Array<Extract<ContentBlock, { type: 'text' }>> = []
          const hasImages = Boolean(images && images.length > 0)
          const textForUserBlock =
            text ||
            (isQueuedInsertion && hasImages
              ? QUEUED_IMAGE_ONLY_TEXT
              : '')

          if (isQueuedInsertion) {
            textBlocks.push({ type: 'text', text: QUEUED_MESSAGE_SYSTEM_REMIND })
          }

          if (textForUserBlock) {
            textBlocks.push({ type: 'text', text: textForUserBlock })
          }

          if (hasImages) {
            userContent = [...textBlocks, ...(images ?? []).map(imageAttachmentToContentBlock)]
          } else if (textBlocks.length === 1 && textBlocks[0]?.type === 'text') {
            userContent = textBlocks[0].text
          } else {
            userContent = textBlocks
          }

          // Build context snapshot for the user message
          const snapshotTask = useChatStore.getState().tasks.find((s) => s.id === taskId)
          const effectiveWorkspace = snapshotTask?.workingFolder || options?.workspace
          const contextSnapshot: MessageContextSnapshot = {}
          if (effectiveWorkspace) {
            contextSnapshot.workspace = effectiveWorkspace
          }
          if ((options?.fileCount ?? 0) > 0) {
            contextSnapshot.fileCount = options!.fileCount
          }
          if (hasImages && (images?.length ?? 0) > 0) {
            contextSnapshot.imageCount = images!.length
          }

          const userMsg: UnifiedMessage = {
            id: nanoid(),
            role: 'user',
            content: userContent,
            createdAt: Date.now(),
            ...(source && { source }),
            ...(Object.keys(contextSnapshot).length > 0
              ? { meta: { contextSnapshot } }
              : {}),
          }
          expectedUserRequestMessage = userMsg
        }

        // Auto-title: fire-and-forget AI title + icon generation for the first message (once per task)
        const taskItem = useChatStore.getState().tasks.find((s) => s.id === taskId)
        if (shouldAppendUserMessage && taskItem && !_autoRenamedTaskIds.has(taskId)) {
          const capturedTaskId = taskId
          generateTaskTitle(text)
            .then((result) => {
              if (result) {
                _autoRenamedTaskIds.add(capturedTaskId)
                const store = useChatStore.getState()
                const latestTask = store.tasks.find((item) => item.id === capturedTaskId)
                if (!latestTask) return
                store.updateTaskTitle(capturedTaskId, result.title)
              }
            })
            .catch((err) => {
              log.warn('Failed to generate title', err)
            })
        }

        // Create assistant placeholder message unless we're continuing on the same assistant bubble
        const assistantMsgId = existingAssistantMessage?.id ?? nanoid()
        const assistantMsgForTurn: UnifiedMessage | null = existingAssistantMessage
          ? null
          : {
              id: assistantMsgId,
              role: 'assistant',
              content: '',
              createdAt: Date.now()
            }

        // Atomic turn start: insert user + assistant messages and set streaming pointer in a single set()
        // to avoid 3 separate store updates causing 3 MessageList re-renders.
        const userMsgForTurn = shouldAppendUserMessage ? (expectedUserRequestMessage ?? null) : null
        if (userMsgForTurn || assistantMsgForTurn) {
          chatStore.beginUserTurn(taskId, userMsgForTurn, assistantMsgForTurn, assistantMsgId)
          if (userMsgForTurn) {
            emitTaskRuntimeSync({ kind: 'add_message', taskId, message: userMsgForTurn })
          }
          if (assistantMsgForTurn) {
            emitTaskRuntimeSync({ kind: 'add_message', taskId, message: assistantMsgForTurn })
          }
          emitTaskRuntimeSync({
            kind: 'set_streaming_message',
            taskId,
            messageId: assistantMsgId
          })
        } else {
          setStreamingMessageIdWithSync(taskId, assistantMsgId)
        }
        setGeneratingImagePreviewWithSync(assistantMsgId, null)

        const isImageRequest = baseProviderConfig.type === 'openai-images'
        if (isImageRequest) {
          setGeneratingImageWithSync(assistantMsgId, true)
        }

        // Setup abort controller (per-task)
        // If this task already has a running agent, abort it first
        const existingAc = getTaskAbortController(taskId)
        if (existingAc) existingAc.abort()
        const abortController = new AbortController()
        setTaskAbortController(taskId, abortController)

        await registerCoreToolsOnce()
        await refreshDynamicToolCatalog(resolveTaskWorkingFolder(taskItem, options?.workspace))

        const memorySnapshot = await loadMemoryIndex(tauriCommands)
        const taskWorkingFolder = resolveTaskWorkingFolder(taskItem)
        const environmentContext = resolveEnvironmentContext({
          workingFolder: taskWorkingFolder
        })
        const activeTeam = useTeamStore.getState().activeTeams[taskId] ?? null
        {
          // Tool-capable fixed agent loop
          const allToolDefs = toolRegistry.getDefinitions()
          // Main agent never gets worker-only tools (e.g. CompleteWork).
          let finalEffectiveToolDefs = allToolDefs.filter(
            (tool) => !WORKER_ONLY_TOOLS.has(tool.name)
          )

          // Image models: disable all tools (image generation doesn't use tools)
          // Exception: allow tools when continuing an existing agent run
          const resolvedModelConfig = providerResolution.modelConfig
          if (resolvedModelConfig?.category === 'image' && source !== 'continue') {
            finalEffectiveToolDefs = []
          }

          let userPrompt = ''

          const promptContextCacheKey = buildPromptCacheKey({
            language: settings.language,
            userRules: userPrompt || undefined,
            environmentContext,
            activeTeam: summarizeActiveTeamForPromptCache(activeTeam),
            memorySnapshot
          })
          const cachedPromptSnapshot = taskItem?.promptSnapshot
          const canReusePromptSnapshot =
            !!cachedPromptSnapshot &&
            (cachedPromptSnapshot.workingFolder ?? null) === (taskWorkingFolder ?? null) &&
            (cachedPromptSnapshot.sshConnectionId ?? null) === (taskItem?.sshConnectionId ?? null) &&
            cachedPromptSnapshot.contextCacheKey === promptContextCacheKey &&
            haveSameToolDefinitions(cachedPromptSnapshot.toolDefs, finalEffectiveToolDefs)

          let effectiveToolDefs = finalEffectiveToolDefs
          let agentSystemPrompt = cachedPromptSnapshot?.systemPrompt ?? ''

          if (canReusePromptSnapshot && cachedPromptSnapshot) {
            effectiveToolDefs = cachedPromptSnapshot.toolDefs.slice()
          } else {
            agentSystemPrompt = await buildAgentSystemPrompt({
              workingFolder: taskWorkingFolder,
              taskId,
              userRules: userPrompt || undefined,
              toolDefs: finalEffectiveToolDefs,
              language: settings.language,
              hasActiveTeam: !!activeTeam,
              activeTeam,
              memorySnapshot,
              environmentContext
            })

            useChatStore.getState().setTaskPromptSnapshot(taskId, {
              systemPrompt: agentSystemPrompt,
              toolDefs: finalEffectiveToolDefs,
              workingFolder: taskWorkingFolder,
              sshConnectionId: taskItem?.sshConnectionId ?? null,
              contextCacheKey: promptContextCacheKey
            })
          }

          const agentProviderConfig = withResponsesTaskScope(
            {
              ...baseProviderConfig,
              systemPrompt: agentSystemPrompt
            },
            RESPONSES_TASK_SCOPE_AGENT_MAIN
          )
          setRequestTraceInfo(assistantMsgId, {
            providerId: agentProviderConfig.providerId,
            providerBuiltinId: agentProviderConfig.providerBuiltinId,
            model: agentProviderConfig.model
          })
          let compressionContextLength = resolvedModelConfig?.contextLength
            ? resolveCompressionContextLength(resolvedModelConfig)
            : 0
          let compressionConfig: CompressionConfig | null = null

          agentStore.setRunning(true)
          preflightIndicatorActive = false
          clearRequestRetryState(taskId)
          agentStore.setTaskStatus(taskId, 'running')
          agentStore.resetLiveTaskExecution(taskId)

          // Accumulate usage across all iterations
          const accumulatedUsage: TokenUsage = existingAssistantMessage?.usage
            ? { ...existingAssistantMessage.usage }
            : { inputTokens: 0, outputTokens: 0 }
          const requestTimings: RequestTiming[] = []
          const loopStartedAt = Date.now()
          let currentUsageProviderId = agentProviderConfig.providerId ?? null
          let currentUsageModelId = agentProviderConfig.model ?? null
          let lastRequestDebugInfo: RequestDebugInfo | undefined
          let preciseContextTokens: number | null = null
          let preciseContextTokenRequestSeq = 0

          // NOTE: Team events are handled by a persistent global subscription
          // in register.ts — not scoped here, because teammate loops outlive the lead's loop.

          // Request notification permission on first agent run
          ensureNotificationPermission().catch(() => {})

          let streamDeltaBuffer: StreamDeltaBuffer | null = null
          const preRunTaskSnapshot = getTaskProgressSnapshot(taskId)
          let runUsedTools = false
          let shouldAutoContinueLongRunning = false
          const liveToolNames = new Map<string, string>()

          // Tool input throttling state — defined before try block so finally can safely dispose
          const liveToolInputThrottle = new Map<string, LiveToolInputThrottleEntry>()
          const unthrottledLiveToolInputs = new Set([
            'TaskCreate',
            'TaskUpdate'
          ])

          const disposeToolInputQueues = (): void => {
            for (const entry of liveToolInputThrottle.values()) {
              if (entry.chatTimer) clearTimeout(entry.chatTimer)
              if (entry.agentTimer) clearTimeout(entry.agentTimer)
            }
            liveToolInputThrottle.clear()
          }

          try {
            const requestContextMaxMessages =
              compressionContextLength > 0 ? null : undefined
            let messagesToSend = await useChatStore
              .getState()
              .getTaskMessagesForRequest(taskId, {
                includeTrailingAssistantPlaceholder: !!existingAssistantMessage,
                requestContextMaxMessages
              })
            messagesToSend = ensureRequestContainsExpectedUserMessage(
              messagesToSend,
              expectedUserRequestMessage
            )

            if (compressionContextLength <= 0) {
              compressionContextLength = findPersistedContextLength(messagesToSend)
            }
            compressionConfig =
              compressionContextLength > 0
                ? {
                    enabled: true,
                    contextLength: compressionContextLength,
                    threshold: resolveCompressionThreshold(resolvedModelConfig),
                    preCompressThreshold: 0.65,
                    reservedOutputBudget:
                      resolveCompressionReservedOutputBudget(resolvedModelConfig)
                  }
                : null

            // Build and inject a runtime reminder into the last user message
            const shouldInjectContext = true

            if (source !== 'continue' && shouldInjectContext && messagesToSend.length > 0) {
              const runtimeReminder = await buildRuntimeReminder({
                taskId,
                modelConfig: resolvedModelConfig
              })

              if (runtimeReminder) {
                // Find the last user message and prepend the runtime reminder to its content
                const lastUserIndex = messagesToSend.findLastIndex((m) => m.role === 'user')
                if (lastUserIndex >= 0) {
                  const lastUserMsg = messagesToSend[lastUserIndex]
                  const contextBlock = { type: 'text' as const, text: runtimeReminder }

                  let newContent: ContentBlock[]
                  if (typeof lastUserMsg.content === 'string') {
                    newContent = [
                      contextBlock,
                      { type: 'text' as const, text: lastUserMsg.content }
                    ]
                  } else {
                    newContent = [contextBlock, ...lastUserMsg.content]
                  }

                  log.debug('Injecting context into last user message:', {
                    messageId: lastUserMsg.id,
                    originalContentType: typeof lastUserMsg.content,
                    newContentLength: newContent.length,
                    contextPreview: runtimeReminder.substring(0, 100)
                  })

                  messagesToSend = [
                    ...messagesToSend.slice(0, lastUserIndex),
                    { ...lastUserMsg, content: newContent },
                    ...messagesToSend.slice(lastUserIndex + 1)
                  ]
                }
              }
            }

            const maxParallelTools = getConfiguredMaxParallelTools()

            log.info('Agent execution tools', {
              taskId,
              executionPath: 'frontend',
              providerType: agentProviderConfig.type,
              toolNames: effectiveToolDefs.map((tool) => tool.name),
              toolCount: effectiveToolDefs.length
            })

            setRequestTraceInfo(assistantMsgId, {
              executionPath: 'frontend'
            })

            const loopConfig: AgentLoopConfig = {
              maxIterations: DEFAULT_AGENT_MAX_ITERATIONS,
              provider: agentProviderConfig,
              tools: effectiveToolDefs,
              systemPrompt: agentSystemPrompt,
              workingFolder: taskWorkingFolder,
              signal: abortController.signal,
              enableParallelToolExecution: true,
              maxParallelTools,
              ...(compressionConfig && compressionContextLength > 0
                ? {
                    contextCompression: {
                      config: compressionConfig,
                      compressFn: async (msgs: UnifiedMessage[]) => {
                        const { messages: compressed } = await compressMessages(
                          msgs,
                          agentProviderConfig,
                          abortController.signal
                        )
                        return compressed
                      }
                    }
                  }
                : {})
            }

            const toolCtx: ToolContext = {
              taskId,
              runId: assistantMsgId,
              workingFolder: taskWorkingFolder,
              signal: abortController.signal,
              commands: tauriCommands,
              readFileHistory: new Map(),
              sharedState: {}
            }

            // Ensure agent store's liveTaskId matches the executing task
            // so tool calls are written to executedToolCalls, not the task cache
            const currentLiveTaskId = useAgentStore.getState().liveTaskId
            if (currentLiveTaskId !== taskId) {
              useAgentStore.getState().switchToolCallTask(currentLiveTaskId, taskId!)
            }

            const loop = runAgentLoop(messagesToSend, loopConfig, toolCtx)

            let thinkingDone = false
            let hasThinkingDelta = false
            streamDeltaBuffer = createStreamDeltaBuffer(
              taskId!,
              assistantMsgId,
              isTaskForeground(taskId!)
                ? STREAM_DELTA_FLUSH_MS
                : BACKGROUND_STREAM_DELTA_FLUSH_MS,
              isTaskForeground(taskId!) ? TOOL_INPUT_FLUSH_MS : BACKGROUND_TOOL_INPUT_FLUSH_MS
            )

            const getLiveToolInputEntry = (toolCallId: string): LiveToolInputThrottleEntry => {
              let entry = liveToolInputThrottle.get(toolCallId)
              if (!entry) {
                entry = {
                  lastChatFlush: 0,
                  lastAgentFlush: 0,
                  lineCountCache: new Map()
                }
                liveToolInputThrottle.set(toolCallId, entry)
              }
              return entry
            }

            const clearToolInputPending = (toolCallId: string): void => {
              const entry = liveToolInputThrottle.get(toolCallId)
              if (!entry) return
              if (entry.chatTimer) {
                clearTimeout(entry.chatTimer)
                entry.chatTimer = undefined
              }
              if (entry.agentTimer) {
                clearTimeout(entry.agentTimer)
                entry.agentTimer = undefined
              }
              entry.pendingRaw = undefined
              entry.pendingSummary = undefined
              entry.pendingSignature = undefined
            }

            const maybeClearDeliveredToolInput = (toolCallId: string, signature: string): void => {
              const entry = liveToolInputThrottle.get(toolCallId)
              if (!entry || entry.pendingSignature !== signature) return
              const needsAgentUpdate = isTaskForeground(taskId!)
              if (
                entry.lastChatSent === signature &&
                (!needsAgentUpdate || entry.lastAgentSent === signature)
              ) {
                entry.pendingRaw = undefined
                entry.pendingSummary = undefined
                entry.pendingSignature = undefined
              }
            }

            const getPendingLiveToolInput = (
              toolCallId: string,
              toolName = liveToolNames.get(toolCallId) ?? ''
            ): { summary: Record<string, unknown>; signature: string } | null => {
              const entry = liveToolInputThrottle.get(toolCallId)
              if (!entry?.pendingRaw) return null

              if (!entry.pendingSummary || !entry.pendingSignature) {
                const startedAt = performance.now()
                const summary = summarizeToolInputForLiveCard(toolName, entry.pendingRaw, {
                  lineCountCache: entry.lineCountCache,
                  cacheKeyPrefix: `${toolCallId}:${toolName || 'unknown'}`
                })
                const signature = liveToolInputSignature(summary)
                entry.pendingSummary = summary
                entry.pendingSignature = signature
                recordStreamingToolArgsDuration(performance.now() - startedAt, {
                  toolCallId,
                  toolName,
                  inputKeys: Object.keys(entry.pendingRaw).length,
                  outputKeys: Object.keys(summary).length
                })
              }

              return {
                summary: entry.pendingSummary,
                signature: entry.pendingSignature
              }
            }

            const summarizeImmediateLiveToolInput = (
              toolCallId: string,
              toolName: string,
              input: Record<string, unknown>
            ): Record<string, unknown> => {
              const entry = getLiveToolInputEntry(toolCallId)
              const startedAt = performance.now()
              const summary = summarizeToolInputForLiveCard(toolName, input, {
                lineCountCache: entry.lineCountCache,
                cacheKeyPrefix: `${toolCallId}:${toolName || 'unknown'}`
              })
              recordStreamingToolArgsDuration(performance.now() - startedAt, {
                toolCallId,
                toolName,
                inputKeys: Object.keys(input).length,
                outputKeys: Object.keys(summary).length,
                immediate: true
              })
              return summary
            }

            const flushChatToolInput = (toolCallId: string, toolName?: string): void => {
              const entry = liveToolInputThrottle.get(toolCallId)
              if (!entry?.pendingRaw) return
              const pending = getPendingLiveToolInput(toolCallId, toolName)
              if (!pending) return
              entry.lastChatFlush = Date.now()
              if (pending.signature !== entry.lastChatSent) {
                entry.lastChatSent = pending.signature
                updateRuntimeToolUseInput(taskId!, assistantMsgId, toolCallId, pending.summary)
              }
              maybeClearDeliveredToolInput(toolCallId, pending.signature)
            }

            const flushAgentToolInput = (toolCallId: string, toolName?: string): void => {
              if (!isTaskForeground(taskId!)) return
              const entry = liveToolInputThrottle.get(toolCallId)
              if (!entry?.pendingRaw) return
              const pending = getPendingLiveToolInput(toolCallId, toolName)
              if (!pending) return
              entry.lastAgentFlush = Date.now()
              if (pending.signature !== entry.lastAgentSent) {
                entry.lastAgentSent = pending.signature
                useAgentStore
                  .getState()
                  .updateToolCall(toolCallId, { input: pending.summary }, taskId!)
              }
              maybeClearDeliveredToolInput(toolCallId, pending.signature)
            }

            const scheduleLiveToolInputUpdate = (
              toolCallId: string,
              partialInput: Record<string, unknown>,
              toolName = ''
            ): void => {
              const now = Date.now()
              const entry = getLiveToolInputEntry(toolCallId)
              entry.pendingRaw = partialInput
              entry.pendingSummary = undefined
              entry.pendingSignature = undefined

              if (unthrottledLiveToolInputs.has(toolName)) {
                if (entry.chatTimer) {
                  clearTimeout(entry.chatTimer)
                  entry.chatTimer = undefined
                }
                if (entry.agentTimer) {
                  clearTimeout(entry.agentTimer)
                  entry.agentTimer = undefined
                }
                flushChatToolInput(toolCallId, toolName)
                flushAgentToolInput(toolCallId, toolName)
                return
              }

              const chatDelay = Math.max(0, TOOL_INPUT_FLUSH_MS - (now - entry.lastChatFlush))
              if (chatDelay === 0) {
                if (entry.chatTimer) {
                  clearTimeout(entry.chatTimer)
                  entry.chatTimer = undefined
                }
                flushChatToolInput(toolCallId, toolName)
              } else if (!entry.chatTimer) {
                entry.chatTimer = setTimeout(() => {
                  entry.chatTimer = undefined
                  flushChatToolInput(toolCallId, toolName)
                }, chatDelay)
              }

              const agentInterval = isTaskForeground(taskId!)
                ? AGENT_TOOL_INPUT_FLUSH_MS
                : BACKGROUND_TOOL_INPUT_FLUSH_MS
              const agentDelay = Math.max(0, agentInterval - (now - entry.lastAgentFlush))
              if (agentDelay === 0) {
                if (entry.agentTimer) {
                  clearTimeout(entry.agentTimer)
                  entry.agentTimer = undefined
                }
                flushAgentToolInput(toolCallId, toolName)
              } else if (!entry.agentTimer) {
                entry.agentTimer = setTimeout(() => {
                  entry.agentTimer = undefined
                  flushAgentToolInput(toolCallId, toolName)
                }, agentDelay)
              }
            }

            for await (const event of loop) {
              if (abortController.signal.aborted && !shouldHandleAgentEventAfterAbort(event)) {
                continue
              }

              if (event.type !== 'request_retry' && event.type !== 'request_debug') {
                clearRequestRetryState(taskId!)
              }

              switch (event.type) {
                case 'request_retry':
                  applyRequestRetryState(taskId!, event)
                  break

                case 'thinking_delta':
                  hasThinkingDelta = true
                  streamDeltaBuffer.pushThinking(event.thinking)
                  break

                case 'thinking_encrypted':
                  if (event.thinkingEncryptedContent && event.thinkingEncryptedProvider) {
                    setRuntimeThinkingEncryptedContent(
                      taskId!,
                      assistantMsgId,
                      event.thinkingEncryptedContent,
                      event.thinkingEncryptedProvider
                    )
                  }
                  break

                case 'text_delta':
                  if (!thinkingDone) {
                    const chunk = event.text ?? ''
                    const closeThinkTagMatch = hasThinkingDelta
                      ? chunk.match(/<\s*\/\s*think\s*>/i)
                      : null
                    if (closeThinkTagMatch && closeThinkTagMatch.index !== undefined) {
                      const beforeClose = chunk.slice(0, closeThinkTagMatch.index)
                      const afterClose = chunk.slice(
                        closeThinkTagMatch.index + closeThinkTagMatch[0].length
                      )
                      if (beforeClose) {
                        streamDeltaBuffer.pushThinking(beforeClose)
                      }
                      streamDeltaBuffer.flushNow()
                      thinkingDone = true
                      completeRuntimeThinking(taskId!, assistantMsgId)
                      if (afterClose) {
                        streamDeltaBuffer.pushText(afterClose)
                      }
                      break
                    }
                    thinkingDone = true
                    streamDeltaBuffer.flushNow()
                    completeRuntimeThinking(taskId!, assistantMsgId)
                  }
                  streamDeltaBuffer.pushText(event.text)
                  break

                case 'image_generation_started':
                  if (isTaskForeground(taskId!)) {
                    setGeneratingImageWithSync(assistantMsgId, true)
                  }
                  break

                case 'image_generation_partial':
                  if (event.imageBlock && isTaskForeground(taskId!)) {
                    setGeneratingImageWithSync(assistantMsgId, true)
                    setGeneratingImagePreviewWithSync(assistantMsgId, event.imageBlock)
                  }
                  break

                case 'image_generated':
                  // Flush any pending text before adding image
                  streamDeltaBuffer.flushNow()
                  if (!thinkingDone) {
                    thinkingDone = true
                    completeRuntimeThinking(taskId!, assistantMsgId)
                  }
                  // Add image block to assistant message
                  if (event.imageBlock) {
                    appendRuntimeContentBlock(taskId!, assistantMsgId, event.imageBlock)
                  }
                  setGeneratingImagePreviewWithSync(assistantMsgId, null)
                  // Clear generating state after first image
                  if (isTaskForeground(taskId!)) {
                    setGeneratingImageWithSync(assistantMsgId, false)
                  }
                  break

                case 'image_error':
                  streamDeltaBuffer.flushNow()
                  if (!thinkingDone) {
                    thinkingDone = true
                    completeRuntimeThinking(taskId!, assistantMsgId)
                  }
                  if (event.imageError) {
                    appendRuntimeContentBlock(taskId!, assistantMsgId, {
                      type: 'image_error',
                      code: event.imageError.code,
                      message: event.imageError.message
                    })
                  }
                  setGeneratingImagePreviewWithSync(assistantMsgId, null)
                  if (isTaskForeground(taskId!)) {
                    setGeneratingImageWithSync(assistantMsgId, false)
                  }
                  break

                case 'tool_use_streaming_start':
                  liveToolNames.set(event.toolCallId, event.toolName)
                  // Preserve stream order: flush any pending thinking/text before inserting tool block.
                  streamDeltaBuffer.flushNow()
                  if (!thinkingDone) {
                    thinkingDone = true
                    completeRuntimeThinking(taskId!, assistantMsgId)
                  }
                  // Immediately show tool card with name while args are still streaming
                  appendRuntimeToolUse(taskId!, assistantMsgId, {
                    type: 'tool_use',
                    id: event.toolCallId,
                    name: event.toolName,
                    input: {},
                    ...(event.toolCallExtraContent
                      ? { extraContent: event.toolCallExtraContent }
                      : {})
                  })
                  if (isTaskForeground(taskId!)) {
                    useAgentStore.getState().addToolCall(
                      {
                        id: event.toolCallId,
                        name: event.toolName,
                        input: {},
                        status: 'streaming',
                        ...(event.toolCallExtraContent
                          ? { extraContent: event.toolCallExtraContent }
                          : {})
                      },
                      taskId!
                    )
                  }
                  break

                case 'tool_use_args_delta': {
                  // Real-time partial args update via partial-json parsing
                  const toolName = liveToolNames.get(event.toolCallId) ?? ''
                  scheduleLiveToolInputUpdate(event.toolCallId, event.partialInput, toolName)
                  break
                }

                case 'tool_use_generated': {
                  runUsedTools = true
                  liveToolNames.set(event.toolUseBlock.id, event.toolUseBlock.name)
                  // Some providers emit only tool_use_generated without a prior tool_use_streaming_start.
                  // Ensure the assistant message has a visible tool block so later results can attach to it.
                  const isFg = isTaskForeground(taskId!)
                  const alreadyTracked =
                    isFg &&
                    [
                      ...useAgentStore.getState().executedToolCalls,
                      ...(useAgentStore.getState().taskToolCallsCache[taskId!]?.executed ??
                        [])
                    ].some((tc) => tc.id === event.toolUseBlock.id)
                  if (!alreadyTracked) {
                    streamDeltaBuffer.flushNow()
                    if (!thinkingDone) {
                      thinkingDone = true
                      completeRuntimeThinking(taskId!, assistantMsgId)
                    }
                    appendRuntimeToolUse(taskId!, assistantMsgId, {
                      type: 'tool_use',
                      id: event.toolUseBlock.id,
                      name: event.toolUseBlock.name,
                      input: summarizeImmediateLiveToolInput(
                        event.toolUseBlock.id,
                        event.toolUseBlock.name,
                        event.toolUseBlock.input
                      ),
                      ...(event.toolUseBlock.extraContent
                        ? { extraContent: event.toolUseBlock.extraContent }
                        : {})
                    })
                    if (isFg) {
                      useAgentStore.getState().addToolCall(
                        {
                          id: event.toolUseBlock.id,
                          name: event.toolUseBlock.name,
                          input: summarizeImmediateLiveToolInput(
                            event.toolUseBlock.id,
                            event.toolUseBlock.name,
                            event.toolUseBlock.input
                          ),
                          status: 'running',
                          ...(event.toolUseBlock.extraContent
                            ? { extraContent: event.toolUseBlock.extraContent }
                            : {}),
                          startedAt: Date.now()
                        },
                        taskId!
                      )
                    }
                  }
                  // Args fully streamed — keep live cards compact until execution finishes.
                  clearToolInputPending(event.toolUseBlock.id)
                  const liveCardInput = summarizeImmediateLiveToolInput(
                    event.toolUseBlock.id,
                    event.toolUseBlock.name,
                    event.toolUseBlock.input
                  )
                  streamDeltaBuffer.setToolInput(event.toolUseBlock.id, liveCardInput)
                  streamDeltaBuffer.flushNow()
                  if (isTaskForeground(taskId!)) {
                    useAgentStore.getState().updateToolCall(
                      event.toolUseBlock.id,
                      {
                        input: liveCardInput,
                        status: 'running',
                        ...(event.toolUseBlock.extraContent
                          ? { extraContent: event.toolUseBlock.extraContent }
                          : {})
                      },
                      taskId!
                    )
                  }
                  break
                }

                case 'tool_call_start':
                  runUsedTools = true
                  liveToolNames.set(event.toolCall.id, event.toolCall.name)
                  if (isTaskForeground(taskId!)) {
                    useAgentStore.getState().addToolCall(
                      {
                        ...event.toolCall,
                        input: summarizeImmediateLiveToolInput(
                          event.toolCall.id,
                          event.toolCall.name,
                          event.toolCall.input
                        )
                      },
                      taskId!
                    )
                  }
                  break

                case 'tool_call_approval_needed': {
                  const command = String(event.toolCall.input?.command ?? event.toolCall.name)
                  useInboxStore.getState().addInboxItem({
                    taskId: taskId!,
                    type: 'approval',
                    title: command,
                    description: event.toolCall.name,
                    toolUseId: event.toolCall.id,
                  })
                  useUIStore.getState().openRightPanel(taskId)
                  // Notify when approval is needed and app is in background
                  {
                    const taskTitle =
                      useChatStore.getState().tasks.find((t) => t.id === taskId)?.title ?? ''
                    notifyApprovalNeeded(
                      taskId!,
                      t('notifications.approvalNeededTitle'),
                      t('notifications.approvalNeededBody', { title: taskTitle }),
                    )
                  }
                  break
                }

                case 'tool_call_result': {
                  liveToolNames.set(event.toolCall.id, event.toolCall.name)
                  clearToolInputPending(event.toolCall.id)
                  const settledInput =
                    event.toolCall.status === 'completed' || event.toolCall.status === 'error'
                      ? summarizeToolInputForHistory(event.toolCall.name, event.toolCall.input)
                      : undefined
                  if (settledInput) {
                    updateRuntimeToolUseInput(
                      taskId!,
                      assistantMsgId,
                      event.toolCall.id,
                      settledInput
                    )
                  }
                  if (isTaskForeground(taskId!)) {
                    useAgentStore.getState().updateToolCall(
                      event.toolCall.id,
                      {
                        ...(settledInput ? { input: settledInput } : {}),
                        status: event.toolCall.status,
                        output: event.toolCall.output,
                        error: event.toolCall.error,
                        completedAt: event.toolCall.completedAt
                      },
                      taskId!
                    )
                    if (
                      event.toolCall.status === 'completed' ||
                      event.toolCall.status === 'error'
                    ) {
                      // tool call completed
                    }
                    // File-change journaling is handled synchronously by the
                    // journaling command proxy at mutation time; no refresh here
                    // (a DB re-read now would race the debounced persist write
                    // and wipe the just-recorded in-memory entries).
                  }
                  if (event.toolCall.status === 'completed' || event.toolCall.status === 'error') {
                    liveToolNames.delete(event.toolCall.id)
                  }
                  break
                }

                case 'iteration_end': {
                  streamDeltaBuffer.flushNow()
                  // Reset so the next iteration's thinking block gets properly completed
                  thinkingDone = false
                  // When an iteration ends with tool results, append tool_result user message.
                  // The next iteration's text/tool_use will continue appending to the same assistant message.
                  if (event.toolResults && event.toolResults.length > 0) {
                    reconcileIterationToolResults(taskId!, event.toolResults)
                    const toolResultMsg: UnifiedMessage = {
                      id: nanoid(),
                      role: 'user',
                      content: event.toolResults.map((tr) => ({
                        type: 'tool_result' as const,
                        toolUseId: tr.toolUseId,
                        content: tr.content,
                        isError: tr.isError
                      })),
                      createdAt: Date.now()
                    }
                    addRuntimeMessage(taskId!, toolResultMsg)
                  }
                  if (hasPendingTaskMessages(taskId!)) {
                    if (isPendingTaskDispatchPaused(taskId!)) {
                      log.debug(
                        `[ChatActions] Queued message detected at iteration_end, but dispatch is paused for taskItem ${taskId}`
                      )
                    } else {
                      log.debug(
                        `[ChatActions] Queued message detected at iteration_end, interrupting current run at the turn boundary for taskItem ${taskId}`
                      )
                      queueMicrotask(() => {
                        const activeAbortController = getTaskAbortController(taskId!)
                        if (activeAbortController && !activeAbortController.signal.aborted) {
                          activeAbortController.abort()
                        }
                      })
                    }
                  }
                  break
                }

                case 'message_end': {
                  streamDeltaBuffer.flushNow()
                  if (!thinkingDone) {
                    thinkingDone = true
                    completeRuntimeThinking(taskId!, assistantMsgId)
                  }
                  if (isTaskForeground(taskId!)) {
                    setGeneratingImageWithSync(assistantMsgId, false)
                  }
                  const debugContextEstimate = shouldUseEstimatedContextTokens(lastRequestDebugInfo)
                    ? estimateContextTokensFromDebugInfo(lastRequestDebugInfo)
                    : null
                  const estimatedContextTokens =
                    preciseContextTokens && preciseContextTokens > 0
                      ? preciseContextTokens
                      : debugContextEstimate
                        ? debugContextEstimate.tokenCount ||
                          estimateCurrentIterationContextTokens({
                            taskId: taskId!,
                            assistantMessageId: assistantMsgId,
                            tools: effectiveToolDefs,
                            providerConfig: agentProviderConfig
                          })
                        : 0
                  const normalizedUsage = event.usage
                    ? normalizeUsageWithEstimatedContext({
                        usage: event.usage,
                        contextLength: compressionContextLength,
                        debugInfo: lastRequestDebugInfo,
                        estimatedContextTokens,
                        preferEstimatedContextTokens:
                          debugContextEstimate?.hadBase64Payload ?? false
                      })
                    : null
                  if (event.usage) {
                    mergeUsage(accumulatedUsage, normalizedUsage!)
                    // contextTokens = last API call's input tokens (overwrite, not accumulate)
                    accumulatedUsage.contextTokens =
                      normalizedUsage!.contextTokens ?? normalizedUsage!.inputTokens
                    if (normalizedUsage!.contextLength) {
                      accumulatedUsage.contextLength = normalizedUsage!.contextLength
                    }
                  }
                  if (event.timing) {
                    requestTimings.push(event.timing)
                    accumulatedUsage.requestTimings = [...requestTimings]
                  }
                  if (event.usage || event.timing) {
                    updateRuntimeMessage(taskId!, assistantMsgId, {
                      usage: { ...accumulatedUsage },
                      ...(event.providerResponseId
                        ? { providerResponseId: event.providerResponseId }
                        : {})
                    })
                  }
                  break
                }

                case 'loop_end': {
                  streamDeltaBuffer.flushNow()
                  accumulatedUsage.totalDurationMs = Date.now() - loopStartedAt
                  if (requestTimings.length > 0) {
                    accumulatedUsage.requestTimings = [...requestTimings]
                  }
                  updateRuntimeMessage(taskId!, assistantMsgId, {
                    usage: { ...accumulatedUsage }
                  })
                  shouldAutoContinueLongRunning = shouldAutoContinueLongRunningRun({
                    taskId,
                    assistantMessageId: assistantMsgId,
                    loopEndReason: event.reason,
                    runUsedTools,
                    preRunTaskSnapshot,
                    verificationPassIndex: 0
                  })
                  if (
                    event.messages &&
                    event.messages.length > 0 &&
                    (event.reason === 'completed' || event.reason === 'max_iterations')
                  ) {
                    chatStore.replaceTaskMessages(taskId!, event.messages)
                  }
                  break
                }

                case 'request_debug': {
                  streamDeltaBuffer.flushNow()
                  if (event.debugInfo) {
                    lastRequestDebugInfo = {
                      ...event.debugInfo,
                      providerId: event.debugInfo.providerId ?? agentProviderConfig.providerId,
                      providerBuiltinId:
                        event.debugInfo.providerBuiltinId ?? agentProviderConfig.providerBuiltinId,
                      model: event.debugInfo.model ?? agentProviderConfig.model,
                      executionPath: event.debugInfo.executionPath ?? 'frontend'
                    }
                    currentUsageProviderId =
                      lastRequestDebugInfo.providerId ?? currentUsageProviderId
                    currentUsageModelId = lastRequestDebugInfo.model ?? currentUsageModelId
                    setLastDebugInfo(assistantMsgId, lastRequestDebugInfo)
                    updateRuntimeMessage(taskId!, assistantMsgId, {
                      debugInfo: lastRequestDebugInfo
                    })
                    if (shouldUseEstimatedContextTokens(lastRequestDebugInfo)) {
                      const debugContextEstimate =
                        estimateContextTokensFromDebugInfo(lastRequestDebugInfo)
                      const provisionalContextTokens =
                        debugContextEstimate.tokenCount ||
                        estimateCurrentIterationContextTokens({
                          taskId: taskId!,
                          assistantMessageId: assistantMsgId,
                          tools: effectiveToolDefs,
                          providerConfig: agentProviderConfig
                        })
                      const provisionalUsage = buildStreamingContextUsage(
                        provisionalContextTokens,
                        compressionContextLength
                      )
                      if (provisionalUsage) {
                        updateRuntimeMessage(taskId!, assistantMsgId, {
                          usage: provisionalUsage
                        })
                      }
                    }

                    if (
                      shouldRequestPreciseResponsesContextTokens({
                        debugInfo: lastRequestDebugInfo,
                        providerConfig: agentProviderConfig
                      })
                    ) {
                      const requestSeq = ++preciseContextTokenRequestSeq
                      void requestPreciseResponsesContextTokens({
                        debugInfo: lastRequestDebugInfo,
                        providerConfig: agentProviderConfig
                      })
                        .then((exactContextTokens) => {
                          if (
                            requestSeq !== preciseContextTokenRequestSeq ||
                            exactContextTokens <= 0
                          ) {
                            return
                          }
                          preciseContextTokens = exactContextTokens
                          accumulatedUsage.contextTokens = exactContextTokens
                          if (compressionContextLength > 0) {
                            accumulatedUsage.contextLength = compressionContextLength
                          }
                          mergeRuntimeMessageUsage(taskId!, assistantMsgId, {
                            contextTokens: exactContextTokens,
                            ...(compressionContextLength > 0
                              ? { contextLength: compressionContextLength }
                              : {})
                          })
                        })
                        .catch((error) => {
                          log.warn(
                            '[ChatActions] Failed to fetch precise Responses context tokens',
                            error
                          )
                        })
                    }
                  }
                  break
                }

                case 'context_compression_start':
                  break

                case 'context_compressed':
                  {
                    const compressedMessages = event.messages
                    const currentMessages =
                      useChatStore.getState().tasks.find((item) => item.id === taskId)
                        ?.messages ?? []
                    const mergedMessages = compressedMessages
                      ? mergeCompressedMessagesIntoConversation(currentMessages, compressedMessages)
                      : null
                    const nextVisibleMessages = mergedMessages ?? compressedMessages ?? null
                    const shouldPersistMergedMessages =
                      !!nextVisibleMessages &&
                      !hasSameMessageIdSequence(currentMessages, nextVisibleMessages)

                    if (shouldPersistMergedMessages) {
                      chatStore.replaceTaskMessages(taskId!, nextVisibleMessages)
                    }
                  }
                  break

                case 'error': {
                  streamDeltaBuffer.flushNow()
                  const errorMessage = normalizeContinuationErrorMessage(event.error.message)
                  log.error('[Agent Loop Error]', event.error)
                  if (shouldSuppressTransientRuntimeError(errorMessage)) {
                    break
                  }
                  if (isTaskForeground(taskId!)) {
                    toast.error(t('errors.agentError'), { description: errorMessage })
                  } else {
                    const taskTitle =
                      useChatStore.getState().tasks.find((item) => item.id === taskId)
                        ?.title ?? t('errors.backgroundTask')
                    useInboxStore.getState().addInboxItem({
                      taskId: taskId!,
                      type: 'error',
                      title: t('errors.runtimeError'),
                      description: `${taskTitle} · ${errorMessage}`
                    })
                  }
                  // Notify regardless of task foreground — notify() gates on app focus internally
                  {
                    const taskTitle =
                      useChatStore.getState().tasks.find((item) => item.id === taskId)
                        ?.title ?? t('errors.backgroundTask')
                    notifyTaskError(
                      taskId!,
                      t('notifications.taskErrorTitle'),
                      t('notifications.taskErrorBody', { title: taskTitle }),
                    )
                  }
                  appendRuntimeContentBlock(taskId!, assistantMsgId, {
                    type: 'agent_error',
                    code: 'runtime_error',
                    message: errorMessage,
                    ...(event.errorType ? { errorType: event.errorType } : {}),
                    ...(event.details ? { details: event.details } : {}),
                    ...(event.stackTrace ? { stackTrace: event.stackTrace } : {})
                  })
                  break
                }
              }
            }
          } catch (err) {
            streamDeltaBuffer?.flushNow()
            log.error('[Agent Loop Exception]', err)
            if (!abortController.signal.aborted) {
              const errMsg = normalizeContinuationErrorMessage(
                err instanceof Error ? err.message : String(err)
              )
              log.error('[Agent Loop Exception]', err)
              if (!shouldSuppressTransientRuntimeError(errMsg)) {
                if (isTaskForeground(taskId!)) {
                  toast.error(t('errors.agentFailed'), { description: errMsg })
                } else {
                  const taskTitle =
                    useChatStore.getState().tasks.find((item) => item.id === taskId)?.title ??
                    t('errors.backgroundTask')
                  useInboxStore.getState().addInboxItem({
                    taskId: taskId!,
                    type: 'error',
                    title: t('errors.runtimeError'),
                    description: `${taskTitle} · ${errMsg}`
                  })
                }
                // Notify regardless of task foreground — notify() gates on app focus internally
                {
                  const taskTitle =
                    useChatStore.getState().tasks.find((item) => item.id === taskId)?.title ??
                    t('errors.backgroundTask')
                  notifyTaskError(
                    taskId!,
                    t('notifications.taskErrorTitle'),
                    t('notifications.taskErrorBody', { title: taskTitle }),
                  )
                }
                appendRuntimeTextDelta(taskId!, assistantMsgId, `\n\n> **${t('error.label')}:** ${errMsg}`)
              }
              if (err instanceof ApiStreamError) {
                const debugInfo = err.debugInfo as RequestDebugInfo
                setLastDebugInfo(assistantMsgId, debugInfo)
                updateRuntimeMessage(taskId!, assistantMsgId, { debugInfo })
              }
            }
          } finally {
            streamDeltaBuffer?.flushNow()
            streamDeltaBuffer?.dispose()
            disposeToolInputQueues()
            liveToolNames.clear()
            if (isTaskForeground(taskId!)) {
              // Clear image generating state
              setGeneratingImageWithSync(assistantMsgId, false)
              // Defensive cleanup: if provider stream ended without completing a tool call,
              // avoid leaving tool cards stuck at "receiving args".
              const { executedToolCalls, taskToolCallsCache, updateToolCall } =
                useAgentStore.getState()
              const taskToolCalls = taskToolCallsCache[taskId]
              for (const tc of [
                ...executedToolCalls,
                ...(taskToolCalls?.executed ?? [])
              ]) {
                if (tc.status === 'streaming') {
                  updateToolCall(
                    tc.id,
                    {
                      status: 'error',
                      error: 'Tool call stream ended before execution',
                      completedAt: Date.now()
                    },
                    taskId
                  )
                }
              }
            }
            clearRequestRetryState(taskId)
            // Only show completed dot for background tasks — if the user is
            // actively viewing this task they already witnessed the completion.
            const isActiveTask = useChatStore.getState().activeTaskId === taskId
            agentStore.setTaskStatus(taskId, isActiveTask ? null : 'completed')
            setStreamingMessageIdWithSync(taskId, null)
            deleteTaskAbortController(taskId)
            // Derive global isRunning from remaining running tasks
            const hasOtherRunning = Object.values(useAgentStore.getState().runningTasks).some(
              (s) => s === 'running' || s === 'retrying'
            )
            agentStore.setRunning(hasOtherRunning)
            dispatchNextQueuedMessage(taskId)

            if (shouldAutoContinueLongRunning) {
              queueMicrotask(() => {
                void sendMessage('', undefined, 'continue', taskId, assistantMsgId)
              })
            } else {
              if (!isTaskForeground(taskId)) {
                const taskTitle =
                  useChatStore.getState().tasks.find((taskItem) => taskItem.id === taskId)
                    ?.title ?? t('errors.backgroundTask')
                toast.success(t('errors.backgroundTaskCompleted'), { description: taskTitle })
              }

              // Notify when agent finishes and app is in background
              if (!isAppFocused()) {
                const taskTitle =
                  useChatStore.getState().tasks.find((taskItem) => taskItem.id === taskId)
                    ?.title ?? t('errors.backgroundTask')
                notifyTaskComplete(
                  taskId,
                  t('notifications.taskCompletedTitle'),
                  t('notifications.taskCompletedBody', { title: taskTitle }),
                )
              }

              // If there's an active team, set up the lead message listener
              // and drain any messages that arrived while the loop was running.
              if (taskId && useTeamStore.getState().activeTeams[taskId]) {
                ensureTeamLeadListener()
                // Schedule a debounced drain to batch reports that arrive close together
                scheduleDrain()
              }
            }
          }
        }
      } catch (error) {
        clearPreflightIndicator()
        throw error
      }
    },
    [t]
  )

  useEffect(() => {
    ensureTeamLeadListener()
    if (Object.keys(useTeamStore.getState().activeTeams).length > 0) {
      scheduleDrain()
    }
  }, [])

  // TAURI_COMMANDS listeners are registered at module level above.

  // Cron taskItem delivery is now handled by cron-agent-runner.ts (deliveryMode='task')
  // No cron event subscription needed here.

  // Keep module-level ref updated for team lead auto-trigger + external callers
  setSendMessageFn(sendMessage)

  const stopStreaming = useCallback(() => {
    // Stop the active task's agent
    const activeId = useChatStore.getState().activeTaskId
    if (activeId) {
      stopTaskLocally(activeId)
      abortAllTeammatesLazy()
      emitTaskRuntimeControlSync({ kind: 'stop_streaming', taskId: activeId })
    }
  }, [])

  const continueLastToolExecution = useCallback(async () => {
    const chatStore = useChatStore.getState()
    const agentStore = useAgentStore.getState()
    const taskId = chatStore.activeTaskId
    if (!taskId) return
    if (hasActiveTaskRun(taskId)) return
    if (isContinuingToolExecution(taskId)) return
    markContinuingToolExecution(taskId)

    try {
      await chatStore.loadTaskMessages(taskId, true)
    } catch (error) {
      unmarkContinuingToolExecution(taskId)
      throw error
    }
    const messages = chatStore.getTaskMessages(taskId)
    const tailToolExecution = getTailToolExecutionState(messages)
    if (!tailToolExecution) {
      unmarkContinuingToolExecution(taskId)
      return
    }

    const resumedAssistantMessageId = tailToolExecution.assistantMessageId
    let handedOffToSendMessage = false

    setStreamingMessageIdWithSync(taskId, resumedAssistantMessageId)
    agentStore.setRunning(true)

    try {
      const { toolResultsById, missingToolUses } = collectAvailableContinuationToolResults(
        taskId,
        tailToolExecution
      )

      // Continue must only send saved tool results back to the model; replaying historical
      // tool_use blocks can repeat writes, shell commands, or other side effects.
      if (missingToolUses.length > 0) {
        const names = Array.from(new Set(missingToolUses.map((toolUse) => toolUse.name)))
          .slice(0, 3)
          .join(', ')
        toast.error(t('errors.cannotContinueSafely'), {
          description: t('errors.missingToolResults', {
            count: missingToolUses.length,
            names: names ? ` (${names})` : ''
          })
        })
        return
      }

      const consolidatedToolResults = tailToolExecution.toolUseBlocks.map((toolUse) => {
        const existingResult = toolResultsById.get(toolUse.id)
        if (existingResult) {
          return {
            type: 'tool_result' as const,
            toolUseId: toolUse.id,
            content: existingResult.content,
            ...(existingResult.isError ? { isError: true } : {})
          }
        }

        const fallbackOutput = encodeToolError('Tool continuation failed')
        return {
          type: 'tool_result' as const,
          toolUseId: toolUse.id,
          content: fallbackOutput,
          isError: true
        }
      })

      const nextMessages: UnifiedMessage[] = [
        ...messages.slice(0, tailToolExecution.assistantIndex + 1),
        {
          id: nanoid(),
          role: 'user',
          content: consolidatedToolResults,
          createdAt: Date.now()
        }
      ]

      chatStore.replaceTaskMessages(taskId, nextMessages)
      handedOffToSendMessage = true
      await sendMessage('', undefined, 'continue', taskId, resumedAssistantMessageId)
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const normalizedMessage = normalizeContinuationErrorMessage(rawMessage)
      const apiErrorDetail =
        rawMessage.includes('{') && rawMessage.includes('}')
          ? normalizeContinuationErrorMessage(rawMessage.replace(/^.*?(\{.*\})\s*$/s, '$1'))
          : normalizedMessage
      log.error('[Continue Tool Execution]', err)
      if (!shouldSuppressTransientRuntimeError(apiErrorDetail)) {
        toast.error(t('errors.continueExecutionFailed'), { description: apiErrorDetail })
        appendRuntimeTextDelta(
          taskId,
          resumedAssistantMessageId,
          `\n\n> **${t('error.label')}:** ${apiErrorDetail}`
        )
      }
    } finally {
      unmarkContinuingToolExecution(taskId)
      if (!handedOffToSendMessage) {
        if (useChatStore.getState().streamingMessages[taskId] === resumedAssistantMessageId) {
          setStreamingMessageIdWithSync(taskId, null)
        }
        const hasOtherRunning = Object.values(useAgentStore.getState().runningTasks).some(
          (status) => status === 'running' || status === 'retrying'
        )
        if (!hasOtherRunning) {
          useAgentStore.getState().setRunning(false)
        }
      }
    }
  }, [sendMessage, t])

  const retryLastMessage = useCallback(
    async (assistantMessageId?: string) => {
      stopStreaming()
      const chatStore = useChatStore.getState()
      const taskId = chatStore.activeTaskId
      if (!taskId) return

      clearPendingTaskMessages(taskId)
      const { target } = await resolveTaskMessageTarget(chatStore, taskId, (messages) =>
        assistantMessageId
          ? findRetryAssistantTarget(messages, assistantMessageId)
          : (() => {
              const lastEditable = findLastEditableUserMessage(messages)
              if (!lastEditable) return null
              const assistantIndex = messages.findLastIndex((message, index) => {
                if (index <= lastEditable.index) return false
                return message.role === 'assistant'
              })
              if (assistantIndex < 0) return null
              return {
                assistantIndex,
                userIndex: lastEditable.index,
                draft: lastEditable.draft
              }
            })()
      )
      if (!target) return

      chatStore.truncateMessagesFrom(taskId, target.userIndex)
      // The store method fires the DB truncation asynchronously.  Await the
      // same TAURI_COMMANDS call so sendMessage's loadRecentTaskMessages reads the
      // updated DB state instead of reloading the old (possibly empty)
      // assistant message that was just removed from the in-memory store.
      await tauriCommands
        .invoke('db:messages:truncate-from', {
          taskId,
          fromSortOrder: target.userIndex
        })
        .catch(() => {})
      await sendMessage(
        target.draft.text,
        target.draft.images.length > 0 ? cloneImageAttachments(target.draft.images) : undefined
      )
    },
    [sendMessage, stopStreaming]
  )

  const deleteMessage = useCallback(
    async (messageId: string) => {
      stopStreaming()
      const chatStore = useChatStore.getState()
      const taskId = chatStore.activeTaskId
      if (!taskId) return

      clearPendingTaskMessages(taskId)
      const { messages, target: nextMessages } = await resolveTaskMessageTarget(
        chatStore,
        taskId,
        (messages) => buildDeletedMessages(messages, messageId)
      )
      if (!nextMessages || nextMessages.length === messages.length) return

      if (nextMessages.length === 0) {
        chatStore.clearTaskMessages(taskId)
        return
      }

      chatStore.replaceTaskMessages(taskId, nextMessages)
    },
    [stopStreaming]
  )

  const rollbackMessage = useCallback(
    async (messageId: string) => {
      stopStreaming()
      const chatStore = useChatStore.getState()
      const agentStore = useAgentStore.getState()
      const taskId = chatStore.activeTaskId
      if (!taskId) return

      clearPendingTaskMessages(taskId)

      // Resolve the full message list
      const { messages } = await resolveTaskMessageTarget(chatStore, taskId, (msgs) => msgs)
      const targetIndex = messages.findIndex((msg) => msg.id === messageId)
      if (targetIndex < 0) return

      // Extract text from the target message to restore into the input after rollback
      const targetDraft = extractEditableUserMessageDraft(messages[targetIndex].content)
      const rollbackText = targetDraft.text

      // Collect all assistant messages from this user message onward
      const assistantMessageIds = messages
        .slice(targetIndex + 1)
        .filter((msg) => msg.role === 'assistant')
        .map((msg) => msg.id)

      // Revert all change sets associated with those assistant messages
      for (const assistantMsgId of assistantMessageIds) {
        if (agentStore.changeSets[assistantMsgId]) {
          await agentStore.revertChangeSet(assistantMsgId)
        }
      }

      // Truncate messages from this user message onward
      chatStore.truncateMessagesFrom(taskId, targetIndex)

      // Restore the rolled-back message text into the input draft
      if (rollbackText) {
        const draftKey = getTaskInputDraftKey(taskId)
        useInputDraftStore.getState().setDraft(draftKey, {
          text: rollbackText,
          selectedFiles: []
        })
      }
    },
    [stopStreaming]
  )

  const manualCompressContext = useManualCompression()

  return {
    sendMessage,
    stopStreaming,
    continueLastToolExecution,
    retryLastMessage,
    deleteMessage,
    rollbackMessage,
    manualCompressContext
  }
}

/**
 * Chat fallback path: single API call with streaming text and no tool loop.
 * Extracted to ./lib/agent/simple-chat-runner.ts
 */
export { runSimpleChat } from '@/lib/agent/simple-chat-runner'

/**
 * Trigger sendMessage from outside the hook.
 * Must be called after useChatActions has mounted at least once.
 */
export function triggerSendMessage(
  text: string,
  targetTaskId: string,
  images?: ImageAttachment[]
): void {
  const fn = getSendMessageFn()
  if (!fn) {
    log.error('sendMessage not initialized yet')
    return
  }
  void fn(text, images, undefined, targetTaskId)
}

function mergeUsage(target: TokenUsage, incoming: TokenUsage): void {
  target.inputTokens += incoming.inputTokens
  target.outputTokens += incoming.outputTokens
  if (incoming.billableInputTokens != null) {
    target.billableInputTokens = (target.billableInputTokens ?? 0) + incoming.billableInputTokens
  }
  if (incoming.cacheCreationTokens) {
    target.cacheCreationTokens = (target.cacheCreationTokens ?? 0) + incoming.cacheCreationTokens
  }
  if (incoming.cacheCreation5mTokens) {
    target.cacheCreation5mTokens =
      (target.cacheCreation5mTokens ?? 0) + incoming.cacheCreation5mTokens
  }
  if (incoming.cacheCreation1hTokens) {
    target.cacheCreation1hTokens =
      (target.cacheCreation1hTokens ?? 0) + incoming.cacheCreation1hTokens
  }
  if (incoming.cacheReadTokens) {
    target.cacheReadTokens = (target.cacheReadTokens ?? 0) + incoming.cacheReadTokens
  }
  if (incoming.reasoningTokens) {
    target.reasoningTokens = (target.reasoningTokens ?? 0) + incoming.reasoningTokens
  }
  if (incoming.contextLength) {
    target.contextLength = incoming.contextLength
  }
}
