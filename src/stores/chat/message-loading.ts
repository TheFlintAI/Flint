import type { UnifiedMessage } from '@/lib/api/types'
import type { Task } from './types'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { useAgentStore } from '../agent-store'
import { useTeamStore } from '../team-store'
import { usePlanStore } from '../plan-store'
import { useTodoStore } from '../todo-store'
import { useUIStore } from '../ui-store'
import {
  _activeStreamingMessageIds,
  _streamingDirtyMessageIds,
  _pendingFlush
} from './stream-persistence'
import { hasPendingMessageWrite } from './persistence'
import { rowToMessage } from './message-serialization'
import { toonEncode } from '@/lib/tools/tool-result-format'

// Initial tail shown the instant the user switches into a task. Small on
// purpose so the switch renders in ~1 frame. Older history streams in via
// the scroll-to-top load-more row.
export const MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE = 5
const REQUEST_CONTEXT_MAX_MESSAGES = 160
const REQUEST_CONTEXT_SAFE_BOUNDARY_SCAN = 12

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

function estimateMessageWeight(message: UnifiedMessage): number {
  if (typeof message.content === 'string') return message.content.length
  if (!Array.isArray(message.content)) return 0

  let total = 0
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        total += block.text.length
        break
      case 'thinking':
        total += block.thinking.length
        break
      case 'tool_use':
        total += toonEncode(block.input ?? {}).length + String(block.name ?? '').length
        break
      case 'tool_result':
        total += toonEncode(block.content ?? '').length
        break
      default:
        total += toonEncode(block).length
        break
    }
  }

  return total
}

function hasToolReferenceSplit(messages: UnifiedMessage[], boundary: number): boolean {
  const compressedToolUseIds = new Set<string>()
  for (let index = 0; index < boundary; index += 1) {
    const message = messages[index]
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.id) {
        compressedToolUseIds.add(block.id)
      }
    }
  }

  if (compressedToolUseIds.size === 0) return false

  for (let index = boundary; index < messages.length; index += 1) {
    const message = messages[index]
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (
        block.type === 'tool_result' &&
        block.toolUseId &&
        compressedToolUseIds.has(block.toolUseId)
      ) {
        return true
      }
    }
  }

  return false
}

function normalizeRequestContextMaxMessages(value?: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return REQUEST_CONTEXT_MAX_MESSAGES
  }
  return Math.max(MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE, Math.floor(value))
}

function clampRequestContext(
  messages: UnifiedMessage[],
  maxMessagesArg?: number | null
): UnifiedMessage[] {
  const maxMessages = normalizeRequestContextMaxMessages(maxMessagesArg)
  if (maxMessages === null || messages.length <= maxMessages) return messages

  let boundary = Math.max(1, messages.length - maxMessages)
  for (let attempt = 0; attempt < REQUEST_CONTEXT_SAFE_BOUNDARY_SCAN; attempt += 1) {
    if (!hasToolReferenceSplit(messages, boundary)) break
    boundary = Math.max(1, boundary - 1)
  }

  return messages.slice(boundary)
}

function mergeResidentTailWithFetchedPrefix(
  residentMessages: UnifiedMessage[],
  fetchedMessages: UnifiedMessage[],
  maxMessagesArg?: number | null
): UnifiedMessage[] {
  if (residentMessages.length === 0) return clampRequestContext(fetchedMessages, maxMessagesArg)
  if (fetchedMessages.length === 0) return clampRequestContext(residentMessages, maxMessagesArg)

  const merged = [...fetchedMessages]
  const seenIds = new Set(fetchedMessages.map((message) => message.id))
  for (const message of residentMessages) {
    if (seenIds.has(message.id)) continue
    merged.push(message)
    seenIds.add(message.id)
  }

  return clampRequestContext(merged, maxMessagesArg)
}

export async function loadRequestContextMessages(
  task: Task,
  maxMessagesArg?: number | null
): Promise<UnifiedMessage[]> {
  const knownCount = task.messageCount ?? task.messages.length
  if (knownCount <= 0) return []
  const maxMessages = normalizeRequestContextMaxMessages(maxMessagesArg)

  const residentMessages = task.messages
  const residentHasFullHistory =
    task.messagesLoaded && task.loadedRangeStart === 0 && task.loadedRangeEnd >= knownCount

  if (residentHasFullHistory) {
    return clampRequestContext(residentMessages, maxMessages)
  }

  if (maxMessages === null) {
    const msgRows = (await tauriCommands.invoke('db:messages:list-page', {
      taskId: task.id,
      limit: knownCount,
      offset: 0
    })) as MessageRow[]
    const fetchedMessages = msgRows.map(rowToMessage)
    return mergeResidentTailWithFetchedPrefix(residentMessages, fetchedMessages, maxMessages)
  }

  const residentTailStart =
    task.messagesLoaded && residentMessages.length > 0
      ? Math.max(
          0,
          Math.min(task.loadedRangeStart, task.loadedRangeEnd - residentMessages.length)
        )
      : knownCount
  const residentWeight = residentMessages.reduce(
    (total, message) => total + estimateMessageWeight(message),
    0
  )
  const weightAdjustedLimit =
    maxMessages === null
      ? knownCount
      : residentWeight > 200_000
        ? Math.min(96, maxMessages)
        : maxMessages
  const targetLimit =
    maxMessages === null
      ? knownCount
      : Math.max(MIN_INITIAL_TASK_MESSAGE_PAGE_SIZE, weightAdjustedLimit)
  const tailCount = Math.min(targetLimit, knownCount)
  const tailOffset = Math.max(0, knownCount - tailCount)

  if (task.messagesLoaded && residentMessages.length > 0 && residentTailStart <= tailOffset) {
    return clampRequestContext(residentMessages, maxMessages)
  }

  const fetchLimit = Math.max(0, residentTailStart - tailOffset)
  if (fetchLimit <= 0) {
    return clampRequestContext(residentMessages, maxMessages)
  }

  const msgRows = (await tauriCommands.invoke('db:messages:list-page', {
    taskId: task.id,
    limit: fetchLimit,
    offset: tailOffset
  })) as MessageRow[]
  const fetchedMessages = msgRows.map(rowToMessage)
  return mergeResidentTailWithFetchedPrefix(residentMessages, fetchedMessages, maxMessages)
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

function hasPendingLocalMessageWrite(messageId: string): boolean {
  return (
    _activeStreamingMessageIds.has(messageId) ||
    _streamingDirtyMessageIds.has(messageId) ||
    _pendingFlush.has(messageId) ||
    hasPendingMessageWrite(messageId)
  )
}

function shouldPreferResidentMessage(resident: UnifiedMessage, fetched: UnifiedMessage): boolean {
  if (hasPendingLocalMessageWrite(resident.id)) return true

  const residentWeight = estimateMessageWeight(resident)
  const fetchedWeight = estimateMessageWeight(fetched)
  if (residentWeight > fetchedWeight) return true

  if (resident.usage && !fetched.usage) return true
  if (resident.meta && !fetched.meta) return true
  if (resident.providerResponseId && !fetched.providerResponseId) return true
  if (hasMeaningfulAssistantContent(resident) && !hasMeaningfulAssistantContent(fetched)) {
    return true
  }

  return false
}

export function mergeLoadedMessagesWithResident(
  task: Task,
  fetchedMessages: UnifiedMessage[],
  windowStart: number,
  fetchedWindowEnd: number,
  knownCount: number,
  fetchedSortOrders: number[] = []
): {
  messages: UnifiedMessage[]
  messageCount: number
  loadedRangeStart: number
  loadedRangeEnd: number
} {
  if (task.messages.length === 0) {
    return {
      messages: fetchedMessages,
      messageCount: Math.max(knownCount, fetchedWindowEnd),
      loadedRangeStart: windowStart,
      loadedRangeEnd: Math.max(fetchedWindowEnd, windowStart + fetchedMessages.length)
    }
  }

  const residentById = new Map(task.messages.map((message) => [message.id, message]))
  const seen = new Set<string>()
  const entries: Array<{ index: number; sequence: number; message: UnifiedMessage }> = []

  fetchedMessages.forEach((fetched, index) => {
    const resident = residentById.get(fetched.id)
    const message = resident && shouldPreferResidentMessage(resident, fetched) ? resident : fetched
    entries.push({
      index: fetchedSortOrders[index] ?? windowStart + index,
      sequence: index,
      message
    })
    seen.add(fetched.id)
  })

  const residentStart = task.loadedRangeStart ?? 0
  const residentEnd = task.loadedRangeEnd ?? residentStart + task.messages.length
  task.messages.forEach((resident, index) => {
    if (seen.has(resident.id)) return
    const logicalIndex = Math.max(0, residentStart + index)
    const isResidentPrefixOutsideFetchedWindow =
      logicalIndex < windowStart && logicalIndex >= residentStart && logicalIndex < knownCount
    const isLocalTailNotInDbYet =
      logicalIndex >= windowStart &&
      logicalIndex >= fetchedWindowEnd &&
      logicalIndex < knownCount &&
      residentEnd > fetchedWindowEnd
    const isMissingFromShortDbSnapshot =
      logicalIndex >= windowStart &&
      logicalIndex < knownCount &&
      task.messageCount > fetchedMessages.length &&
      residentEnd > fetchedWindowEnd
    if (
      !hasPendingLocalMessageWrite(resident.id) &&
      !isResidentPrefixOutsideFetchedWindow &&
      !isLocalTailNotInDbYet &&
      !isMissingFromShortDbSnapshot
    ) {
      return
    }

    entries.push({
      index: logicalIndex,
      sequence: fetchedMessages.length + index,
      message: resident
    })
    seen.add(resident.id)
  })

  entries.sort((left, right) => left.index - right.index || left.sequence - right.sequence)

  const messages = entries.map((entry) => entry.message)
  const loadedRangeStart =
    entries.length > 0 ? Math.min(windowStart, ...entries.map((entry) => entry.index)) : windowStart
  const loadedRangeEnd =
    entries.length > 0
      ? Math.max(fetchedWindowEnd, ...entries.map((entry) => entry.index + 1))
      : fetchedWindowEnd
  const messageCount = Math.max(knownCount, task.messageCount, loadedRangeEnd)

  return {
    messages,
    messageCount,
    loadedRangeStart,
    loadedRangeEnd
  }
}

function getResidentTaskIds(
  state: { activeTaskId: string | null; streamingMessages: Record<string, string> }
): Set<string> {
  const residentTaskIds = new Set<string>()
  if (state.activeTaskId) {
    residentTaskIds.add(state.activeTaskId)
  }

  for (const taskId of Object.keys(state.streamingMessages)) {
    residentTaskIds.add(taskId)
  }

  // Any task that is currently executing (agent loop, background
  // processes, or team runtime) must stay resident. Otherwise a brief window
  // between execution phases (when streamingMessages is temporarily empty) can
  // cause its messages to be wiped and force MessageList into its skeleton
  // branch, producing a visible flash.
  const agentState = useAgentStore.getState()
  for (const [taskId, status] of Object.entries(agentState.runningTasks)) {
    if (status) residentTaskIds.add(taskId)
  }
  for (const process of Object.values(agentState.backgroundProcesses)) {
    if (process.taskId && process.status === 'running') {
      residentTaskIds.add(process.taskId)
    }
  }
  const activeTeamTaskId = useTeamStore.getState().activeTeam?.taskId
  if (activeTeamTaskId) {
    residentTaskIds.add(activeTeamTaskId)
  }

  return residentTaskIds
}

export function releaseDormantTaskMemory(
  state: {
    tasks: Task[]
    activeTaskId: string | null
    streamingMessages: Record<string, string>
    generatingImageMessages: Record<string, boolean>
    imageGenerationTimings: Record<string, { startedAt: number; completedAt?: number }>
  }
): void {
  const residentTaskIds = getResidentTaskIds(state)
  const releasedMessageIds = new Set<string>()
  useAgentStore.getState().trimDormantTaskData([...residentTaskIds])
  usePlanStore.getState().releaseDormantPlans(state.activeTaskId)
  useTodoStore.getState().releaseDormantPlanItems([...residentTaskIds])
  useUIStore.getState().releaseDormantTaskUiState(state.activeTaskId)

  for (const task of state.tasks) {
    if (residentTaskIds.has(task.id)) continue

    delete task.promptSnapshot

    if (state.streamingMessages[task.id]) continue
    if (!task.messagesLoaded && task.messages.length === 0) continue

    for (const message of task.messages) {
      releasedMessageIds.add(message.id)
    }

    task.lastKnownMessageCount = task.messageCount
    task.messagesLoaded = false
    task.messages = []
    task.loadedRangeStart = task.messageCount
    task.loadedRangeEnd = task.messageCount
  }

  if (releasedMessageIds.size === 0) return

  for (const messageId of Object.keys(state.generatingImageMessages)) {
    if (releasedMessageIds.has(messageId)) {
      delete state.generatingImageMessages[messageId]
    }
  }
  for (const messageId of Object.keys(state.imageGenerationTimings)) {
    if (releasedMessageIds.has(messageId)) {
      delete state.imageGenerationTimings[messageId]
    }
  }
}
