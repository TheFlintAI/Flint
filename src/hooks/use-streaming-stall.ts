import { useEffect, useRef, useState } from 'react'

const DEFAULT_STALL_MS = 1000

/**
 * Detects whether a stream has stalled: no new fragment (text length change)
 * has arrived within {@link stallMs}. Returns true once the window elapses,
 * resets to false immediately on the next fragment or when streaming ends.
 */
export function useStreamingStall(
  text: string,
  isStreaming: boolean,
  stallMs: number = DEFAULT_STALL_MS
): boolean {
  const [stalled, setStalled] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isStreaming) {
      setStalled(false)
      return
    }
    // Fragment arrived (or streaming just started): hide and restart the stall window
    setStalled(false)
    timerRef.current = setTimeout(() => {
      setStalled(true)
    }, stallMs)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [text.length, isStreaming, stallMs])

  return stalled
}
