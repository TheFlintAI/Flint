import { memo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelEmptyStateProps {
  icon: ReactNode
  title: string
  className?: string
}

/**
 * Shared empty state for panels across the application.
 * Used by layout dashboards, settings panels, and skill pages.
 * Consistent centered layout with icon in rounded-2xl box and title.
 */
export const PanelEmptyState = memo(function PanelEmptyState({
  icon,
  title,
  className,
}: PanelEmptyStateProps): React.JSX.Element {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-8 text-center', className)}>
      <div className="grid size-16 place-items-center rounded-2xl border border-border/60 bg-muted/20">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
    </div>
  )
})

PanelEmptyState.displayName = 'PanelEmptyState'
