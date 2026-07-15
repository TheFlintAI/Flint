import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Minimize2, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useManualCompression } from '@/hooks/use-manual-compression'
import { useMessageScroller } from '@/components/ui/message-scroller'
import { useProviderStore } from '@/stores/provider-store'
import type { TokenUsage } from '@/lib/api/types'
import { formatTokens } from '@/lib/utils/format-tokens'

interface CompressButtonProps {
  usage?: TokenUsage
  taskId?: string | null
}

/** Resolve the effective context length, preferring usage data, falling back to model config. */
function resolveContextLength(
  usage: TokenUsage | undefined
): number | null {
  if (usage?.contextLength && usage.contextLength > 0) {
    return usage.contextLength
  }
  // Fallback to active model config
  const modelConfig = useProviderStore.getState().getActiveModelConfig()
  if (modelConfig?.contextLength && modelConfig.contextLength > 0) {
    return modelConfig.contextLength
  }
  return null
}

/** Resolve current context token usage. */
function resolveContextTokens(usage: TokenUsage | undefined): number | null {
  if (usage?.contextTokens && usage.contextTokens > 0) {
    return usage.contextTokens
  }
  if (usage?.inputTokens && usage.inputTokens > 0) {
    return usage.inputTokens
  }
  return null
}

const RING_RADIUS = 13
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const SVG_SIZE = 28

export function CompressButton({ usage, taskId }: CompressButtonProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const manualCompress = useManualCompression()
  const [compressing, setCompressing] = useState(false)
  const { scrollToEnd } = useMessageScroller()

  const contextLength = resolveContextLength(usage)
  const contextTokens = resolveContextTokens(usage)

  const ratio = useMemo(() => {
    if (!contextLength || !contextTokens || contextLength <= 0) return null
    return Math.min(1, Math.max(0, contextTokens / contextLength))
  }, [contextLength, contextTokens])

  const dashOffset = useMemo(() => {
    if (ratio === null) return RING_CIRCUMFERENCE
    return RING_CIRCUMFERENCE * (1 - ratio)
  }, [ratio])

  const ringColor = useMemo(() => {
    if (ratio === null) return 'var(--muted-foreground)'
    if (ratio < 0.5) return 'var(--success, #22c55e)'
    if (ratio < 0.8) return 'var(--warning, #f59e0b)'
    return 'var(--destructive, #ef4444)'
  }, [ratio])

  const handleCompress = useCallback(async () => {
    if (compressing) return
    setCompressing(true)
    // Scroll to latest so the compression progress panel is visible
    scrollToEnd({ behavior: 'smooth' })
    try {
      await manualCompress()
    } finally {
      setCompressing(false)
    }
  }, [compressing, manualCompress, scrollToEnd])

  const tooltipContent = useMemo(() => {
    if (compressing) return t('compression.compressing', { defaultValue: 'Compressing...' })
    if (contextTokens && contextLength) {
      return t('compression.contextUsage', {
        defaultValue: 'Context: {{current}} / {{max}} tokens',
        current: formatTokens(contextTokens),
        max: formatTokens(contextLength)
      })
    }
    return t('compression.compressContext', { defaultValue: 'Compress context' })
  }, [compressing, contextTokens, contextLength, t])

  if (!taskId) return <></>

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('compression.compressContext', { defaultValue: 'Compress context' })}
          onClick={handleCompress}
          disabled={compressing}
          className="relative flex size-7 items-center justify-center rounded-full bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {/* SVG progress ring — same size as button so the ring sits exactly on the rounded edge */}
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            width={SVG_SIZE}
            height={SVG_SIZE}
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            style={{ transform: 'rotate(-90deg)' }}
          >
            {/* Background track */}
            <circle
              cx={SVG_SIZE / 2}
              cy={SVG_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--border)"
              strokeWidth={2}
              opacity={0.4}
            />
            {/* Progress arc */}
            {ratio !== null && (
              <circle
                cx={SVG_SIZE / 2}
                cy={SVG_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={ringColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
              />
            )}
          </svg>
          {/* Icon */}
          {compressing ? (
            <Loader2 className="relative z-10 size-3.5 animate-spin" />
          ) : (
            <Minimize2 className="relative z-10 size-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipContent}</TooltipContent>
    </Tooltip>
  )
}
