import * as React from 'react'
import { ScaleIn } from '@/components/animate-ui'
import { ImageGeneratingLoader } from '../ImageGeneratingLoader'
import { ImageGenerationErrorCard } from '../ImageGenerationErrorCard'
import { AgentErrorCard } from '../AgentErrorCard'
import { ImagePreview } from '../ImagePreview'
import type { ContentBlock, ToolResultContent } from '@/lib/api/types'
import { toolRegistry } from '@/lib/agent/tool-registry'
import { ToolPanel } from '../tool-panel/ToolPanel'
import { ToolCard } from '../tool-panel/ToolCard'
import type { ToolCallRenderState } from '../tool-panel/types'
import { ThinkingChip, ProcessGroupPanel, type ProcessStep } from '../stream'
import type { ToolCallState, ToolCallStatus } from '@/lib/agent/types'
import { StreamingMarkdownContent } from './MarkdownRenderer'
import { parseThinkTags, stripThinkTags } from '@/lib/chat/think-tag-parser'
import { parseStageTags } from '@/lib/chat/stage-tag-parser'

const MARKDOWN_WRAPPER_CLASS = 'break-words'

function resolveToolCallStatus(
  isStreaming: boolean | undefined,
  liveToolCall: ToolCallState | undefined,
  result?: { isError?: boolean }
): ToolCallStatus | 'completed' {
  if (result) return result.isError ? 'error' : 'completed'
  if (liveToolCall?.status) return liveToolCall.status
  if (!result && isStreaming) return 'streaming'
  return 'completed'
}

export type { ToolCallRenderState } from '../tool-panel/types'

function buildToolCallRenderState(
  block: Extract<ContentBlock, { type: 'tool_use' }>,
  options: {
    isStreaming?: boolean
    toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
    liveToolCallMap?: Map<string, ToolCallState> | null
  }
): ToolCallRenderState {
  const result = options.toolResults?.get(block.id)
  const liveToolCall = options.liveToolCallMap?.get(block.id)
  const liveInput = liveToolCall?.input
  const effectiveInput = liveInput && Object.keys(liveInput).length > 0 ? liveInput : block.input
  return {
    id: block.id,
    toolUseId: block.id,
    name: block.name,
    input: effectiveInput,
    output: result?.content ?? liveToolCall?.output,
    status: resolveToolCallStatus(options.isStreaming, liveToolCall, result),
    error: liveToolCall?.error,
    startedAt: liveToolCall?.startedAt,
    completedAt: liveToolCall?.completedAt
  }
}

// Media path — Non-tool content blocks: generated images and error cards.

function renderMediaBlock(
  block: MediaBlock,
  key: string,
  liveScaleInClassName: string
): React.JSX.Element | null {
  if (block.type === 'image') {
    const imgSrc =
      block.source.type === 'base64' && block.source.data
        ? `data:${block.source.mediaType || 'image/png'};base64,${block.source.data}`
        : (block.source.url ?? '')
    if (!imgSrc && !block.source.filePath) return null
    return (
      <ScaleIn key={key} className={liveScaleInClassName}>
        <ImagePreview src={imgSrc} filePath={block.source.filePath} />
      </ScaleIn>
    )
  }
  if (block.type === 'image_error') {
    return (
      <ScaleIn key={key} className={liveScaleInClassName}>
        <ImageGenerationErrorCard code={block.code} message={block.message} />
      </ScaleIn>
    )
  }
  return (
    <ScaleIn key={key} className={liveScaleInClassName}>
      <AgentErrorCard
        code={block.code}
        message={block.message}
        errorType={block.errorType}
        details={block.details}
        stackTrace={block.stackTrace}
      />
    </ScaleIn>
  )
}

export interface AssistantContentRendererProps {
  content: string | ContentBlock[]
  normalizedContent: ContentBlock[] | null
  stringSegments: ReturnType<typeof parseThinkTags> | null
  isStreaming?: boolean
  isGeneratingImage?: boolean
  imageGenerationTiming?: { startedAt?: number; completedAt?: number }
  generatingImagePreview?: { source: { type: string; data?: string; mediaType?: string; url?: string; filePath?: string } } | null
  fadeInClassName: string
  liveScaleInClassName: string
  toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
  effectiveLiveToolCallMap: Map<string, ToolCallState> | null
  hasStructuredThinkingBlocks: boolean
  lastStructuredTextIdx: number
  isLastAssistantMessage?: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

type MediaBlock = Extract<ContentBlock, { type: 'image' | 'image_error' | 'agent_error' }>

type RenderUnit =
  | { kind: 'thinking'; text: string; isStreaming: boolean; startedAt?: number; completedAt?: number; key: string }
  | { kind: 'text'; text: string; isStreaming: boolean; key: string }
  | { kind: 'stage'; title: string; key: string }
  | { kind: 'tool'; state: ToolCallRenderState; isCard: boolean; key: string }
  | { kind: 'media'; index: number; key: string }

type GroupedUnit = RenderUnit | {
  kind: 'group'
  steps: ProcessStep[]
  isActive: boolean
  title: string
  key: string
}

const GROUP_ACTIVE_STATUSES: ReadonlySet<ToolCallStatus | 'completed'> = new Set([
  'streaming',
  'running',
])

function isProcessUnit(
  unit: RenderUnit
): unit is Extract<RenderUnit, { kind: 'thinking' | 'tool' }> {
  if (unit.kind === 'thinking') return true
  if (unit.kind === 'tool') return !unit.isCard
  return false
}

function toProcessStep(unit: Extract<RenderUnit, { kind: 'thinking' | 'tool' }>): ProcessStep {
  if (unit.kind === 'thinking') {
    return {
      kind: 'thinking',
      key: unit.key,
      text: unit.text,
      isStreaming: unit.isStreaming,
      startedAt: unit.startedAt,
      completedAt: unit.completedAt,
    }
  }
  return { kind: 'tool', key: unit.key, state: unit.state }
}

function stepIsActive(step: ProcessStep): boolean {
  return step.kind === 'thinking'
    ? step.isStreaming && !step.completedAt
    : GROUP_ACTIVE_STATUSES.has(step.state.status)
}

/**
 * Group thinking/tool units ONLY behind an explicit `<stage>` declaration. A
 * `stage` unit opens a group titled with the agent's declared title (streams in
 * first); subsequent thinking/tool units attach until the next `stage` or end.
 * Without a stage declaration, thinking/tool units are NEVER merged — each
 * renders standalone (ThinkingChip / ToolPanel).
 */
function groupRenderUnits(units: RenderUnit[], isStreaming: boolean): GroupedUnit[] {
  const result: GroupedUnit[] = []
  let currentSteps: Extract<RenderUnit, { kind: 'thinking' | 'tool' }>[] = []
  let currentTitle = ''
  let currentKey = ''
  let hasStage = false

  const flush = (isTrailing: boolean): void => {
    if (!hasStage) {
      currentSteps = []
      currentTitle = ''
      currentKey = ''
      return
    }
    const steps = currentSteps.map(toProcessStep)
    const groupActive = steps.some(stepIsActive)
    const isActive = groupActive || (isStreaming && isTrailing)
    // A stage with no body that is not actively streaming is a title-only
    // remnant — drop it rather than render an empty panel.
    if (steps.length === 0 && !isActive) {
      currentSteps = []
      currentTitle = ''
      currentKey = ''
      hasStage = false
      return
    }
    result.push({
      kind: 'group',
      steps,
      isActive,
      title: currentTitle,
      key: currentKey
    })
    currentSteps = []
    currentTitle = ''
    currentKey = ''
    hasStage = false
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]
    const isTrailing = i === units.length - 1
    if (unit.kind === 'stage') {
      flush(false)
      currentTitle = unit.title
      currentKey = `group-${unit.key}`
      hasStage = true
      if (isTrailing) flush(true)
      continue
    }
    if (isProcessUnit(unit)) {
      if (hasStage) {
        currentSteps.push(unit)
        if (isTrailing) flush(true)
      } else {
        // No stage declared — render standalone, never merge.
        result.push(unit)
      }
      continue
    }
    flush(false)
    result.push(unit)
  }

  return result
}

interface LinearizeOptions {
  isStreaming?: boolean
  hasStructuredThinkingBlocks: boolean
  lastStructuredTextIdx: number
  toolResults?: Map<string, { content: ToolResultContent; isError?: boolean }>
  effectiveLiveToolCallMap: Map<string, ToolCallState> | null
}

function buildRenderUnits(
  normalizedContent: ContentBlock[],
  opts: LinearizeOptions
): RenderUnit[] {
  const units: RenderUnit[] = []
  for (let i = 0; i < normalizedContent.length; i++) {
    const block = normalizedContent[i]
    switch (block.type) {
      case 'thinking': {
        const text = block.thinking
        if (!text.trim() && !block.startedAt && !block.completedAt) break
        units.push({
          kind: 'thinking',
          text,
          isStreaming: !!opts.isStreaming,
          startedAt: block.startedAt,
          completedAt: block.completedAt,
          key: `think-${i}`
        })
        break
      }
      case 'text': {
        const isBlockStreaming = !!(opts.isStreaming && i === opts.lastStructuredTextIdx)
        const stageSegments = parseStageTags(block.text)
        stageSegments.forEach((seg, j) => {
          const isLastStageSeg = j === stageSegments.length - 1
          if (seg.type === 'stage') {
            units.push({
              kind: 'stage',
              title: seg.content,
              key: `stage-${i}-${j}`
            })
            return
          }
          if (opts.hasStructuredThinkingBlocks) {
            const visible = stripThinkTags(seg.content)
            if (!visible.trim()) return
            units.push({
              kind: 'text',
              text: visible,
              isStreaming: isBlockStreaming && isLastStageSeg,
              key: `text-${i}-${j}`
            })
            return
          }
          const thinkSegs = parseThinkTags(seg.content)
          const hasThink = thinkSegs.some((s) => s.type === 'think')
          if (!hasThink) {
            if (!seg.content.trim()) return
            units.push({
              kind: 'text',
              text: seg.content,
              isStreaming: isBlockStreaming && isLastStageSeg,
              key: `text-${i}-${j}`
            })
            return
          }
          const lastTxtSeg = thinkSegs.reduce((acc: number, s, k) => (s.type === 'text' ? k : acc), -1)
          thinkSegs.forEach((s, k) => {
            if (s.type === 'think') {
              units.push({
                kind: 'thinking',
                text: s.content,
                isStreaming: isBlockStreaming && !s.closed,
                key: `think-${i}-${j}-${k}`
              })
            } else {
              units.push({
                kind: 'text',
                text: s.content,
                isStreaming: isBlockStreaming && isLastStageSeg && k === lastTxtSeg,
                key: `text-${i}-${j}-${k}`
              })
            }
          })
        })
        break
      }
      case 'tool_use': {
        const renderKind = toolRegistry.get(block.name)?.render?.kind
        const isCard = renderKind === 'native-card'
        const state = buildToolCallRenderState(block, {
          isStreaming: opts.isStreaming,
          toolResults: opts.toolResults,
          liveToolCallMap: opts.effectiveLiveToolCallMap
        })
        units.push({ kind: 'tool', state, isCard, key: isCard ? `card-${block.id}` : `call-${block.id}` })
        break
      }
      case 'image':
      case 'image_error':
      case 'agent_error':
        units.push({ kind: 'media', index: i, key: `media-${i}` })
        break
      default:
        break
    }
  }
  return units
}

export function renderAssistantContent(props: AssistantContentRendererProps): React.JSX.Element {
  const {
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
  } = props

  const shouldShowImageGeneratingLoader = isGeneratingImage && isStreaming
  const hasEmptyContent =
    (typeof content === 'string' && content.length === 0) ||
    (Array.isArray(normalizedContent) && normalizedContent.length === 0)
  const generatingImagePreviewSrc =
    generatingImagePreview?.source.type === 'base64' && generatingImagePreview.source.data
      ? `data:${generatingImagePreview.source.mediaType || 'image/png'};base64,${generatingImagePreview.source.data}`
      : (generatingImagePreview?.source.url ?? '')

  if (shouldShowImageGeneratingLoader && hasEmptyContent) {
    return (
      <div className={fadeInClassName || undefined}>
        <ImageGeneratingLoader
          previewSrc={generatingImagePreviewSrc || undefined}
          previewFilePath={generatingImagePreview?.source.filePath}
          startedAt={imageGenerationTiming?.startedAt}
        />
      </div>
    )
  }

  if (generatingImagePreviewSrc && hasEmptyContent) {
    return (
      <div className={fadeInClassName || undefined}>
        <ImagePreview
          src={generatingImagePreviewSrc}
          filePath={generatingImagePreview?.source.filePath}
        />
      </div>
    )
  }

  // Show thinking indicator when streaming starts with no displayable content yet.
  if (isStreaming && hasEmptyContent) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="text-xs text-muted-foreground/60">{t('thinking.thinkingEllipsis')}</span>
      </div>
    )
  }

  if (hasEmptyContent) {
    return <></>
  }

  if (typeof content === 'string') {
    const segments = stringSegments ?? []
    const hasThink = segments.some((s) => s.type === 'think')

    if (!hasThink) {
      return (
        <div className={MARKDOWN_WRAPPER_CLASS}>
          <StreamingMarkdownContent text={content} isStreaming={!!isStreaming} />
        </div>
      )
    }

    const lastTextSegIdx = segments.reduce(
      (acc: number, s, idx) => (s.type === 'text' ? idx : acc),
      -1
    )
    return (
      <div className="space-y-3">
        {segments.map((seg, idx) => {
          if (seg.type === 'think') {
            return (
              <ThinkingChip
                key={`${idx}-${seg.closed ? 'settled' : 'active'}`}
                thinking={seg.content}
                isStreaming={!!isStreaming && !seg.closed}
              />
            )
          }
          return (
            <div key={idx} className={MARKDOWN_WRAPPER_CLASS}>
              <StreamingMarkdownContent
                text={seg.content}
                isStreaming={!!isStreaming && idx === lastTextSegIdx}
              />
            </div>
          )
        })}
      </div>
    )
  }

  if (!normalizedContent) {
    return <div className={MARKDOWN_WRAPPER_CLASS} />
  }

  const units = buildRenderUnits(normalizedContent, {
    isStreaming,
    hasStructuredThinkingBlocks,
    lastStructuredTextIdx,
    toolResults,
    effectiveLiveToolCallMap
  })
  const grouped = groupRenderUnits(units, !!isStreaming)

  return (
    <div className="space-y-3">
      {grouped.map((unit) => {
        switch (unit.kind) {
          case 'group':
            return (
              <ScaleIn key={unit.key} className={liveScaleInClassName}>
                <ProcessGroupPanel
                  steps={unit.steps}
                  isActive={unit.isActive}
                  title={unit.title}
                />
              </ScaleIn>
            )
          case 'thinking':
            return (
              <ThinkingChip
                key={unit.key}
                thinking={unit.text}
                isStreaming={unit.isStreaming}
                startedAt={unit.startedAt}
                completedAt={unit.completedAt}
              />
            )
          case 'text':
            return (
              <div key={unit.key} className={MARKDOWN_WRAPPER_CLASS}>
                <StreamingMarkdownContent text={unit.text} isStreaming={unit.isStreaming} />
              </div>
            )
          case 'tool': {
            if (unit.isCard) {
              return (
                <ScaleIn key={unit.key} className={liveScaleInClassName}>
                  <ToolCard
                    toolUseId={unit.state.toolUseId}
                    name={unit.state.name}
                    input={unit.state.input}
                    output={unit.state.output}
                    status={unit.state.status}
                    error={unit.state.error}
                    startedAt={unit.state.startedAt}
                    completedAt={unit.state.completedAt}
                  />
                </ScaleIn>
              )
            }
            return (
              <ScaleIn key={unit.key} className={liveScaleInClassName}>
                <ToolPanel
                  toolUseId={unit.state.toolUseId}
                  name={unit.state.name}
                  input={unit.state.input}
                  output={unit.state.output}
                  status={unit.state.status}
                  error={unit.state.error}
                  startedAt={unit.state.startedAt}
                  completedAt={unit.state.completedAt}
                />
              </ScaleIn>
            )
          }
          case 'media': {
            const block = normalizedContent[unit.index] as MediaBlock
            return renderMediaBlock(block, unit.key, liveScaleInClassName)
          }
          default:
            return null
        }
      })}
      {shouldShowImageGeneratingLoader && (
        <div className={`pt-3${fadeInClassName ? ` ${fadeInClassName}` : ''}`}>
          <ImageGeneratingLoader
            previewSrc={generatingImagePreviewSrc || undefined}
            previewFilePath={generatingImagePreview?.source.filePath}
            startedAt={imageGenerationTiming?.startedAt}
          />
        </div>
      )}
    </div>
  )
}
