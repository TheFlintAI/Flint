import * as React from 'react'
import Markdown from 'react-markdown'
import { Users, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SlideIn } from '@/components/animate-ui'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ContextCompressionMessage } from './ContextCompressionMessage'
import { UserMessageEntrance } from './transcript/user-message-entrance'
import type { UnifiedMessage, ToolResultContent } from '@/lib/api/types'
import type { RequestRetryState, ToolCallState } from '@/lib/agent/types'
import { isCompactSummaryLikeMessage } from '@/lib/agent/context-compression'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@/lib/utils/markdown-utils'

type MessageRenderMode = 'default' | 'transcript' | 'static'

interface MessageItemProps {
  message: UnifiedMessage
  messageId: string
  taskId?: string | null
  taskAssistantMessageIds?: readonly string[]
  taskToolUseIds?: readonly string[]
  isStreaming?: boolean
  isLastUserMessage?: boolean
  isLastAssistantMessage?: boolean
  showContinue?: boolean
  disableAnimation?: boolean
  onRetryAssistantMessage?: (messageId: string) => void
  onContinueAssistantMessage?: () => void
  onDeleteMessage?: (messageId: string) => void
  onRollbackMessage?: (messageId: string) => void
  toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
  liveToolCallMap?: Map<string, ToolCallState> | null
  renderMode?: MessageRenderMode
  requestRetryState?: RequestRetryState | null
}

function TeamNotification({ content }: { content: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)
  const match = content.match(/^\[Team message from (.+?)\]:\n?/)
  const from = match?.[1] ?? t('teamMessage.fromTeammate')
  const body = match ? content.slice(match[0].length) : content

  return (
    <div className="my-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        <Users className="size-3.5 text-cyan-500 shrink-0" />
        <span className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400">{from}</span>
        <span className="flex-1" />
        <ChevronDown
          className={`size-3.5 text-muted-foreground/50 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-cyan-500/20 px-3 py-2 text-xs text-muted-foreground typeset typeset-sm">
            <Markdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            >
              {body}
            </Markdown>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageItemInner({
  message,
  messageId,
  taskId,
  taskAssistantMessageIds,
  taskToolUseIds,
  isStreaming,
  isLastUserMessage,
  isLastAssistantMessage,
  showContinue,
  disableAnimation,
  onRetryAssistantMessage,
  onContinueAssistantMessage,
  onDeleteMessage,
  onRollbackMessage,
  toolResults,
  liveToolCallMap,
  renderMode = 'default',
  requestRetryState
}: MessageItemProps): React.JSX.Element | null {
  if (message.id !== messageId) return null

  const inner = (() => {
    switch (message.role) {
      case 'user': {
        if (isCompactSummaryLikeMessage(message)) {
          return <ContextCompressionMessage message={message} />
        }
        if (message.source === 'team') {
          return (
            <TeamNotification
              content={
                typeof message.content === 'string'
                  ? message.content
                  : JSON.stringify(message.content)
              }
            />
          )
        }
        return (
          <UserMessage
            content={message.content}
            contextSnapshot={message.meta?.contextSnapshot}
            messageId={message.id}
            taskId={taskId}
            onRollback={onRollbackMessage}
          />
        )
      }
      case 'assistant':
        return (
          <AssistantMessage
            content={message.content}
            isStreaming={isStreaming}
            usage={message.usage}
            toolResults={toolResults}
            msgId={message.id}
            taskId={taskId}
            taskAssistantMessageIds={taskAssistantMessageIds}
            taskToolUseIds={taskToolUseIds}
            showRetry
            showContinue={showContinue && isLastAssistantMessage}
            isLastAssistantMessage={isLastAssistantMessage}
            onRetry={onRetryAssistantMessage}
            onContinue={onContinueAssistantMessage}
            onDelete={onDeleteMessage}
            liveToolCallMap={liveToolCallMap}
            renderMode={renderMode}
            requestRetryState={isLastAssistantMessage ? requestRetryState : null}
          />
        )
      case 'system':
        return <ContextCompressionMessage message={message} />
      default:
        return null
    }
  })()

  if (!inner) return null

  const isPlainUserMessage =
    message.role === 'user' && !isCompactSummaryLikeMessage(message) && message.source !== 'team'

  if (isPlainUserMessage) {
    return (
      <UserMessageEntrance
        taskId={taskId}
        isLastUserMessage={isLastUserMessage}
        disableAnimation={disableAnimation}
      >
        {inner}
      </UserMessageEntrance>
    )
  }

  if (disableAnimation) {
    return (
      <div className="group/ts relative">
        {inner}
      </div>
    )
  }

  return (
    <SlideIn className="group/ts relative" direction="up" offset={10} duration={0.3}>
      {inner}
    </SlideIn>
  )
}

function areToolResultsEqual(
  a?: Map<string, { content: ToolResultContent; isError?: boolean }>,
  b?: Map<string, { content: ToolResultContent; isError?: boolean }>
): boolean {
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

function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }

  return true
}

function areRequestRetryStatesEqual(
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

function areEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  // Fast path: same object reference => nothing to compare.
  if (prev.message === next.message) {
    return (
      prev.messageId === next.messageId &&
      prev.taskId === next.taskId &&
      areStringArraysEqual(prev.taskAssistantMessageIds, next.taskAssistantMessageIds) &&
      areStringArraysEqual(prev.taskToolUseIds, next.taskToolUseIds) &&
      prev.isStreaming === next.isStreaming &&
      prev.isLastUserMessage === next.isLastUserMessage &&
      prev.isLastAssistantMessage === next.isLastAssistantMessage &&
      prev.showContinue === next.showContinue &&
      prev.disableAnimation === next.disableAnimation &&
      prev.onRetryAssistantMessage === next.onRetryAssistantMessage &&
      prev.onContinueAssistantMessage === next.onContinueAssistantMessage &&
      prev.onDeleteMessage === next.onDeleteMessage &&
      prev.onRollbackMessage === next.onRollbackMessage &&
      areToolResultsEqual(prev.toolResults, next.toolResults) &&
      prev.liveToolCallMap === next.liveToolCallMap &&
      prev.renderMode === next.renderMode &&
      areRequestRetryStatesEqual(prev.requestRetryState, next.requestRetryState)
    )
  }

  // Revision-based equality: any mutation to the message in chat-store bumps _revision,
  // so comparing (_revision, usage-revision, id) is sufficient without scanning content.
  const contentEqual = prev.message._revision === next.message._revision

  // Usage signature still needs a structural compare (small object, cheap).
  const prevUsageSignal = prev.message.usage
    ? `${prev.message.usage.inputTokens}:${prev.message.usage.billableInputTokens ?? ''}:${prev.message.usage.outputTokens}:${prev.message.usage.cacheCreationTokens ?? 0}:${prev.message.usage.cacheCreation5mTokens ?? 0}:${prev.message.usage.cacheCreation1hTokens ?? 0}:${prev.message.usage.cacheReadTokens ?? 0}:${prev.message.usage.reasoningTokens ?? 0}:${prev.message.usage.totalDurationMs ?? 0}`
    : ''
  const nextUsageSignal = next.message.usage
    ? `${next.message.usage.inputTokens}:${next.message.usage.billableInputTokens ?? ''}:${next.message.usage.outputTokens}:${next.message.usage.cacheCreationTokens ?? 0}:${next.message.usage.cacheCreation5mTokens ?? 0}:${next.message.usage.cacheCreation1hTokens ?? 0}:${next.message.usage.cacheReadTokens ?? 0}:${next.message.usage.reasoningTokens ?? 0}:${next.message.usage.totalDurationMs ?? 0}`
    : ''

  return (
    prev.messageId === next.messageId &&
    prev.taskId === next.taskId &&
    areStringArraysEqual(prev.taskAssistantMessageIds, next.taskAssistantMessageIds) &&
    areStringArraysEqual(prev.taskToolUseIds, next.taskToolUseIds) &&
    prev.isStreaming === next.isStreaming &&
    prev.isLastUserMessage === next.isLastUserMessage &&
    prev.isLastAssistantMessage === next.isLastAssistantMessage &&
    prev.showContinue === next.showContinue &&
    prev.disableAnimation === next.disableAnimation &&
    prev.onRetryAssistantMessage === next.onRetryAssistantMessage &&
    prev.onContinueAssistantMessage === next.onContinueAssistantMessage &&
    prev.onDeleteMessage === next.onDeleteMessage &&
    prev.onRollbackMessage === next.onRollbackMessage &&
    prev.message.role === next.message.role &&
    prev.message.createdAt === next.message.createdAt &&
    prev.message.source === next.message.source &&
    prev.message.debugInfo === next.message.debugInfo &&
    contentEqual &&
    prevUsageSignal === nextUsageSignal &&
    areToolResultsEqual(prev.toolResults, next.toolResults) &&
    prev.liveToolCallMap === next.liveToolCallMap &&
    prev.renderMode === next.renderMode &&
    areRequestRetryStatesEqual(prev.requestRetryState, next.requestRetryState)
  )
}

export const MessageItem = React.memo(MessageItemInner, areEqual)
