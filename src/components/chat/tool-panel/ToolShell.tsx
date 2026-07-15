import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { hasImageBlocks } from './utils'
import type { ToolResultContent } from '@/lib/api/types'

export interface ToolShellProps {
  isActive: boolean
  isProcessing: boolean
  output?: ToolResultContent
  expandWhileActive?: boolean
  expandForImages?: boolean
  className?: string
  triggerClassName?: string
  bodyClassName?: string
  header: React.ReactNode
  /** Badges rendered at the far right of the title bar, before the trailing status. */
  badges?: React.ReactNode
  body: React.ReactNode
  trailing: (open: boolean) => React.ReactNode
}

/**
 * Shared collapsible shell for tool panels.
 * Used by both ToolPanel (message view) and ProcessGroupPanel (stage group view).
 *
 * Layout: [header] [ml-auto] [badges] [trailing]
 * Badges and trailing status are both right-aligned for visual consistency.
 */
export function ToolShell({
  isActive,
  isProcessing,
  output,
  expandWhileActive = true,
  expandForImages = true,
  className,
  triggerClassName,
  bodyClassName,
  header,
  badges,
  body,
  trailing,
}: ToolShellProps): React.JSX.Element {
  const hasVisualOutput = hasImageBlocks(output)

  const [open, setOpen] = React.useState(
    (expandWhileActive && isActive) || (expandForImages && hasVisualOutput)
  )
  const prevIsActiveRef = React.useRef(isActive)

  React.useEffect(() => {
    if (expandForImages && hasVisualOutput) {
      setOpen(true)
      prevIsActiveRef.current = isActive
      return
    }
    if (expandWhileActive && prevIsActiveRef.current && !isActive) {
      setOpen(false)
    }
    prevIsActiveRef.current = isActive
  }, [hasVisualOutput, isActive, expandForImages, expandWhileActive])

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        if (isActive) return
        setOpen(next)
      }}
      className={cn(
        'overflow-hidden bg-transparent rounded-lg border border-border/40',
        className,
      )}
    >
      <CollapsibleTrigger
        disabled={isActive}
        className={cn(
          'group flex w-full items-center gap-2 rounded-t-lg px-3 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50',
          triggerClassName,
        )}
      >
        <span className={cn(isProcessing && 'shimmer')}>
          {header}
        </span>
        {badges ? <span className="ml-auto flex shrink-0 items-center gap-1">{badges}</span> : null}
        <span className={cn('shrink-0', !badges && 'ml-auto')}>{trailing(open)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn('px-3 py-2.5', bodyClassName)}>{body}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
