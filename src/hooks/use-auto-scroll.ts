import * as React from 'react'
import type { AutoScrollMode } from '@/components/chat/message-list/types'
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD,
  STREAMING_AUTO_SCROLL_BOTTOM_THRESHOLD,
  STREAMING_AUTO_SCROLL_STOP_THRESHOLD,
  PROGRAMMATIC_SCROLL_GUARD_MS,
  STREAMING_AUTO_SCROLL_POLL_MS,
  FOLLOW_BOTTOM_SETTLE_FRAMES,
  BOTTOM_SCROLL_CORRECTION_EPSILON
} from '@/components/chat/message-list/constants'

export function getDistanceToBottom(ref: HTMLDivElement): number {
  return Math.max(0, ref.scrollHeight - ref.scrollTop - ref.clientHeight)
}

export interface AutoScrollState {
  autoScrollModeRef: React.MutableRefObject<AutoScrollMode>
  programmaticScrollUntilRef: React.MutableRefObject<number>
  lastScrollOffsetRef: React.MutableRefObject<number>
}

export function createAutoScrollState(): AutoScrollState {
  return {
    autoScrollModeRef: { current: 'off' },
    programmaticScrollUntilRef: { current: 0 },
    lastScrollOffsetRef: { current: 0 }
  }
}

export function useAutoScrollActions({
  listRef,
  rowsLength,
  isTaskOutputting,
  canTaskTriggerStreamingAutoScroll,
  autoScrollModeRef,
  programmaticScrollUntilRef,
  lastScrollOffsetRef,
  setIsAtBottom
}: {
  listRef: React.RefObject<HTMLDivElement | null>
  rowsLength: number
  isTaskOutputting: boolean
  canTaskTriggerStreamingAutoScroll: boolean
  autoScrollModeRef: React.MutableRefObject<AutoScrollMode>
  programmaticScrollUntilRef: React.MutableRefObject<number>
  lastScrollOffsetRef: React.MutableRefObject<number>
  setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
}): {
  canAutoScroll: () => boolean
  markProgrammaticScroll: () => void
  scrollToBottomImmediate: (behavior?: ScrollBehavior) => void
  syncBottomState: () => void
} {
  const canAutoScroll = React.useCallback(() => {
    const mode = autoScrollModeRef.current
    return mode === 'user' || (mode === 'stream' && canTaskTriggerStreamingAutoScroll)
  }, [autoScrollModeRef, canTaskTriggerStreamingAutoScroll])

  const markProgrammaticScroll = React.useCallback(() => {
    programmaticScrollUntilRef.current = window.performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS
  }, [programmaticScrollUntilRef])

  const scrollToBottomImmediate = React.useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const ref = listRef.current
      if (!ref || rowsLength === 0) return
      markProgrammaticScroll()
      ref.scrollTo({ top: ref.scrollHeight, behavior })
    },
    [listRef, markProgrammaticScroll, rowsLength]
  )

  const syncBottomState = React.useCallback(() => {
    const ref = listRef.current
    if (!ref) return

    const distanceToBottom = getDistanceToBottom(ref)
    const threshold = isTaskOutputting
      ? STREAMING_AUTO_SCROLL_BOTTOM_THRESHOLD
      : AUTO_SCROLL_BOTTOM_THRESHOLD
    const nextAtBottom = distanceToBottom <= threshold
    const previousOffset = lastScrollOffsetRef.current
    const currentOffset = ref.scrollTop
    const scrolledUp = currentOffset < previousOffset - BOTTOM_SCROLL_CORRECTION_EPSILON
    const isProgrammaticScroll = window.performance.now() < programmaticScrollUntilRef.current

    lastScrollOffsetRef.current = currentOffset

    if (
      scrolledUp &&
      distanceToBottom > STREAMING_AUTO_SCROLL_STOP_THRESHOLD &&
      !isProgrammaticScroll
    ) {
      autoScrollModeRef.current = 'off'
    } else if (nextAtBottom && isTaskOutputting && autoScrollModeRef.current === 'off') {
      autoScrollModeRef.current = 'stream'
    }

    setIsAtBottom((prev) => (prev === nextAtBottom ? prev : nextAtBottom))
  }, [autoScrollModeRef, isTaskOutputting, lastScrollOffsetRef, listRef, programmaticScrollUntilRef, setIsAtBottom])

  return { canAutoScroll, markProgrammaticScroll, scrollToBottomImmediate, syncBottomState }
}

export function useStreamingAutoScrollPoll({
  canTaskTriggerStreamingAutoScroll,
  pendingAskUserQuestion,
  canAutoScroll,
  requestScrollToBottom
}: {
  canTaskTriggerStreamingAutoScroll: boolean
  pendingAskUserQuestion: { assistantMessageId: string; toolUseId: string } | null
  canAutoScroll: () => boolean
  requestScrollToBottom: (options?: { behavior?: ScrollBehavior; force?: boolean; maxFrames?: number }) => void
}): void {
  React.useEffect(() => {
    if (!canTaskTriggerStreamingAutoScroll) return
    if (pendingAskUserQuestion) return

    const intervalId = window.setInterval(() => {
      if (!canAutoScroll()) return
      requestScrollToBottom({ maxFrames: FOLLOW_BOTTOM_SETTLE_FRAMES })
    }, STREAMING_AUTO_SCROLL_POLL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [canAutoScroll, canTaskTriggerStreamingAutoScroll, pendingAskUserQuestion, requestScrollToBottom])
}
