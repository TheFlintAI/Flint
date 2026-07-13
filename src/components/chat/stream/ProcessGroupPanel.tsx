import { memo, useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, Brain, Workflow } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { toolRegistry } from '@/lib/agent/tool-registry'
import type { NativePanelRender } from '@/lib/tools/tool-render-types'
import { usePanelContext } from '../tool-panel/use-panel-context'
import { TrailingStatus } from '../tool-panel/TrailingStatus'
import { ToolShell } from '../tool-panel/ToolShell'
import type { ToolCallRenderState } from '../tool-panel/types'
import type { ToolCallStatus } from '@/lib/agent/types'
import { ThinkingContent } from './ThinkingContent'

// --- Step model ---

export type ProcessStep =
  | {
      kind: 'thinking'
      key: string
      text: string
      isStreaming: boolean
      startedAt?: number
      completedAt?: number
    }
  | { kind: 'tool'; key: string; state: ToolCallRenderState }

const ACTIVE_STATUSES: ReadonlySet<ToolCallStatus | 'completed'> = new Set([
  'streaming',
  'running',
])

function isToolActive(status: ToolCallStatus | 'completed'): boolean {
  return ACTIVE_STATUSES.has(status)
}

// --- Activity indicator (three breathing dots) ---

function ActivityDots(): React.JSX.Element {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 rounded-full bg-primary/70 animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  )
}

// --- Rail dot color per step state ---

function stepDotClass(step: ProcessStep): string {
  if (step.kind === 'thinking') {
    const isThinking = step.isStreaming && !step.completedAt
    return isThinking ? 'bg-sky-500 animate-pulse' : 'bg-emerald-500'
  }
  const status = step.state.status
  if (status === 'error') return 'bg-destructive'
  if (isToolActive(status)) return 'bg-sky-500 animate-pulse'
  if (status === 'canceled') return 'bg-muted-foreground/40'
  return 'bg-emerald-500'
}

// --- Thinking step ---

function ThinkingStepRow({
  step,
}: {
  step: Extract<ProcessStep, { kind: 'thinking' }>
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isThinking = step.isStreaming && !step.completedAt
  const [open, setOpen] = useState(false)
  const prevRef = useRef(isThinking)

  useEffect(() => {
    if (prevRef.current && !isThinking && open) {
      const timer = setTimeout(() => setOpen(false), 800)
      prevRef.current = isThinking
      return () => clearTimeout(timer)
    }
    prevRef.current = isThinking
  }, [isThinking, open])

  const durationLabel = isThinking
    ? t('thinking.thinkingEllipsis')
    : t('thinking.thoughts')

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger
        className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50"
      >
        <Brain className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className={cn(
          "font-medium text-muted-foreground/80 transition-colors group-hover:text-foreground",
          isThinking && "shimmer"
        )}>
          {durationLabel}
        </span>
        <span className="ml-auto">
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-1.5 pb-2 pt-1 text-sm text-muted-foreground/80 leading-relaxed">
          <ThinkingContent
            thinking={step.text}
            isStreaming={step.isStreaming}
            startedAt={step.startedAt}
            completedAt={step.completedAt}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// --- Tool step (panel variant) ---

function PanelToolStep({
  ctx,
  render,
}: {
  ctx: ReturnType<typeof usePanelContext>
  render: NativePanelRender
}): React.JSX.Element {
  const isProcessing = ctx.status === 'streaming' || ctx.status === 'running'
  const isActive = isProcessing

  return (
    <ToolShell
      isActive={isActive}
      isProcessing={isProcessing}
      output={ctx.output}
      expandWhileActive={render.expandWhileActive}
      expandForImages={render.expandForImages}
      className="border-0 bg-transparent"
      triggerClassName="rounded-md px-2 py-1.5"
      bodyClassName="px-2 pb-2 pt-1"
      header={render.renderHeader(ctx)}
      body={render.renderBody(ctx)}
      trailing={(open) => (
        <TrailingStatus
          status={ctx.status}
          error={ctx.error}
          startedAt={ctx.startedAt}
          completedAt={ctx.completedAt}
          open={open}
          toolName={ctx.name}
        />
      )}
    />
  )
}

// --- Default remote-tool render ---

function defaultToolRender(ctx: ReturnType<typeof usePanelContext>): NativePanelRender {
  return {
    kind: 'native-panel',
    renderHeader: () => <span className="font-medium">{ctx.displayName}</span>,
    renderBody: () => (
      <span className="text-[11px] text-muted-foreground">{ctx.outputText || ''}</span>
    ),
  }
}

// --- Tool step (dispatches inline vs panel) ---

function ToolStepRow({ state }: { state: ToolCallRenderState }): React.JSX.Element | null {
  const ctx = usePanelContext(state)
  const handler = toolRegistry.get(state.name)
  if (!handler) return null
  const { render } = handler
  if (render.kind === 'native-inline') {
    return <div className="py-1">{render.render(ctx)}</div>
  }
  if (render.kind === 'native-panel') {
    return <PanelToolStep ctx={ctx} render={render} />
  }
  if (render.kind === 'native-card') {
    // Cards render standalone, not inside process groups
    return <div className="py-1">{render.render(ctx)}</div>
  }
  // Remote tools: render with a basic shell
  return <PanelToolStep ctx={ctx} render={defaultToolRender(ctx)} />
}

// --- Timeline rail + steps ---

function StepTimeline({ steps }: { steps: ProcessStep[] }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const isFirst = i === 0
        const isLast = i === steps.length - 1
        return (
          <div key={step.key} className="flex gap-2.5">
            <div className="relative w-2 shrink-0">
              {!isFirst ? (
                <span className="absolute left-1/2 top-0 h-[13px] w-px -translate-x-1/2 bg-border/30" />
              ) : null}
              {!isLast ? (
                <span className="absolute left-1/2 top-[13px] bottom-0 w-px -translate-x-1/2 bg-border/30" />
              ) : null}
              <span
                className={cn(
                  'absolute left-1/2 top-[13px] size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                  stepDotClass(step)
                )}
              />
            </div>
            <div className="min-w-0 flex-1 pb-2">
              {step.kind === 'thinking' ? (
                <ThinkingStepRow step={step} />
              ) : (
                <ToolStepRow state={step.state} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Group panel ---

export interface ProcessGroupPanelProps {
  steps: ProcessStep[]
  isActive: boolean
  /** Stage title declared up-front by the agent via `<stage>...</stage>`. */
  title: string
}

export const ProcessGroupPanel = memo(function ProcessGroupPanel({
  steps,
  isActive,
  title,
}: ProcessGroupPanelProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const prevActiveRef = useRef(isActive)

  useEffect(() => {
    if (prevActiveRef.current && !isActive && open) {
      const timer = setTimeout(() => setOpen(false), 800)
      prevActiveRef.current = isActive
      return () => clearTimeout(timer)
    }
    prevActiveRef.current = isActive
  }, [isActive, open])

  const earliestStart = useMemo(() => {
    let min: number | undefined
    for (const s of steps) {
      const start = s.kind === 'thinking' ? s.startedAt : s.state.startedAt
      if (start != null && (min === undefined || start < min)) min = start
    }
    return min
  }, [steps])

  const latestCompleted = useMemo(() => {
    let max: number | undefined
    for (const s of steps) {
      const end = s.kind === 'thinking' ? s.completedAt : s.state.completedAt
      if (end != null && (max === undefined || end > max)) max = end
    }
    return max
  }, [steps])

  const [liveElapsed, setLiveElapsed] = useState(0)
  useEffect(() => {
    if (!isActive || earliestStart === undefined) return
    const tick = (): void => setLiveElapsed((Date.now() - earliestStart) / 1000)
    tick()
    const interval = setInterval(tick, 100)
    return () => clearInterval(interval)
  }, [isActive, earliestStart])

  const hasThinking = steps.some((s) => s.kind === 'thinking')
  const hasTool = steps.some((s) => s.kind === 'tool')
  const fallbackKey = hasThinking && hasTool
    ? 'processGroup.thinkingAndTools'
    : hasTool
      ? 'processGroup.toolsOnly'
      : 'processGroup.thinkingOnly'
  // The agent's declared title is shown as-is. While it streams in with no
  // characters yet, show the processing label. A declared-but-empty title on a
  // settled panel falls back to a content-based label.
  const displayTitle = title.trim()
    ? title
    : isActive
      ? t('processGroup.processing')
      : t(fallbackKey)

  const totalDuration =
    earliestStart !== undefined && latestCompleted !== undefined
      ? (latestCompleted - earliestStart) / 1000
      : null
  const elapsedLabel = isActive
    ? liveElapsed > 0
      ? t('thinking.secondsShort', { seconds: liveElapsed.toFixed(1) })
      : ''
    : totalDuration !== null
      ? t('thinking.secondsShort', { seconds: totalDuration.toFixed(1) })
      : ''

  const countLabel = isActive
    ? t('processGroup.activeSteps', { count: steps.length })
    : t('processGroup.steps', { count: steps.length })

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='rounded-lg border border-border/40 bg-transparent overflow-hidden'
    >
      <CollapsibleTrigger
        className="group flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Workflow className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span className={cn(
            "truncate font-medium text-muted-foreground/80 transition-colors group-hover:text-foreground",
            isActive && "shimmer"
          )}>
            {displayTitle}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {isActive ? <ActivityDots /> : null}
          <span className="text-[10px] tabular-nums text-muted-foreground/60">{countLabel}</span>
          {elapsedLabel ? (
            <span className="text-[10px] tabular-nums text-muted-foreground/60">{elapsedLabel}</span>
          ) : null}
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 py-2.5">
          <StepTimeline steps={steps} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

ProcessGroupPanel.displayName = 'ProcessGroupPanel'
