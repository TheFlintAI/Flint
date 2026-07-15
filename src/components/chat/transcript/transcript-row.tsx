import * as React from 'react'
import type { RequestRetryState } from '@/lib/agent/types'
import type { UnifiedMessage } from '@/lib/api/types'
import type { TranscriptScrollerProps, ToolResultsLookup } from './types'
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

export interface TranscriptRowProps {
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
  highlightMessageId?: string | null
  requestRetryState?: RequestRetryState | null
  live?: boolean
  onRetry?: () => void
  onContinue?: () => void
  onDeleteMessage?: (messageId: string) => void
  onRollbackMessage?: (messageId: string) => void
}

export function areTranscriptRowPropsEqual(prev: TranscriptRowProps, next: TranscriptRowProps): boolean {
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
    prev.highlightMessageId === next.highlightMessageId &&
    prev.live === next.live &&
    areRequestRetryStatesEqual(prev.requestRetryState, next.requestRetryState) &&
    prev.onRetry === next.onRetry &&
    prev.onContinue === next.onContinue &&
    prev.onDeleteMessage === next.onDeleteMessage &&
    prev.onRollbackMessage === next.onRollbackMessage
  )
}

export function areTranscriptScrollerPropsEqual(
  prev: TranscriptScrollerProps,
  next: TranscriptScrollerProps
): boolean {
  return (
    prev.taskId === next.taskId &&
    prev.onRetry === next.onRetry &&
    prev.onContinue === next.onContinue &&
    prev.onDeleteMessage === next.onDeleteMessage &&
    prev.onRollbackMessage === next.onRollbackMessage
  )
}

export const TranscriptRow = React.memo(function TranscriptRow({
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
  highlightMessageId,
  requestRetryState,
  live,
  onRetry,
  onContinue,
  onDeleteMessage,
  onRollbackMessage
}: TranscriptRowProps): React.JSX.Element {
  const isHighlighted = highlightMessageId === message.id
  const isUserMessage = message.role === 'user'

  return (
    <div
      data-message-id={message.id}
      className={cn(
        MESSAGE_COLUMN_CLASS,
        'transition-colors duration-500',
        isUserMessage
          ? 'pt-2 pb-4'
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
        live={live}
        onRetryAssistantMessage={onRetry}
        onContinueAssistantMessage={onContinue}
        onDeleteMessage={onDeleteMessage}
        onRollbackMessage={onRollbackMessage}
        toolResults={toolResults}
        requestRetryState={requestRetryState}
      />
    </div>
  )
}, areTranscriptRowPropsEqual)
