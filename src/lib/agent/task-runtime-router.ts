import type {
  ContentBlock,
  ThinkingBlock,
  TokenUsage,
  ToolUseBlock,
  UnifiedMessage
} from '@/lib/api/types'
import { emitTaskRuntimeSync } from '@/lib/agent/task-runtime-sync'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { summarizeToolInputForHistory } from '@/lib/tools/tool-input-sanitizer'
import { useInboxStore } from '@/stores/inbox-store'
import { recordStreamingForegroundFlush } from '@/lib/devtools/streaming-performance'
import { createLogger } from '@/lib/logger'

const log = createLogger('TaskRouter')

/**
 * Strip any <think>...</think> markers streamed by providers that wrap thinking in pseudo-tags.
 * Mirrors the chat-store helper so buffered writes share the same sanitization.
 */
function stripThinkTagMarkers(text: string): string {
  return text.replace(/<\s*\/?\s*think\s*>/gi, '')
}

function upsertBufferedToolUse(blocks: ContentBlock[], toolUse: ToolUseBlock): void {
  const existingIndex = blocks.findIndex(
    (block): block is ToolUseBlock => block.type === 'tool_use' && block.id === toolUse.id
  )

  if (existingIndex === -1) {
    blocks.push(toolUse)
    return
  }

  const existing = blocks[existingIndex] as ToolUseBlock
  blocks[existingIndex] = {
    ...existing,
    ...toolUse,
    input: toolUse.input
  }
}

// --- Visible taskItem cache (50 ms TTL) ---
// getVisibleTaskIds() is called per-event during streaming — caching avoids
// re-creating a Set and reading two stores on every invocation.
let _cachedVisibleIds: Set<string> | null = null
let _cachedVisibleIdsTs = 0
const VISIBLE_IDS_CACHE_TTL_MS = 50
/**
 * Invalidate the visible-task cache. Call this whenever `activeTaskId`
 * changes so the next `isTaskForeground` call picks up the new value immediately.
 */
export function invalidateVisibleTaskCache(): void {
  _cachedVisibleIds = null
}

// --- Debounced markTaskUpdate ---
// During streaming, mutateBufferedMessage fires every ~33 ms.  Updating
// unreadCountsByTask that often forces the task sidebar to re-render at
// ~30 fps for a purely informational badge.  Debouncing at 500 ms reduces
// background-store set() calls to ~2/s while keeping the badge responsive
// enough for the user to notice activity.
const _pendingTaskUpdates = new Map<string, ReturnType<typeof setTimeout>>()
const MARK_TASK_UPDATE_DEBOUNCE_MS = 500

function debouncedMarkTaskUpdate(taskId: string): void {
  if (_pendingTaskUpdates.has(taskId)) return
  _pendingTaskUpdates.set(
    taskId,
    setTimeout(() => {
      _pendingTaskUpdates.delete(taskId)
      useInboxStore.getState().markTaskUpdate(taskId)
    }, MARK_TASK_UPDATE_DEBOUNCE_MS)
  )
}

function cancelDebouncedMarkTaskUpdate(taskId: string): void {
  const timer = _pendingTaskUpdates.get(taskId)
  if (timer) {
    clearTimeout(timer)
    _pendingTaskUpdates.delete(taskId)
  }
}

/**
 * Seed resolver used by background mutations. Looks up the current chat-store snapshot so
 * the background buffer can clone an authoritative source message the first time a delta
 * references an id it hasn't buffered yet.
 */
function resolveChatStoreSeed(taskId: string, messageId: string): UnifiedMessage | undefined {
  return useChatStore
    .getState()
    .getTaskMessages(taskId)
    .find((message) => message.id === messageId)
}

/**
 * Apply a mutator to a buffered background message. Guarantees the mutation is never
 * silently dropped: if the message isn't already in the buffer and can't be found in
 * chat-store either, an empty placeholder is created so the delta has somewhere to land.
 * The buffered snapshot will eventually be merged into chat-store by
 * flushBackgroundTaskToForeground — see applyBackgroundSnapshot for the merge semantics.
 */
function mutateBufferedMessage(
  taskId: string,
  messageId: string,
  mutator: (message: UnifiedMessage) => void
): void {
  const bg = useInboxStore.getState()
  bg.queueBufferedMutation(
    taskId,
    messageId,
    () => resolveChatStoreSeed(taskId, messageId),
    mutator
  )
  debouncedMarkTaskUpdate(taskId)
}

export function getVisibleTaskIds(): Set<string> {
  const now = Date.now()
  if (_cachedVisibleIds && now - _cachedVisibleIdsTs < VISIBLE_IDS_CACHE_TTL_MS) {
    return _cachedVisibleIds
  }

  const visibleTaskIds = new Set<string>()
  const { activeTaskId } = useChatStore.getState()

  if (activeTaskId) visibleTaskIds.add(activeTaskId)

  _cachedVisibleIds = visibleTaskIds
  _cachedVisibleIdsTs = now
  return visibleTaskIds
}

export function isTaskForeground(taskId: string): boolean {
  return getVisibleTaskIds().has(taskId)
}

// --- RAF-batched foreground mutations ---
// During agent execution, multiple store mutations arrive per frame (updateMessage,
// appendToolUse, updateToolUseInput, etc.). Queueing them and flushing in a single
// RAF callback lets React 18 batch the resulting re-renders into one pass.
type ForegroundMutationThunk = () => void
const _pendingForegroundMutations: ForegroundMutationThunk[] = []
let _foregroundFlushRafId: number | null = null

function scheduleForegroundFlush(): void {
  if (_foregroundFlushRafId !== null) return
  _foregroundFlushRafId = requestAnimationFrame(flushForegroundMutations)
}

function flushForegroundMutations(): void {
  _foregroundFlushRafId = null
  if (_pendingForegroundMutations.length === 0) return
  const thunks = _pendingForegroundMutations.splice(0)
  const startedAt = performance.now()
  for (const thunk of thunks) {
    thunk()
  }
  recordStreamingForegroundFlush(performance.now() - startedAt, { count: thunks.length })
}

function flushPendingForegroundMutations(): void {
  if (_pendingForegroundMutations.length === 0) return
  if (_foregroundFlushRafId !== null) {
    cancelAnimationFrame(_foregroundFlushRafId)
    _foregroundFlushRafId = null
  }
  flushForegroundMutations()
}

export function flushRuntimeForegroundMutations(): void {
  flushPendingForegroundMutations()
}

function queueForegroundMutation(thunk: ForegroundMutationThunk): void {
  _pendingForegroundMutations.push(thunk)
  scheduleForegroundFlush()
}

export function updateRuntimeMessage(
  taskId: string,
  messageId: string,
  patch: Partial<UnifiedMessage>
): void {
  emitTaskRuntimeSync({ kind: 'update_message', taskId, messageId, patch })

  if (isTaskForeground(taskId)) {
    queueForegroundMutation(() =>
      useChatStore.getState().updateMessage(taskId, messageId, patch)
    )
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    Object.assign(message, patch)
  })
}

function buildMergedRuntimeUsage(
  currentUsage: UnifiedMessage['usage'],
  patch: Partial<TokenUsage>
): TokenUsage {
  return {
    inputTokens: currentUsage?.inputTokens ?? 0,
    outputTokens: currentUsage?.outputTokens ?? 0,
    ...(currentUsage ?? {}),
    ...patch
  }
}

export function mergeRuntimeMessageUsage(
  taskId: string,
  messageId: string,
  patch: Partial<TokenUsage>
): void {
  if (isTaskForeground(taskId)) {
    const chatStore = useChatStore.getState()
    const currentMessage = chatStore
      .getTaskMessages(taskId)
      .find((message) => message.id === messageId)
    const merged = buildMergedRuntimeUsage(currentMessage?.usage, patch)
    queueForegroundMutation(() =>
      useChatStore.getState().updateMessage(taskId, messageId, { usage: merged })
    )
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    message.usage = buildMergedRuntimeUsage(message.usage, patch)
  })
}

export function appendRuntimeTextDelta(taskId: string, messageId: string, text: string): void {
  if (!text) return
  emitTaskRuntimeSync({ kind: 'append_text_delta', taskId, messageId, text })

  if (isTaskForeground(taskId)) {
    flushPendingForegroundMutations()
    useChatStore.getState().appendTextDelta(taskId, messageId, text)
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    if (typeof message.content === 'string') {
      message.content += text
      return
    }

    const blocks = message.content as ContentBlock[]
    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'text') {
      lastBlock.text += text
    } else {
      blocks.push({ type: 'text', text })
    }
  })
}

export function appendRuntimeThinkingDelta(
  taskId: string,
  messageId: string,
  thinking: string
): void {
  const cleanedThinking = stripThinkTagMarkers(thinking)
  if (!cleanedThinking) return
  emitTaskRuntimeSync({
    kind: 'append_thinking_delta',
    taskId,
    messageId,
    thinking: cleanedThinking
  })

  if (isTaskForeground(taskId)) {
    flushPendingForegroundMutations()
    useChatStore.getState().appendThinkingDelta(taskId, messageId, cleanedThinking)
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    const now = Date.now()
    if (typeof message.content === 'string') {
      message.content = [{ type: 'thinking', thinking: cleanedThinking, startedAt: now }]
      return
    }

    const blocks = message.content as ContentBlock[]
    let targetThinkingBlock: ThinkingBlock | null = null
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block.type === 'thinking' && !block.completedAt) {
        targetThinkingBlock = block
        break
      }
    }

    if (targetThinkingBlock) {
      targetThinkingBlock.thinking = stripThinkTagMarkers(
        `${targetThinkingBlock.thinking}${cleanedThinking}`
      )
    } else {
      blocks.push({ type: 'thinking', thinking: cleanedThinking, startedAt: now })
    }
  })
}

export function setRuntimeThinkingEncryptedContent(
  taskId: string,
  messageId: string,
  encryptedContent: string,
  provider: 'anthropic' | 'openai-responses' | 'google'
): void {
  if (!encryptedContent) return
  emitTaskRuntimeSync({
    kind: 'set_thinking_encrypted',
    taskId,
    messageId,
    encryptedContent,
    provider
  })

  if (isTaskForeground(taskId)) {
    queueForegroundMutation(() =>
      useChatStore
        .getState()
        .setThinkingEncryptedContent(taskId, messageId, encryptedContent, provider)
    )
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    const now = Date.now()
    if (typeof message.content === 'string') {
      const existingText = message.content
      message.content = [
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

    const blocks = message.content as ContentBlock[]
    let targetThinkingBlock: ThinkingBlock | null = null
    let providerMatchedThinkingBlock: ThinkingBlock | null = null

    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block.type !== 'thinking') continue
      if (!block.encryptedContent) {
        targetThinkingBlock = block
        break
      }
      if (!providerMatchedThinkingBlock && block.encryptedContentProvider === provider) {
        providerMatchedThinkingBlock = block
      }
    }

    targetThinkingBlock = targetThinkingBlock ?? providerMatchedThinkingBlock
    if (targetThinkingBlock) {
      targetThinkingBlock.encryptedContent = encryptedContent
      targetThinkingBlock.encryptedContentProvider = provider
      return
    }

    blocks.push({
      type: 'thinking',
      thinking: '',
      encryptedContent,
      encryptedContentProvider: provider,
      startedAt: now
    })
  })
}

export function completeRuntimeThinking(taskId: string, messageId: string): void {
  emitTaskRuntimeSync({ kind: 'complete_thinking', taskId, messageId })

  if (isTaskForeground(taskId)) {
    queueForegroundMutation(() => useChatStore.getState().completeThinking(taskId, messageId))
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    if (typeof message.content === 'string') return
    for (const block of message.content as ContentBlock[]) {
      if (block.type === 'thinking' && !block.completedAt) {
        block.completedAt = Date.now()
      }
    }
  })
}

export function appendRuntimeToolUse(
  taskId: string,
  messageId: string,
  toolUse: ToolUseBlock
): void {
  const normalizedToolUse: ToolUseBlock = {
    ...toolUse,
    input: summarizeToolInputForHistory(toolUse.name, toolUse.input)
  }
  emitTaskRuntimeSync({
    kind: 'append_tool_use',
    taskId,
    messageId,
    toolUse: normalizedToolUse
  })

  if (isTaskForeground(taskId)) {
    queueForegroundMutation(() =>
      useChatStore.getState().appendToolUse(taskId, messageId, normalizedToolUse)
    )
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    if (typeof message.content === 'string') {
      message.content = [{ type: 'text', text: message.content }, { ...normalizedToolUse }]
      return
    }

    upsertBufferedToolUse(message.content as ContentBlock[], { ...normalizedToolUse })
  })
}

export function updateRuntimeToolUseInput(
  taskId: string,
  messageId: string,
  toolUseId: string,
  input: Record<string, unknown>
): void {
  emitTaskRuntimeSync({
    kind: 'update_tool_use_input',
    taskId,
    messageId,
    toolUseId,
    input
  })

  if (isTaskForeground(taskId)) {
    queueForegroundMutation(() =>
      useChatStore.getState().updateToolUseInput(taskId, messageId, toolUseId, input)
    )
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    if (typeof message.content === 'string') return
    const block = (message.content as ContentBlock[]).find(
      (item) => item.type === 'tool_use' && (item as ToolUseBlock).id === toolUseId
    ) as ToolUseBlock | undefined
    if (block) {
      block.input = summarizeToolInputForHistory(block.name, input)
    }
  })
}

export function appendRuntimeContentBlock(
  taskId: string,
  messageId: string,
  block: ContentBlock
): void {
  emitTaskRuntimeSync({ kind: 'append_content_block', taskId, messageId, block })

  if (isTaskForeground(taskId)) {
    queueForegroundMutation(() =>
      useChatStore.getState().appendContentBlock(taskId, messageId, block)
    )
    return
  }

  mutateBufferedMessage(taskId, messageId, (message) => {
    if (typeof message.content === 'string') {
      message.content = [{ type: 'text', text: message.content }, { ...block } as ContentBlock]
      return
    }

    ;(message.content as ContentBlock[]).push({ ...block } as ContentBlock)
  })
}

export function addRuntimeMessage(taskId: string, message: UnifiedMessage): void {
  emitTaskRuntimeSync({ kind: 'add_message', taskId, message })

  if (isTaskForeground(taskId)) {
    useChatStore.getState().addMessage(taskId, message)
    return
  }

  const bg = useInboxStore.getState()
  bg.seedBufferedMessage(taskId, message, 'added')
  debouncedMarkTaskUpdate(taskId)
}

/**
 * Atomically drain the buffered state for `taskId` and merge it into chat-store.
 *
 * The earlier implementation awaited loadRecentTaskMessages and then called
 * updateMessage for each patched id — which silently failed whenever the id wasn't in
 * the loaded window, leaking messages. The new implementation:
 *
 *   1. Takes a snapshot + clears the buffer atomically (takeTaskSnapshot). Deltas
 *      arriving during the await go straight to chat-store because isTaskForeground
 *      is now true for this taskItem.
 *   2. Loads recent messages (so existing patched ids can be found if they're resident).
 *   3. Hands the whole snapshot to chat-store.applyBackgroundSnapshot which merges
 *      everything in a single Immer produce — inserting missing patched ids as new
 *      messages instead of silently dropping them.
 */
export async function flushBackgroundTaskToForeground(taskId: string): Promise<void> {
  if (!taskId) return
  cancelDebouncedMarkTaskUpdate(taskId)
  // Clear completed dot indicator when user opens the task
  const agentState = useAgentStore.getState()
  if (agentState.runningTasks[taskId] === 'completed') {
    agentState.setTaskStatus(taskId, null)
  }
  useInboxStore.getState().flushPendingMutationsNow()
  const snapshot = useInboxStore.getState().takeTaskSnapshot(taskId)
  if (!snapshot) return

  try {
    const chatState = useChatStore.getState()
    const taskItem = chatState.tasks.find((s) => s.id === taskId)
    const isStreaming = Boolean(chatState.streamingMessages[taskId])
    const hasResidentMessages = taskItem?.messagesLoaded && (taskItem.messages?.length ?? 0) > 0

    if (!isStreaming || !hasResidentMessages) {
      await chatState.loadRecentTaskMessages(taskId, true)
    }

    useChatStore.getState().applyBackgroundSnapshot(taskId, {
      patchedMessagesById: snapshot.patchedMessagesById,
      addedMessagesById: snapshot.addedMessagesById,
      addedMessageIds: snapshot.addedMessageIds
    })
  } catch (err) {
    log.error('Failed to flush background snapshot', err)
    // Restore the snapshot so the data isn't lost on subsequent attempts. seedBufferedMessage
    // is idempotent, so re-seeding is safe.
    const bg = useInboxStore.getState()
    for (const [, message] of Object.entries(snapshot.patchedMessagesById)) {
      bg.seedBufferedMessage(taskId, message, 'patched')
    }
    for (const id of snapshot.addedMessageIds) {
      const message = snapshot.addedMessagesById[id]
      if (message) bg.seedBufferedMessage(taskId, message, 'added')
    }
  }
}
