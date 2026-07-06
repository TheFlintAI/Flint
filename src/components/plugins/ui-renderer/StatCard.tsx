import * as React from 'react'
import { cn } from '@/lib/utils'
import { resolveLucideIcon } from '@/lib/tools/tool-icon'
import { Sparkline } from './Sparkline'
import type { StatCardVariant } from '@/lib/plugin/vnode-types'

interface StatCardProps {
  label: string
  value: string
  icon?: string
  variant: StatCardVariant
  description?: string
  trend?: number[]
}

const VARIANT_STYLES: Record<StatCardVariant, { border: string; icon: string; bg: string }> = {
  neutral:     { border: '',                                 icon: 'text-muted-foreground', bg: '' },
  success:     { border: 'border-l-2 border-l-green-500',   icon: 'text-green-500',         bg: 'bg-green-50 dark:bg-green-950/20' },
  destructive: { border: 'border-l-2 border-l-red-500',     icon: 'text-red-500',           bg: 'bg-red-50 dark:bg-red-950/20' },
  warning:     { border: 'border-l-2 border-l-amber-500',   icon: 'text-amber-500',         bg: 'bg-amber-50 dark:bg-amber-950/20' },
  info:        { border: 'border-l-2 border-l-blue-500',    icon: 'text-blue-500',          bg: 'bg-blue-50 dark:bg-blue-950/20' },
}

export function StatCard({ label, value, icon, variant, description, trend }: StatCardProps): React.JSX.Element {
  const Icon = resolveLucideIcon(icon)
  const styles = VARIANT_STYLES[variant]

  return (
    <div className={cn(
      'rounded-xl border bg-card/60 p-4',
      'transition-colors hover:bg-card/80',
      styles.border,
      styles.bg,
    )}>
      <div className="flex items-center gap-2 mb-2">
        {icon && <Icon className={cn('size-4', styles.icon)} />}
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-[22px] font-semibold tabular-nums">{value}</p>
      {description && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      )}
      {trend && trend.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <Sparkline data={trend} />
        </div>
      )}
    </div>
  )
}
