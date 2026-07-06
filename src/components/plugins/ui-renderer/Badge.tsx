import * as React from 'react'
import { cn } from '@/lib/utils'
import type { BadgeVariant } from '@/lib/plugin/vnode-types'

interface BadgeProps {
  label: string
  variant: BadgeVariant
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  neutral:     'bg-muted text-muted-foreground',
  success:     'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  destructive: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  warning:     'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  info:        'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
}

export function Badge({ label, variant }: BadgeProps): React.JSX.Element {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
      VARIANT_STYLES[variant],
    )}>
      {label}
    </span>
  )
}
