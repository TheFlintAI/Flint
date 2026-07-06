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
  body: React.ReactNode
  trailing: (open: boolean) => React.ReactNode
}

/**
 * Shared collapsible shell for tool panels.
 * Used by both ToolPanel (message view) and ProcessGroupPanel (stage group view).
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
          'group flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50',
          triggerClassName,
        )}
      >
        <span className={cn(isProcessing && 'shimmer')}>
          {header}
        </span>
        <span className="ml-auto shrink-0">{trailing(open)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn('px-3 py-2.5', bodyClassName)}>{body}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
