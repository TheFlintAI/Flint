import * as React from 'react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Copy,
  RotateCcw,
  GitFork
} from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { useShallow } from 'zustand/react/shallow'
import type { ContentBlock, TokenUsage, ToolResultContent } from '@/lib/api/types'
import {
  formatTokens
} from '@/lib/utils/format-tokens'
import { formatDurationMs } from '@/lib/utils/format-duration'
import { useMemoizedTokens } from '@/hooks/use-estimated-tokens'
import type { RequestRetryState, ToolCallState } from '@/lib/agent/types'
import { ActionIconButton } from './assistant/ActionBar'
import { useUIStore } from '@/stores/ui-store'
import { createLogger } from '@/lib/logger'
import { parseThinkTags, stripThinkTags, stripThinkTagMarkers } from '@/lib/chat/think-tag-parser'
import { stripStageTags } from '@/lib/chat/stage-tag-parser'
import { renderAssistantContent } from './assistant/ContentRenderer'

const log = createLogger('AssistantMessage')

type AssistantRenderMode = 'default' | 'transcript' | 'static'

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
  renderMode?: AssistantRenderMode
  requestRetryState?: RequestRetryState | null
}

const EMPTY_LIVE_TOOL_CALLS: ToolCallState[] = []

function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) return `${delayMs}ms`
  if (delayMs < 10_000) return `${(delayMs / 1000).toFixed(1)}s`
  return `${Math.round(delayMs / 1000)}s`
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
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
  renderMode = 'default',
  requestRetryState
}: AssistantMessageProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const fadeInClassName = ''
  const liveScaleInClassName = ''
  const navigateToTask = useUIStore((s) => s.navigateToTask)
  const forkTaskFromMessage = useChatStore((s) => s.forkTaskFromMessage)
  const [forking, setForking] = useState(false)

  const isLiveMode = renderMode === 'default'

  // --- derived content ---
  const plainTextForTokens = useMemo(() => {
    if (usage || isStreaming) return ''
    if (typeof content === 'string') return stripStageTags(stripThinkTags(content))
    if (!Array.isArray(content)) return ''
    return content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => stripStageTags(stripThinkTags(b.text)))
      .join('\n')
  }, [content, usage, isStreaming])
  const fallbackTokens = useMemoizedTokens(plainTextForTokens)

  const isGeneratingImage = useChatStore((s) =>
    isLiveMode && msgId ? !!s.generatingImageMessages[msgId] : false
  )
  const imageGenerationTiming = useChatStore((s) =>
    isLiveMode && msgId ? s.imageGenerationTimings[msgId] : undefined
  )
  const generatingImagePreview = useChatStore((s) =>
    isLiveMode && msgId ? s.generatingImagePreviews[msgId] : undefined
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
      if (!isLiveMode || liveToolCallMap || !isStreaming || liveToolCallIds.length === 0) {
        return EMPTY_LIVE_TOOL_CALLS
      }
      const idSet = new Set(liveToolCallIds)
      const matches: ToolCallState[] = []
      for (const tc of s.pendingToolCalls) {
        if (idSet.has(tc.id)) matches.push(tc)
      }
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
    if (!isLiveMode || !isLastAssistantMessage || !taskId || isStreaming) return
    void hydrateChangeSets(taskId)
  }, [isLastAssistantMessage, isLiveMode, isStreaming, taskId, hydrateChangeSets])

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

  const handleFork = useCallback(async (): Promise<void> => {
    if (!taskId || !msgId || forking) return
    setForking(true)
    try {
      const forkedTaskId = await forkTaskFromMessage(taskId, msgId)
      if (!forkedTaskId) {
        toast.error(t('messageActions.forkFailed'))
        return
      }
      navigateToTask(forkedTaskId)
      toast.success(t('messageActions.forked'))
    } catch (error) {
      log.error('Failed to fork taskItem:', error)
      toast.error(t('messageActions.forkFailed'))
    } finally {
      setForking(false)
    }
  }, [forkTaskFromMessage, forking, msgId, navigateToTask, taskId, t])

  // --- transcript footer ---
  const timingSummary = useMemo(() => {
    if (renderMode !== 'transcript') return null
    const imgGenDuration =
      imageGenerationTiming?.startedAt && imageGenerationTiming.completedAt
        ? formatDurationMs(imageGenerationTiming.completedAt - imageGenerationTiming.startedAt)
        : null
    const totalDuration =
      imgGenDuration ?? (usage?.totalDurationMs ? formatDurationMs(usage.totalDurationMs) : null)
    const perRequest = usage?.requestTimings ?? []
    const lastTiming = perRequest.length > 0 ? perRequest[perRequest.length - 1] : null
    if (!totalDuration && !lastTiming) return null

    let lastDetail: string | null = null
    if (lastTiming) {
      const parts: string[] = []
      const totalMs = toFiniteNumber(lastTiming.totalMs)
      const ttftMs = toFiniteNumber(lastTiming.ttftMs)
      const tps = toFiniteNumber(lastTiming.tps)
      if (totalMs !== null) parts.push(`${t('assistantMessage.req', { count: perRequest.length })} ${formatDurationMs(totalMs)}`)
      if (ttftMs !== null) parts.push(`${t('assistantMessage.ttft')} ${formatDurationMs(ttftMs)}`)
      if (tps !== null) parts.push(`${t('assistantMessage.tps')} ${tps.toFixed(1)}`)
      lastDetail = parts.length > 0 ? parts.join(' · ') : null
    }
    return { totalDuration, lastDetail }
  }, [imageGenerationTiming, t, usage, renderMode])


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

            {renderMode === 'transcript' && !isStreaming && plainText && (
              <p className="mt-1 text-[10px] text-muted-foreground/55 tabular-nums">
                {usage
                  ? (() => {
                      const u = usage!
                      const total = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
                      return (
                        <>
                          {`${formatTokens(total)} ${t('unit.tokens', { ns: 'common' })} (${formatTokens(u.inputTokens ?? 0)}↓ ${formatTokens(u.outputTokens)}↑`}
                          {u.cacheReadTokens ? ` · ${formatTokens(u.cacheReadTokens)} ${t('unit.cached', { ns: 'common' })}` : ''}
                          {u.reasoningTokens ? ` · ${formatTokens(u.reasoningTokens)} ${t('unit.reasoning', { ns: 'common' })}` : ''}
                          {u.cacheCreationTokens ? ` · ${formatTokens(u.cacheCreationTokens)} cache write` : ''}
                          {')'}
                        </>
                      )
                    })()
                  : `~${formatTokens(fallbackTokens)} ${t('unit.tokens', { ns: 'common' })}`}
              </p>
            )}

            {renderMode === 'transcript' && !isStreaming && timingSummary && (
              <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground/55 tabular-nums">
                {timingSummary.totalDuration && (
                  <div>
                    {t('assistantMessage.totalDuration', { duration: timingSummary.totalDuration })}
                  </div>
                )}
                {timingSummary.lastDetail && <div>{timingSummary.lastDetail}</div>}
              </div>
            )}

        {/* action bar */}
        {!isStreaming &&
            (plainText ||
              (isLiveMode && taskId && msgId) ||
              (showRetry && onRetry)) && (
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
            {isLiveMode && taskId && msgId ? (
              <ActionIconButton
                label={t('messageActions.fork')}
                icon={<GitFork className="size-3.5" />}
                onClick={() => void handleFork()}
                disabled={forking}
              />
            ) : null}
            {showRetry && onRetry ? (
              <ActionIconButton
                label={t('assistantMessage.regenerateReference', { defaultValue: 'Regenerate reference' })}
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => msgId && onRetry?.(msgId)}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
