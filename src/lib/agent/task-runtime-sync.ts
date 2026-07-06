import type { ContentBlock, ToolUseBlock, UnifiedMessage } from '@/lib/api/types'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { useChatStore } from '@/stores/chat-store'

type ThinkingProvider = 'anthropic' | 'openai-responses' | 'google'

/**
 * Unique sender identity for this runtime context.
 * Every sync event carries the sender's ID; the listener skips events it
 * produced itself, eliminating the Tauri `window.emit()` echo that causes
 * double application of cumulative operations (text/thinking deltas, content blocks).
 */
export const SYNC_SENDER_ID = crypto.randomUUID()

export type TaskRuntimeSyncEvent =
  | { kind: 'set_streaming_message'; taskId: string; messageId: string | null }
  | { kind: 'set_generating_image'; messageId: string; generating: boolean; occurredAt: number }
  | { kind: 'set_generating_image_preview'; messageId: string; preview: ContentBlock | null }
  | { kind: 'add_message'; taskId: string; message: UnifiedMessage }
  | { kind: 'update_message'; taskId: string; messageId: string; patch: Partial<UnifiedMessage> }
  | { kind: 'append_text_delta'; taskId: string; messageId: string; text: string }
  | { kind: 'append_thinking_delta'; taskId: string; messageId: string; thinking: string }
  | {
      kind: 'set_thinking_encrypted'
      taskId: string
      messageId: string
      encryptedContent: string
      provider: ThinkingProvider
    }
  | { kind: 'complete_thinking'; taskId: string; messageId: string }
  | { kind: 'append_tool_use'; taskId: string; messageId: string; toolUse: ToolUseBlock }
  | {
      kind: 'update_tool_use_input'
      taskId: string
      messageId: string
      toolUseId: string
      input: Record<string, unknown>
    }
  | { kind: 'append_content_block'; taskId: string; messageId: string; block: ContentBlock }

export type TaskRuntimeControlSyncEvent =
  | { kind: 'stop_streaming'; taskId: string }
  | { kind: 'abort_session'; taskId: string }

/** Wire format: the sync event wrapped with sender identity. */
export type SyncEnvelope = {
  senderId: string
  event: unknown
}

function taskExists(taskId: string): boolean {
  return useChatStore.getState().tasks.some((taskItem) => taskItem.id === taskId)
}

function messageExists(taskId: string, messageId: string): boolean {
  return useChatStore
    .getState()
    .getTaskMessages(taskId)
    .some((message) => message.id === messageId)
}

function toolUseExists(taskId: string, messageId: string, toolUseId: string): boolean {
  const message = useChatStore
    .getState()
    .getTaskMessages(taskId)
    .find((item) => item.id === messageId)
  if (!message || typeof message.content === 'string') return false
  return message.content.some(
    (block) => block.type === 'tool_use' && (block as ToolUseBlock).id === toolUseId
  )
}

function applyTaskRuntimeSyncEvent(event: TaskRuntimeSyncEvent): void {
  const chatStore = useChatStore.getState()

  switch (event.kind) {
    case 'set_streaming_message':
      chatStore.setStreamingMessageId(event.taskId, event.messageId)
      return

    case 'set_generating_image':
      chatStore.setGeneratingImage(event.messageId, event.generating, event.occurredAt)
      return

    case 'set_generating_image_preview':
      chatStore.setGeneratingImagePreview(
        event.messageId,
        event.preview?.type === 'image' ? event.preview : null
      )
      return

    case 'add_message':
      if (!taskExists(event.taskId) || messageExists(event.taskId, event.message.id)) {
        return
      }
      chatStore.addMessage(event.taskId, event.message)
      return

    case 'update_message':
      if (!messageExists(event.taskId, event.messageId)) return
      chatStore.updateMessage(event.taskId, event.messageId, event.patch)
      return

    case 'append_text_delta':
      if (!messageExists(event.taskId, event.messageId)) return
      chatStore.appendTextDelta(event.taskId, event.messageId, event.text)
      return

    case 'append_thinking_delta':
      if (!messageExists(event.taskId, event.messageId)) return
      chatStore.appendThinkingDelta(event.taskId, event.messageId, event.thinking)
      return

    case 'set_thinking_encrypted':
      if (!messageExists(event.taskId, event.messageId)) return
      chatStore.setThinkingEncryptedContent(
        event.taskId,
        event.messageId,
        event.encryptedContent,
        event.provider
      )
      return

    case 'complete_thinking':
      if (!messageExists(event.taskId, event.messageId)) return
      chatStore.completeThinking(event.taskId, event.messageId)
      return

    case 'append_tool_use':
      if (!messageExists(event.taskId, event.messageId)) return
      if (toolUseExists(event.taskId, event.messageId, event.toolUse.id)) return
      chatStore.appendToolUse(event.taskId, event.messageId, event.toolUse)
      return

    case 'update_tool_use_input':
      if (!toolUseExists(event.taskId, event.messageId, event.toolUseId)) return
      chatStore.updateToolUseInput(event.taskId, event.messageId, event.toolUseId, event.input)
      return

    case 'append_content_block':
      if (!messageExists(event.taskId, event.messageId)) return
      chatStore.appendContentBlock(event.taskId, event.messageId, event.block)
      return
  }
}

/**
 * Emit a sync event to the Tauri backend for cross-window/cross-webview delivery.
 * The event is wrapped in an envelope that carries the sender's identity so that
 * the originating window can recognise and skip its own echo.
 */
export function emitTaskRuntimeSync(event: TaskRuntimeSyncEvent): void {
  const envelope: SyncEnvelope = { senderId: SYNC_SENDER_ID, event }
  tauriCommands.send(TAURI_COMMANDS.TASK_RUNTIME_SYNC, envelope)
}

export function emitTaskRuntimeControlSync(event: TaskRuntimeControlSyncEvent): void {
  const envelope: SyncEnvelope = { senderId: SYNC_SENDER_ID, event }
  tauriCommands.send(TAURI_COMMANDS.TASK_RUNTIME_SYNC, envelope)
}

/**
 * Install the listener that applies sync events from other windows/webviews.
 * Self-originated events (echoed back by `window.emit`) are discarded.
 */
export function installTaskRuntimeSyncListener(): () => void {
  return tauriCommands.on(TAURI_COMMANDS.TASK_RUNTIME_SYNC, (data: unknown) => {
    const envelope = data as SyncEnvelope
    if (envelope.senderId === SYNC_SENDER_ID) return
    applyTaskRuntimeSyncEvent(envelope.event as TaskRuntimeSyncEvent)
  })
}

export function installTaskRuntimeControlSyncListener(
  onEvent: (event: TaskRuntimeControlSyncEvent) => void
): () => void {
  return tauriCommands.on(TAURI_COMMANDS.TASK_RUNTIME_SYNC, (data: unknown) => {
    const envelope = data as SyncEnvelope
    if (envelope.senderId === SYNC_SENDER_ID) return
    const event = envelope.event as TaskRuntimeControlSyncEvent
    if (event.kind !== 'stop_streaming' && event.kind !== 'abort_session') return
    onEvent(event)
  })
}
