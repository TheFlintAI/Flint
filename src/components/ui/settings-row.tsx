'use client'

import { cn } from '@/lib/utils'

export interface SettingsRowProps {
  label: React.ReactNode
  description?: string
  children: React.ReactNode
  className?: string
  labelClassName?: string
  /** Layout direction: horizontal (label left, input right) or vertical (label above, input below). Default "horizontal". */
  layout?: 'horizontal' | 'vertical'
}

export function SettingsRow({
  label,
  description,
  children,
  className,
  labelClassName,
  layout = 'horizontal'
}: SettingsRowProps): React.JSX.Element {
  if (layout === 'vertical') {
    return (
      <section className={cn('space-y-1.5', className)}>
        <div className="flex flex-col gap-1">
          <label className={cn('text-xs font-medium', labelClassName)}>{label}</label>
          {description && (
            <p className="text-[11px] text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </section>
    )
  }

  return (
    <section className={cn('', className)}>
      <div
        className={cn(
          'flex gap-4',
          description ? 'items-start' : 'items-center'
        )}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <label className={cn('text-sm font-medium', labelClassName)}>{label}</label>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 ml-auto">{children}</div>
      </div>
    </section>
  )
}
