import { memo, useMemo } from 'react'
import type { ToolCallState } from '@/lib/agent/types'
import { buildTimeline, type TimelineItem } from './timeline'
import { StageSection } from './StageSection'
import { ThinkBlock } from './ThinkBlock'
import { TextBlock } from './TextBlock'
import { ToolLogRow } from './ToolLogRow'
import { useBottomAutoScroll } from './use-bottom-auto-scroll'

// Renders one teammate's live activity as an arrival-ordered timeline, grouped
// under `<stage>` sections. Text/think units and tool calls are merged by the
// cursor each tool call captured when it started (see teammate-runner), so a
// stage label sits above the tool calls that happened during that step — not
// stacked at the top of the card. The body is height-capped and auto-scrolls
// to the latest while streaming (unless the user scrolled up to read).
export const MemberActivityStream = memo(function MemberActivityStream({
  streamingText,
  toolCalls,
  toolCursors,
  working,
}: {
  streamingText: string
  toolCalls: ToolCallState[]
  toolCursors: Record<string, number>
  working: boolean
}): React.JSX.Element {
  const groups = useMemo(
    () => buildTimeline(streamingText, toolCalls, toolCursors, working),
    [streamingText, toolCalls, toolCursors, working]
  )

  // Re-key on text length + tool count so the scroller re-pins to the bottom
  // whenever the body grows (new deltas, new tool call), not on every render.
  const contentKey = `${streamingText.length}|${toolCalls.length}`
  const scrollRef = useBottomAutoScroll(contentKey)

  return (
    <div ref={scrollRef} className="max-h-80 space-y-1.5 overflow-y-auto pr-0.5">
      {groups.map((group, gi) => {
        const isLast = gi === groups.length - 1
        if (group.kind === 'stage') {
          return (
            <StageSection
              key={`g-${gi}`}
              title={group.title}
              live={group.live}
              active={working && isLast}
              items={group.items}
            />
          )
        }
        // Ungrouped items (emitted before the first <stage>) render flat.
        return (
          <div key={`g-${gi}`} className="space-y-1.5">
            {group.items.map((item, ii) => renderItem(item, ii))}
          </div>
        )
      })}
    </div>
  )
})

function renderItem(item: TimelineItem, i: number): React.JSX.Element {
  switch (item.kind) {
    case 'think':
      return <ThinkBlock key={`t-${i}`} text={item.text} streaming={item.live} />
    case 'text':
      return <TextBlock key={`x-${i}`} text={item.text} streaming={item.live} />
    case 'tool':
      return <ToolLogRow key={item.toolCall.id} toolCall={item.toolCall} />
  }
}

MemberActivityStream.displayName = 'MemberActivityStream'
