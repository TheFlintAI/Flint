import { memo } from 'react'
import { useStreamingRenderPool } from '@/hooks/use-typewriter'
import { MiniMarkdown } from './MiniMarkdown'
import { cn } from '@/lib/utils'

// The assistant's visible text deltas for a teammate. Plain flowing markdown —
// no background block, so it shares the same left edge as the other activity
// rows. Reuses the streaming render pool so rapid deltas don't re-parse
// markdown on every frame.
// `muted` dims the text for prose nested inside a <stage> section, where the
// stage label is the heading and the inner prose is subordinate detail.
// Top-level (ungrouped) text renders at full readable strength.
export const TextBlock = memo(function TextBlock({
  text,
  streaming,
  muted = false,
}: {
  text: string
  streaming: boolean
  muted?: boolean
}): React.JSX.Element | null {
  const pool = useStreamingRenderPool(text, streaming)
  const rendered = streaming ? pool.text : text

  if (!rendered.trim()) return null

  return (
    <div
      className={cn(
        'text-[11px] leading-relaxed',
        muted ? 'text-muted-foreground/70' : 'text-foreground/80'
      )}
    >
      <MiniMarkdown text={rendered} />
    </div>
  )
})

TextBlock.displayName = 'TextBlock'
