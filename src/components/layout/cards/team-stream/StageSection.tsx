import { memo, useEffect, useRef, useState } from 'react'
import { Layers, ChevronDown, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { TimelineItem } from './timeline'
import { ThinkBlock } from './ThinkBlock'
import { TextBlock } from './TextBlock'
import { ToolLogRow } from './ToolLogRow'

// A `<stage>` rendered as a collapsible section that owns the activity emitted
// under it (text, thinking, tool calls) until the next stage. This is the
// structural fix for "stages float at the top with no content": a stage is now
// a container for the items that arrived while it was the current step, not a
// detached label.
// `active` marks the stage the teammate is currently working in (the last
// stage while the member is still running). It starts collapsed; the user can
// manually expand it. It auto-collapses ~800ms after it settles if still open — so
// a long run leaves a compact trail of stage labels instead of an ever-growing
// wall of expanded sections.
export const StageSection = memo(function StageSection({
  title,
  live,
  active,
  items,
}: {
  title: string
  live: boolean
  active: boolean
  items: TimelineItem[]
}): React.JSX.Element {
  const hasItems = items.length > 0
  const [open, setOpen] = useState(false)
  const prevActiveRef = useRef(active)

  useEffect(() => {
    if (prevActiveRef.current && !active && open) {
      const timer = setTimeout(() => setOpen(false), 800)
      prevActiveRef.current = active
      return () => clearTimeout(timer)
    }
    prevActiveRef.current = active
  }, [active, open])

  if (!title) return <></>

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger
        className={cn(
          'group flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-foreground/85',
          'transition-colors hover:text-foreground'
        )}
      >
        <Layers className="size-3 shrink-0 text-muted-foreground/60" />
        <span className={cn('min-w-0 flex-1 truncate', live && 'shimmer')}>{title}</span>
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/40" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
        )}
      </CollapsibleTrigger>
      {hasItems && (
        <CollapsibleContent>
          <div className="mt-1 space-y-2 border-l border-border/40 pl-3.5">
            {items.map((item, i) => {
              switch (item.kind) {
                case 'think':
                  return (
                    <ThinkBlock
                      key={`t-${i}`}
                      text={item.text}
                      streaming={item.live}
                    />
                  )
                case 'text':
                  return (
                    <TextBlock
                      key={`x-${i}`}
                      text={item.text}
                      streaming={item.live}
                      muted
                    />
                  )
                case 'tool':
                  return <ToolLogRow key={item.toolCall.id} toolCall={item.toolCall} />
              }
            })}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
})

StageSection.displayName = 'StageSection'
