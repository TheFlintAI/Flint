import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDurationMs } from '@/lib/utils/format-duration'
import {
  buildImageDimensionCacheKey,
  cacheImageDimensions,
  getCachedImageDimensions,
  useImageDisplaySrc,
  type ImageDimensions
} from '@/hooks/use-image-display-src'

interface ImageGeneratingLoaderProps {
  previewSrc?: string
  previewFilePath?: string
  startedAt?: number
}

interface PlaceholderBarProps {
  widthClass: string
  delay?: number
}

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(color-mix(in srgb, var(--border) 56%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--border) 56%, transparent) 1px, transparent 1px)',
  backgroundSize: '24px 24px'
} satisfies CSSProperties

const CARD_STYLE = {
  borderColor: 'color-mix(in srgb, var(--border) 84%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--card) 97%, var(--background) 3%), color-mix(in srgb, var(--card) 88%, var(--muted) 12%))',
  boxShadow: '0 24px 64px color-mix(in srgb, var(--foreground) 14%, transparent)'
} satisfies CSSProperties

const CARD_SHEEN_STYLE = {
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--foreground) 4%, transparent), transparent 30%, color-mix(in srgb, var(--foreground) 8%, transparent))'
} satisfies CSSProperties

const PREVIEW_FRAME_STYLE = {
  borderColor: 'color-mix(in srgb, var(--border) 82%, transparent)',
  background: 'color-mix(in srgb, var(--muted) 58%, var(--background) 42%)'
} satisfies CSSProperties

const PREVIEW_FALLBACK_STYLE = {
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--foreground) 2%, transparent), color-mix(in srgb, var(--foreground) 7%, transparent))'
} satisfies CSSProperties

const PREVIEW_IMAGE_OVERLAY_STYLE = {
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--card) 16%, transparent), color-mix(in srgb, var(--card) 48%, transparent) 52%, color-mix(in srgb, var(--card) 86%, transparent))'
} satisfies CSSProperties

const SWEEP_STYLE = {
  background:
    'linear-gradient(90deg, transparent, color-mix(in srgb, var(--foreground) 4%, transparent) 20%, color-mix(in srgb, var(--secondary) 18%, transparent) 48%, color-mix(in srgb, var(--foreground) 9%, transparent) 54%, color-mix(in srgb, var(--foreground) 4%, transparent) 82%, transparent)'
} satisfies CSSProperties

const SCAN_LINE_STYLE = {
  backgroundColor: 'color-mix(in srgb, var(--secondary) 72%, var(--foreground) 28%)',
  boxShadow: '0 0 22px color-mix(in srgb, var(--secondary) 28%, transparent)'
} satisfies CSSProperties

const TOP_GLOW_STYLE = {
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--foreground) 5%, transparent), transparent)'
} satisfies CSSProperties

const BOTTOM_SHADE_STYLE = {
  background:
    'linear-gradient(180deg, transparent, color-mix(in srgb, var(--card) 70%, transparent) 72%, color-mix(in srgb, var(--card) 92%, transparent))'
} satisfies CSSProperties

const SHIMMER_BAR_STYLE = {
  backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)'
} satisfies CSSProperties

const SHIMMER_BAR_SWEEP_STYLE = {
  background:
    'linear-gradient(90deg, transparent, color-mix(in srgb, var(--foreground) 36%, transparent), transparent)'
} satisfies CSSProperties

const PROGRESS_TRACK_STYLE = {
  backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)'
} satisfies CSSProperties

const PROGRESS_FILL_STYLE = {
  background:
    'linear-gradient(90deg, color-mix(in srgb, var(--secondary) 28%, transparent), color-mix(in srgb, var(--secondary) 52%, transparent), transparent)'
} satisfies CSSProperties

const PROGRESS_SWEEP_STYLE = {
  background:
    'linear-gradient(90deg, transparent, color-mix(in srgb, var(--foreground) 48%, transparent), transparent)'
} satisfies CSSProperties

const SWEEP_TRANSITION = {
  duration: 2.8,
  repeat: Infinity,
  ease: 'linear' as const
}

const SHIMMER_TRANSITION = {
  duration: 1.9,
  repeat: Infinity,
  ease: 'linear' as const
}

function PlaceholderBar({ widthClass, delay = 0 }: PlaceholderBarProps): React.JSX.Element {
  return (
    <div
      className={`relative h-2.5 overflow-hidden rounded-full ${widthClass}`}
      style={SHIMMER_BAR_STYLE}
    >
      <motion.div
        className="absolute inset-y-0 left-[-38%] w-[38%]"
        style={SHIMMER_BAR_SWEEP_STYLE}
        animate={{ x: ['0%', '420%'] }}
        transition={{ ...SHIMMER_TRANSITION, delay }}
      />
    </div>
  )
}

export function ImageGeneratingLoader({
  previewSrc,
  previewFilePath,
  startedAt
}: ImageGeneratingLoaderProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const previewDisplaySrc = useImageDisplaySrc(previewSrc, previewFilePath)
  const previewCacheSrc = previewSrc || previewDisplaySrc
  const previewDimensionKey = previewCacheSrc
    ? buildImageDimensionCacheKey(previewCacheSrc, previewFilePath)
    : ''
  const cachedPreviewDimensions = previewCacheSrc
    ? getCachedImageDimensions(previewCacheSrc, previewFilePath, previewDisplaySrc)
    : null
  const [previewDimensionState, setPreviewDimensionState] = useState<{
    key: string
    dimensions: ImageDimensions | null
  }>(() => ({
    key: previewDimensionKey,
    dimensions: cachedPreviewDimensions
  }))
  const previewDimensions =
    previewDimensionState.key === previewDimensionKey
      ? (previewDimensionState.dimensions ?? cachedPreviewDimensions)
      : cachedPreviewDimensions
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return

    const interval = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(interval)
  }, [startedAt])
  const liveElapsedMs = startedAt ? Math.max(0, now - startedAt) : 0

  const elapsedLabel =
    startedAt && liveElapsedMs > 0
      ? t('toolCall.imagePlugin.elapsed', { duration: formatDurationMs(liveElapsedMs) })
      : null

  const handlePreviewLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (!previewCacheSrc) return

      const { naturalWidth, naturalHeight, currentSrc } = event.currentTarget
      if (!naturalWidth || !naturalHeight) return

      const nextDimensions = { width: naturalWidth, height: naturalHeight }
      setPreviewDimensionState((current) => {
        if (
          current.key === previewDimensionKey &&
          current.dimensions?.width === nextDimensions.width &&
          current.dimensions?.height === nextDimensions.height
        ) {
          return current
        }
        return {
          key: previewDimensionKey,
          dimensions: cacheImageDimensions(previewCacheSrc, nextDimensions, {
            filePath: previewFilePath,
            displaySrc: currentSrc
          })
        }
      })
    },
    [previewCacheSrc, previewDimensionKey, previewFilePath]
  )

  return (
    <motion.div
      layout
      role="status"
      aria-live="polite"
      className="w-full max-w-[560px]"
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <div className="relative overflow-hidden rounded-xl border p-5 sm:p-6" style={CARD_STYLE}>
        <div className="pointer-events-none absolute inset-0" style={CARD_SHEEN_STYLE} />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <motion.p
              className="max-w-[76%] text-base font-semibold text-foreground"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
            >
              {t('toolCall.imagePlugin.generating')}
            </motion.p>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <motion.span
                className="h-1.5 w-1.5 rounded-full bg-primary/80"
                animate={{ opacity: [0.38, 1, 0.38], scale: [0.88, 1.18, 0.88] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
              <span>{t('thinking.pending')}</span>
              {elapsedLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums text-white/60">{elapsedLabel}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background/60 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        </div>

        <div
          className="relative mt-5 overflow-hidden rounded-xl border"
          style={PREVIEW_FRAME_STYLE}
        >
          <div
            className="relative min-h-[320px]"
            style={{
              aspectRatio: previewDimensions
                ? `${previewDimensions.width} / ${previewDimensions.height}`
                : '4 / 3'
            }}
          >
            {previewDisplaySrc ? (
              <>
                <img
                  src={previewDisplaySrc}
                  alt="Generating image preview"
                  className="absolute inset-0 h-full w-full scale-[1.03] object-cover opacity-30"
                  onLoad={handlePreviewLoad}
                />
                <div className="absolute inset-0" style={PREVIEW_IMAGE_OVERLAY_STYLE} />
              </>
            ) : (
              <div className="absolute inset-0" style={PREVIEW_FALLBACK_STYLE} />
            )}

            <div className="absolute inset-0 opacity-55" style={GRID_STYLE} />

            <motion.div
              className="absolute inset-y-0 left-[-42%] w-[46%] -skew-x-12 blur-2xl"
              style={SWEEP_STYLE}
              animate={{ x: ['0%', '320%'] }}
              transition={SWEEP_TRANSITION}
            />

            <motion.div
              className="absolute inset-y-6 left-[-8%] w-px"
              style={SCAN_LINE_STYLE}
              animate={{
                x: ['0%', '620%'],
                opacity: [0, 1, 1, 0]
              }}
              transition={SWEEP_TRANSITION}
            />

            <div className="absolute inset-x-0 top-0 h-24" style={TOP_GLOW_STYLE} />
            <div className="absolute inset-x-0 bottom-0 h-40" style={BOTTOM_SHADE_STYLE} />

            <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
              <div className="space-y-3">
                <PlaceholderBar widthClass="w-[42%]" />
                <PlaceholderBar widthClass="w-[58%]" delay={0.12} />
                <PlaceholderBar widthClass="w-[34%]" delay={0.24} />
              </div>

              <div className="space-y-3">
                <div
                  className="relative h-1.5 overflow-hidden rounded-full"
                  style={PROGRESS_TRACK_STYLE}
                >
                  <motion.div
                    className="absolute inset-y-0 left-0 origin-left rounded-full"
                    style={{ ...PROGRESS_FILL_STYLE, width: '100%' }}
                    animate={{ scaleX: [0.2, 0.66, 0.4, 0.86, 0.52] }}
                    transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    className="absolute inset-y-0 left-[-28%] w-[28%] rounded-full"
                    style={PROGRESS_SWEEP_STYLE}
                    animate={{ x: ['0%', '450%'] }}
                    transition={{ duration: 2.25, repeat: Infinity, ease: 'linear' }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground/75">
                  <span>{t('thinking.pending')}</span>
                  <span>{t('toolCall.imagePlugin.generating')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
