import { useEffect, useMemo, useRef, useState } from 'react'
import { recordStreamingRenderPoolFlush } from '@/lib/devtools/streaming-performance'

interface StreamingRenderPoolState {
  text: string
  poolSize: number
  renderedLength: number
  targetLength: number
}

interface RenderPoolConfig {
  fixedCharsPerSecond: number
  frameIntervalMs: number
  smallPoolChars: number
  mediumPoolChars: number
  largePoolChars: number
  maxStepChars: number
}

const RENDER_POOL_CONFIG: RenderPoolConfig = {
  fixedCharsPerSecond: 220,
  frameIntervalMs: 32,
  smallPoolChars: 120,
  mediumPoolChars: 720,
  largePoolChars: 2400,
  maxStepChars: 3600
}

function getCatchupStep(poolSize: number, elapsedMs: number, config: RenderPoolConfig): number {
  const fixedStep = Math.max(1, Math.ceil((config.fixedCharsPerSecond * elapsedMs) / 1000))

  if (poolSize <= config.smallPoolChars) {
    return Math.min(poolSize, fixedStep)
  }

  const catchupRatio =
    poolSize <= config.mediumPoolChars ? 0.14 : poolSize <= config.largePoolChars ? 0.2 : 0.28
  const catchupStep = Math.ceil(poolSize * catchupRatio)
  return Math.min(poolSize, Math.max(fixedStep, catchupStep), config.maxStepChars)
}

/**
 * Keeps live text in a render pool instead of rendering every upstream delta directly.
 *
 * Small pools drain at a stable typewriter speed. Larger pools drain in bigger chunks so a bursty
 * model response can catch up without forcing React/Markstream to re-render on every token.
 *
 * When {@link fullText} first transitions from empty to non-empty, the entire initial batch is
 * revealed immediately (jump-start), avoiding the user staring at a blank panel while the
 * typewriter catches up. Subsequent growth is throttled as usual.
 */
export function useStreamingRenderPool(
  fullText: string,
  isStreaming: boolean
): StreamingRenderPoolState {
  const config = RENDER_POOL_CONFIG
  const targetLengthRef = useRef(fullText.length)
  const renderedLengthRef = useRef(fullText.length)
  const committedLengthRef = useRef(fullText.length)
  const rafRef = useRef<number | null>(null)
  const lastFlushAtRef = useRef(0)
  const prevFullTextLenRef = useRef(fullText.length)
  const [renderedLength, setRenderedLength] = useState(fullText.length)

  useEffect(() => {
    targetLengthRef.current = fullText.length
  }, [fullText.length])

  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      renderedLengthRef.current = fullText.length
      prevFullTextLenRef.current = fullText.length
      return
    }

    if (renderedLengthRef.current > fullText.length) {
      renderedLengthRef.current = fullText.length
    }

    // Jump-start: when content first appears (empty → non-empty), reveal it all at once.
    // Subsequent deltas are throttled via the RAF loop below.
    if (prevFullTextLenRef.current === 0 && fullText.length > 0) {
      renderedLengthRef.current = fullText.length
      committedLengthRef.current = fullText.length
      setRenderedLength(fullText.length)
    }

    prevFullTextLenRef.current = fullText.length
  }, [fullText.length, isStreaming])

  useEffect(() => {
    if (!isStreaming) return

    lastFlushAtRef.current = 0

    const tick = (now: number): void => {
      const lastFlushAt = lastFlushAtRef.current
      const elapsedMs = lastFlushAt > 0 ? now - lastFlushAt : config.frameIntervalMs

      if (elapsedMs >= config.frameIntervalMs) {
        lastFlushAtRef.current = now
        const targetLength = targetLengthRef.current
        const currentLength = renderedLengthRef.current
        const poolSize = Math.max(0, targetLength - currentLength)

        if (poolSize > 0) {
          const measureStart = performance.now()
          const step = getCatchupStep(poolSize, elapsedMs, config)
          const nextLength = Math.min(targetLength, currentLength + step)

          renderedLengthRef.current = nextLength
          committedLengthRef.current = nextLength
          setRenderedLength(nextLength)
          recordStreamingRenderPoolFlush(performance.now() - measureStart, {
            poolSize,
            step,
            renderedLength: nextLength,
            targetLength
          })
        } else if (committedLengthRef.current !== currentLength) {
          committedLengthRef.current = currentLength
          setRenderedLength(currentLength)
        }
      }

      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [config, isStreaming])

  const safeRenderedLength = Math.min(renderedLength, fullText.length)
  const poolSize = Math.max(0, fullText.length - safeRenderedLength)
  const text = useMemo(() => {
    if (!isStreaming) return fullText
    return fullText.slice(0, safeRenderedLength)
  }, [fullText, isStreaming, safeRenderedLength])

  return {
    text,
    poolSize,
    renderedLength: safeRenderedLength,
    targetLength: fullText.length
  }
}

export function useTypewriter(fullText: string, isStreaming: boolean): string {
  return useStreamingRenderPool(fullText, isStreaming).text
}
