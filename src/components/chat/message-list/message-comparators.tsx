import * as React from 'react'
import type { RequestRetryState } from '@/lib/agent/types'
import type { UnifiedMessage } from '@/lib/api/types'
import type { MessageListProps, ToolResultsLookup } from './types'
import { MessageItem } from '../MessageItem'
import { MESSAGE_COLUMN_CLASS } from './constants'
import { cn } from '@/lib/utils'

export function areToolResultsEqual(a?: ToolResultsLookup, b?: ToolResultsLookup): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.size !== b.size) return false

  for (const [id, value] of a) {
    const other = b.get(id)
    if (!other) return false
    if (other.isError !== value.isError) return false
    if (other.content !== value.content) return false
  }

  return true
}

export function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }

  return true
}

export function areRequestRetryStatesEqual(
  a?: RequestRetryState | null,
  b?: RequestRetryState | null
): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b

  return (
    a.attempt === b.attempt &&
    a.maxAttempts === b.maxAttempts &&
    a.delayMs === b.delayMs &&
    a.statusCode === b.statusCode &&
    a.reason === b.reason
  )
}

export interface MessageRowProps {
  message: UnifiedMessage
  taskId?: string | null
  taskAssistantMessageIds?: readonly string[]
  taskToolUseIds?: readonly string[]
  isStreaming: boolean
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
  showContinue: boolean
  disableAnimation: boolean
  toolResults?: ToolResultsLookup
  anchorMessageId?: string | null
  highlightMessageId?: string | null
  requestRetryState?: RequestRetryState | null
  renderMode?: 'default' | 'transcript' | 'static'
  onRetry?: () => void
  onContinue?: () => void
  onDeleteMessage?: (messageId: string) => void
  onRollbackMessage?: (messageId: string) => void
}

export function areMessageRowPropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    prev.message === next.message &&
    prev.taskId === next.taskId &&
    areStringArraysEqual(prev.taskAssistantMessageIds, next.taskAssistantMessageIds) &&
    areStringArraysEqual(prev.taskToolUseIds, next.taskToolUseIds) &&
    prev.isStreaming === next.isStreaming &&
    prev.isLastUserMessage === next.isLastUserMessage &&
    prev.isLastAssistantMessage === next.isLastAssistantMessage &&
    prev.showContinue === next.showContinue &&
    prev.disableAnimation === next.disableAnimation &&
    (prev.toolResults === next.toolResults ||
      areToolResultsEqual(prev.toolResults, next.toolResults)) &&
    prev.anchorMessageId === next.anchorMessageId &&
    prev.highlightMessageId === next.highlightMessageId &&
    prev.renderMode === next.renderMode &&
    areRequestRetryStatesEqual(prev.requestRetryState, next.requestRetryState) &&
    prev.onRetry === next.onRetry &&
    prev.onContinue === next.onContinue &&
    prev.onDeleteMessage === next.onDeleteMessage &&
    prev.onRollbackMessage === next.onRollbackMessage
  )
}

export function areMessageListPropsEqual(prev: MessageListProps, next: MessageListProps): boolean {
  return (
    prev.taskId === next.taskId &&
    prev.onRetry === next.onRetry &&
    prev.onContinue === next.onContinue &&
    prev.onDeleteMessage === next.onDeleteMessage &&
    prev.onRollbackMessage === next.onRollbackMessage
  )
}

export const MessageRow = React.memo(function MessageRow({
  message,
  taskId,
  taskAssistantMessageIds,
  taskToolUseIds,
  isStreaming,
  isLastUserMessage,
  isLastAssistantMessage,
  showContinue,
  disableAnimation,
  toolResults,
  anchorMessageId,
  highlightMessageId,
  requestRetryState,
  renderMode,
  onRetry,
  onContinue,
  onDeleteMessage,
  onRollbackMessage
}: MessageRowProps): React.JSX.Element {
  const isAnchor = anchorMessageId === message.id
  const isHighlighted = highlightMessageId === message.id
  const isStickyLatestUser = isLastUserMessage && message.role === 'user'

  return (
    <div
      data-message-id={message.id}
      data-anchor={isAnchor ? 'true' : undefined}
      className={cn(
        MESSAGE_COLUMN_CLASS,
        'transition-colors duration-500',
        isStickyLatestUser
          ? 'sticky top-0 z-10 bg-background pt-2 pb-2'
          : 'pb-7',
        isHighlighted && 'rounded-md bg-foreground/5 ring-1 ring-foreground/10'
      )}
    >
      <MessageItem
        message={message}
        messageId={message.id}
        taskId={taskId}
        taskAssistantMessageIds={taskAssistantMessageIds}
        taskToolUseIds={taskToolUseIds}
        isStreaming={isStreaming}
        isLastUserMessage={isLastUserMessage}
        isLastAssistantMessage={isLastAssistantMessage}
        showContinue={showContinue}
        disableAnimation={disableAnimation}
        renderMode={renderMode}
        onRetryAssistantMessage={onRetry}
        onContinueAssistantMessage={onContinue}
        onDeleteMessage={onDeleteMessage}
        onRollbackMessage={onRollbackMessage}
        toolResults={toolResults}
        requestRetryState={requestRetryState}
      />
    </div>
  )
}, areMessageRowPropsEqual)
