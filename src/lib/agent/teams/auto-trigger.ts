import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { useTeamStore } from '@/stores/team-store'
import { teamEvents } from '@/lib/agent/teams/events'
import { createLogger } from '@/lib/logger'
import type { ImageAttachment } from '@/lib/chat/image-attachments'
import type { SendMessageOptions, MessageSource } from '@/lib/chat/pending-messages'

const log = createLogger('TeamAutoTrigger')

// Re-exported type for reference
export type {
  MessageSource,
  SendMessageOptions,
} from '@/lib/chat/pending-messages'

/** Type for the sendMessage function stored at module level */
export type SendMessageFn = (
  text: string,
  images?: ImageAttachment[],
  source?: MessageSource,
  targetTaskId?: string,
  reuseAssistantMessageId?: string,
  options?: SendMessageOptions
) => Promise<void>

/** Module-level ref to the latest sendMessage function from the hook */
let _sendMessageFn: SendMessageFn | null = null

export function setSendMessageFn(fn: SendMessageFn): void {
  _sendMessageFn = fn
}

export function getSendMessageFn(): SendMessageFn | null {
  return _sendMessageFn
}

/** Queue of teammate messages to lead waiting to be processed */
const pendingLeadMessages: { from: string; content: string }[] = []

/** Whether the global team-message listener is registered */
let _teamLeadListenerActive = false

/** Counter for consecutive auto-triggered turns (reset on user-initiated sendMessage) */
let _autoTriggerCount = 0
const MAX_AUTO_TRIGGERS = 10

/** Debounce timer for batching teammate reports before draining */
let _drainTimer: ReturnType<typeof setTimeout> | null = null
const DRAIN_DEBOUNCE_MS = 800

/** Global pause flag — set by stopStreaming to halt all auto-triggering */
let _autoTriggerPaused = false

/** Schedule a debounced drain — collects reports arriving within the window into one batch */
export function scheduleDrain(): void {
  if (_drainTimer) clearTimeout(_drainTimer)
  _drainTimer = setTimeout(() => {
    _drainTimer = null
    drainLeadMessages()
  }, DRAIN_DEBOUNCE_MS)
}

export function cancelScheduledDrain(): void {
  if (_drainTimer) {
    clearTimeout(_drainTimer)
    _drainTimer = null
  }
}

/**
 * Reset the team auto-trigger state. Called from stopStreaming
 * to break the dead loop: abort -> completion message -> new turn -> re-spawn.
 */
export function resetTeamAutoTrigger(): void {
  pendingLeadMessages.length = 0
  _autoTriggerCount = 0
  _autoTriggerPaused = true
}

export function unpauseAutoTrigger(): void {
  _autoTriggerPaused = false
}

export function resetAutoTriggerCount(): void {
  _autoTriggerCount = 0
}

export function isAutoTriggerPaused(): boolean {
  return _autoTriggerPaused
}

/**
 * Set up a persistent listener on teamEvents that captures messages
 * addressed to "lead" and auto-triggers a new main agent turn.
 *
 * Called once; idempotent.
 */
export function ensureTeamLeadListener(): void {
  if (_teamLeadListenerActive) return
  _teamLeadListenerActive = true

  teamEvents.on((event) => {
    if (event.type === 'team_message' && event.message.to === 'lead') {
      pendingLeadMessages.push({ from: event.message.from, content: event.message.content })
      scheduleDrain()
    }
    // Clear queue and reset counter when team is deleted
    if (event.type === 'team_end') {
      pendingLeadMessages.length = 0
      _autoTriggerCount = 0
      if (_drainTimer) {
        clearTimeout(_drainTimer)
        _drainTimer = null
      }
    }
  })
}

// hasActiveTaskRun / dispatchNq helpers (from main file)
let _hasActiveTaskRun: ((taskId: string) => boolean) | null = null
export function registerHasActiveTaskRun(fn: (taskId: string) => boolean): void {
  _hasActiveTaskRun = fn
}

// Import helpers from pending-messages
import {
  dequeuePendingTaskMessage,
  replaceTaskPendingMessages,
  setPendingTaskDispatchPaused,
  isPendingTaskDispatchPaused
} from '@/lib/chat/pending-messages'

/**
 * Drain ALL pending lead messages as a single batched message.
 * Appends team progress info so the lead knows the overall status.
 * Skips if the active task's agent is already running.
 */
export function drainLeadMessages(): void {
  if (pendingLeadMessages.length === 0) return
  if (!_sendMessageFn) return
  if (_autoTriggerPaused) return

  // Safety: stop auto-triggering after too many consecutive turns
  if (_autoTriggerCount >= MAX_AUTO_TRIGGERS) {
    log.warn(
      `Auto-trigger limit reached (${MAX_AUTO_TRIGGERS}). ` +
        `${pendingLeadMessages.length} messages pending. Waiting for user input.`
    )
    return
  }

  const activeTaskId = useChatStore.getState().activeTaskId
  if (!activeTaskId) return

  const status = useAgentStore.getState().runningTasks[activeTaskId]
  if (status === 'running' || status === 'retrying') return

  // Batch all pending messages into one combined message
  const batch = pendingLeadMessages.splice(0, pendingLeadMessages.length)
  const parts = batch.map((msg) => `[Team message from ${msg.from}]:\n${msg.content}`)

  // Append team progress summary so the lead can decide whether to wait or summarize
  const team = useTeamStore.getState().activeTeam
  if (team) {
    const total = team.tasks.length
    const completed = team.tasks.filter((t) => t.status === 'completed').length
    const inProgress = team.tasks.filter((t) => t.status === 'in_progress').length
    const pending = team.tasks.filter((t) => t.status === 'pending').length
    parts.push(
      `\n---\n**Team Progress**: ${completed}/${total} tasks completed` +
        (inProgress > 0 ? `, ${inProgress} in progress` : '') +
        (pending > 0 ? `, ${pending} pending` : '') +
        (completed < total
          ? '. Other teammates are still working — review the report(s) above, then end your turn and wait for remaining reports unless immediate action is needed.'
          : '. All tasks completed — compile the final summary from all reports and then call TeamDelete to clean up the team.')
    )
  }

  const text = parts.join('\n\n')
  _autoTriggerCount++
  _sendMessageFn(text, undefined, 'team')
}

export function dispatchNextQueuedMessage(taskId: string): boolean {
  if (!_sendMessageFn) return false

  const taskExists = useChatStore.getState().tasks.some((s) => s.id === taskId)
  if (!taskExists) {
    replaceTaskPendingMessages(taskId, [])
    return false
  }

  if (isPendingTaskDispatchPaused(taskId)) return false
  if (_hasActiveTaskRun?.(taskId)) return false

  const next = dequeuePendingTaskMessage(taskId)
  if (!next) return false

  setPendingTaskDispatchPaused(taskId, false)
  setTimeout(() => {
    void _sendMessageFn?.(
      next.text,
      next.images,
      next.source ?? 'queued',
      taskId,
      undefined,
      next.options
    )
  }, 0)
  return true
}

export function dispatchNextQueuedMessageForTask(taskId: string): boolean {
  setPendingTaskDispatchPaused(taskId, false)
  return dispatchNextQueuedMessage(taskId)
}
