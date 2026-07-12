import * as React from 'react'
import { motion, useAnimationControls } from 'motion/react'
import { consumeUserMessageFlyInOrigin } from './user-message-fly-in'

interface UserMessageEntranceProps {
  taskId?: string | null
  isLastUserMessage?: boolean
  disableAnimation?: boolean
  children: React.ReactNode
}

// Entrance animation for user messages. The latest user message flies in from
// the composer's position captured at send time; older non-tail user messages
// fade up like the default SlideIn; tail messages with animation disabled
// appear instantly. Decisions are made once on mount so a message never
// re-animates when it later stops being the last user message.
const FALLBACK_TRANSITION = { type: 'spring', stiffness: 400, damping: 30 } as const
const FLY_IN_TRANSITION = { type: 'spring', stiffness: 300, damping: 32 } as const

export function UserMessageEntrance({
  taskId,
  isLastUserMessage = false,
  disableAnimation = false,
  children
}: UserMessageEntranceProps): React.JSX.Element {
  const controls = useAnimationControls()
  const wrapRef = React.useRef<HTMLDivElement | null>(null)
  const isLastRef = React.useRef(isLastUserMessage)
  isLastRef.current = isLastUserMessage
  const disabledRef = React.useRef(disableAnimation)
  disabledRef.current = disableAnimation

  React.useLayoutEffect(() => {
    const wrap = wrapRef.current

    const showInstant = (): void => {
      controls.set({ opacity: 1, y: 0 })
    }
    const playFade = (): void => {
      controls.start({ opacity: 1, y: 0, transition: FALLBACK_TRANSITION })
    }

    if (!wrap) {
      showInstant()
      return
    }

    if (isLastRef.current) {
      const origin = consumeUserMessageFlyInOrigin(taskId)
      if (origin) {
        const scroller = wrap.closest('[data-message-content]') as HTMLElement | null
        if (scroller) {
          const wrapRect = wrap.getBoundingClientRect()
          const scrollerRect = scroller.getBoundingClientRect()
          // The list auto-scrolls to the bottom on send; compute the bubble's
          // resting viewport top from the deterministic bottom scroll offset.
          const scrollTopFinal = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          const bubbleContentTop = wrapRect.top - scrollerRect.top + scroller.scrollTop
          const targetTop = bubbleContentTop - scrollTopFinal

          const dx = origin.left - wrapRect.left
          const dy = origin.top - targetTop

          controls.set({ x: dx, y: dy, opacity: 0 })
          controls.start({ x: 0, y: 0, opacity: 1, transition: FLY_IN_TRANSITION })
          return
        }
      }
    }

    if (disabledRef.current) {
      showInstant()
    } else {
      playFade()
    }
  }, [controls, taskId])

  return (
    <motion.div
      ref={wrapRef}
      animate={controls}
      initial={{ opacity: 0, y: 10 }}
      className="group/ts relative"
    >
      {children}
    </motion.div>
  )
}
