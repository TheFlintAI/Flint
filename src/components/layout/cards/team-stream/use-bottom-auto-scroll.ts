import { useEffect, useRef } from 'react'

// Keeps a scroll container pinned to the bottom while its content grows
// (streaming teammate output), but stops auto-scrolling once the user scrolls
// up to read — mirroring the task panel's streaming-output behavior at card
// scale. Re-pins to the bottom when the user scrolls back near the end.
export function useBottomAutoScroll(contentKey: string): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  // Track whether the user is near the bottom; only stick while they are.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = distance < 28
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Jump to the bottom when content changes, as long as we're sticking.
  useEffect(() => {
    const el = ref.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [contentKey])

  return ref
}
