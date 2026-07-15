import * as React from 'react'
import { useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Copy,
  RotateCcw
} from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { useShallow } from 'zustand/react/shallow'
import type { ContentBlock, TokenUsage, ToolResultContent } from '@/lib/api/types'
import type { RequestRetryState, ToolCallState } from '@/lib/agent/types'
import { ActionIconButton } from './assistant/ActionBar'
import { CompressButton } from './assistant/CompressButton'

import { parseThinkTags, stripThinkTags, stripThinkTagMarkers } from '@/lib/chat/think-tag-parser'
import { stripStageTags } from '@/lib/chat/stage-tag-parser'
import { renderAssistantContent } from './assistant/ContentRenderer'

interface AssistantMessageProps {
  content: string | ContentBlock[]
  isStreaming?: boolean
  usage?: TokenUsage
  toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
  liveToolCallMap?: Map<string, ToolCallState> | null
  msgId?: string
  taskId?: string | null
  taskAssistantMessageIds?: readonly string[]
  taskToolUseIds?: readonly string[]
  showRetry?: boolean
  showContinue?: boolean
  isLastAssistantMessage?: boolean
  onRetry?: (messageId: string) => void
  onContinue?: () => void
  onDelete?: (messageId: string) => void
  /** When false, disables reactive behaviors (image-gen state, live tool calls, action bar buttons).
   *  Older messages scrolled out of the live window receive `live={false}`. */
  live?: boolean
  requestRetryState?: RequestRetryState | null
}

const EMPTY_LIVE_TOOL_CALLS: ToolCallState[] = []

function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) return `${delayMs}ms`
  if (delayMs < 10_000) return `${(delayMs / 1000).toFixed(1)}s`
  return `${Math.round(delayMs / 1000)}s`
}

function normalizeStructuredBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const hasStructuredThinkingBlocks = blocks.some((b) => b.type === 'thinking')
  const normalized: ContentBlock[] = []
  const toolUseIndices = new Map<string, number>()

  for (const block of blocks) {
    if (block.type === 'text') {
      const text = hasStructuredThinkingBlocks ? stripThinkTags(block.text) : block.text
      if (!text.trim()) continue
      const last = normalized[normalized.length - 1]
      if (last && last.type === 'text') {
        normalized[normalized.length - 1] = { ...last, text: `${last.text}${text}` }
      } else {
        normalized.push({ ...block, text })
      }
      continue
    }

    if (block.type === 'thinking') {
      const cleanedThinking = stripThinkTagMarkers(block.thinking).trim()
      if (!cleanedThinking && !block.startedAt && !block.encryptedContent) continue
      const last = normalized[normalized.length - 1]
      if (last && last.type === 'thinking') {
        let mergedThinking: string
        if (!last.thinking) {
          mergedThinking = cleanedThinking
        } else if (!cleanedThinking) {
          mergedThinking = last.thinking
        } else {
          const separator =
            last.thinking.endsWith('\n') || cleanedThinking.startsWith('\n') ? '' : '\n'
          mergedThinking = `${last.thinking}${separator}${cleanedThinking}`
        }
        normalized[normalized.length - 1] = {
          ...last,
          thinking: mergedThinking,
          startedAt: last.startedAt ?? block.startedAt,
          completedAt: block.completedAt ?? last.completedAt
        }
      } else {
        normalized.push({ ...block, thinking: cleanedThinking })
      }
      continue
    }

    if (block.type === 'tool_use' && block.id) {
      const existingIndex = toolUseIndices.get(block.id)
      if (existingIndex !== undefined) {
        normalized[existingIndex] = {
          ...(normalized[existingIndex] as Extract<ContentBlock, { type: 'tool_use' }>),
          ...block
        }
        continue
      }

      toolUseIndices.set(block.id, normalized.length)
    }

    normalized.push(block)
  }

  return normalized
}

export function AssistantMessage({
  content,
  isStreaming,
  usage,
  toolResults,
  liveToolCallMap,
  msgId,
  taskId,
  taskAssistantMessageIds = [],
  taskToolUseIds = [],
  showRetry,
  showContinue,
  isLastAssistantMessage,
  onRetry,
  onContinue,
  onDelete,
  live = true,
  requestRetryState
}: AssistantMessageProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const fadeInClassName = ''
  const liveScaleInClassName = ''

  const isGeneratingImage = useChatStore((s) =>
    live && msgId ? !!s.generatingImageMessages[msgId] : false
  )
  const imageGenerationTiming = useChatStore((s) =>
    live && msgId ? s.imageGenerationTimings[msgId] : undefined
  )
  const generatingImagePreview = useChatStore((s) =>
    live && msgId ? s.generatingImagePreviews[msgId] : undefined
  )

  const stringSegments = useMemo(
    () => (typeof content === 'string' ? parseThinkTags(stripStageTags(content)) : null),
    [content]
  )
  const normalizedContent = useMemo(
    () => (Array.isArray(content) ? normalizeStructuredBlocks(content) : null),
    [content]
  )
  const messageToolUseIds = useMemo(() => {
    if (!normalizedContent) return []
    return normalizedContent
      .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => b.id)
  }, [normalizedContent])

  const hydrateChangeSets = useAgentStore((s) => s.hydrateChangeSets)

  // --- live tool calls ---
  const liveToolCallIds = useMemo(() => {
    if (!isStreaming) return []
    return messageToolUseIds
  }, [isStreaming, messageToolUseIds])
  const liveToolCalls = useAgentStore(
    useShallow((s) => {
      if (!live || liveToolCallMap || !isStreaming || liveToolCallIds.length === 0) {
        return EMPTY_LIVE_TOOL_CALLS
      }
      const idSet = new Set(liveToolCallIds)
      const matches: ToolCallState[] = []
      for (const tc of s.executedToolCalls) {
        if (idSet.has(tc.id)) matches.push(tc)
      }
      return matches
    })
  )
  const effectiveLiveToolCallMap = useMemo(() => {
    if (liveToolCallMap) return liveToolCallMap
    if (!isStreaming || liveToolCalls.length === 0) return null
    return new Map(liveToolCalls.map((tc) => [tc.id, tc]))
  }, [isStreaming, liveToolCalls, liveToolCallMap])

  const hasStructuredThinkingBlocks = useMemo(
    () => normalizedContent?.some((b) => b.type === 'thinking') ?? false,
    [normalizedContent]
  )
  const lastStructuredTextIdx = useMemo(() => {
    if (!isStreaming || !normalizedContent) return -1
    return normalizedContent.reduce((acc: number, b, i) => (b.type === 'text' ? i : acc), -1)
  }, [isStreaming, normalizedContent])

  // Hydrate change sets from DB after streaming completes
  useEffect(() => {
    if (!live || !isLastAssistantMessage || !taskId || isStreaming) return
    void hydrateChangeSets(taskId)
  }, [isLastAssistantMessage, live, isStreaming, taskId, hydrateChangeSets])

  // --- plain text for actions ---
  const plainText =
    typeof content === 'string'
      ? stripStageTags(stripThinkTags(content))
      : Array.isArray(content)
        ? content
            .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => stripStageTags(stripThinkTags(b.text)))
            .join('\n')
        : ''

  // --- action handlers ---
  const handleCopy = useCallback((): void => {
    if (!plainText) return
    navigator.clipboard.writeText(plainText)
  }, [plainText])

  return (
    <div className="group/msg flex flex-col">
      <div className="min-w-0 overflow-hidden">
        {requestRetryState && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <RotateCcw className="mt-0.5 size-3.5 shrink-0 animate-spin" />
            <div className="min-w-0">
              <div className="font-medium">
                {t('assistantMessage.retryingRequest', { defaultValue: 'Request retrying' })}
              </div>
              <div className="mt-0.5 break-words text-[11px] text-amber-700/80 dark:text-amber-200/80">
                {t('assistantMessage.retryingRequestDetail', {
                  defaultValue: 'Attempt {{attempt}} / {{maxAttempts}} retry, resend after {{delay}}{{statusSuffix}}',
                  attempt: requestRetryState.attempt,
                  maxAttempts: requestRetryState.maxAttempts,
                  delay: formatRetryDelay(requestRetryState.delayMs),
                  statusSuffix: requestRetryState.statusCode ? `, status code ${requestRetryState.statusCode}` : ''
                })}
                {requestRetryState.reason ? ` · ${requestRetryState.reason}` : ''}
              </div>
            </div>
          </div>
        )}

        {renderAssistantContent({
              content,
              normalizedContent,
              stringSegments,
              isStreaming,
              isGeneratingImage,
              imageGenerationTiming,
              generatingImagePreview,
              fadeInClassName,
              liveScaleInClassName,
              toolResults,
              effectiveLiveToolCallMap,
              hasStructuredThinkingBlocks,
              lastStructuredTextIdx,
              isLastAssistantMessage,
              t
            })}

        {/* action bar */}
        {!isStreaming &&
            (plainText ||
              (live && taskId && msgId) ||
              (showRetry && onRetry) ||
              (live && taskId)) && (
          <div
            className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100"
          >
            {plainText && (
              <ActionIconButton
                label={t('action.copy', { ns: 'common' })}
                icon={<Copy className="size-3.5" />}
                onClick={handleCopy}
              />
            )}
            {showRetry && onRetry ? (
              <ActionIconButton
                label={t('assistantMessage.regenerateReference', { defaultValue: 'Regenerate reference' })}
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => msgId && onRetry?.(msgId)}
              />
            ) : null}
            {live && taskId ? (
              <CompressButton usage={usage} taskId={taskId} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
