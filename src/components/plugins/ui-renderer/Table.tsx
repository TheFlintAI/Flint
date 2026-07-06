import * as React from 'react'
import { cn } from '@/lib/utils'
import { Sparkline } from './Sparkline'
import { Badge } from './Badge'
import type { CellRenderer, StatCardVariant, BadgeVariant } from '@/lib/plugin/vnode-types'
import { useTranslation } from 'react-i18next'

interface TableColumn {
  key: string
  label: string
  renderer?: CellRenderer
}

interface TableProps {
  columns: TableColumn[]
  rows: Record<string, unknown>[]
}

const ROW_VARIANT_STYLES: Record<string, string> = {
  success:     'border-l-2 border-l-green-500',
  destructive: 'border-l-2 border-l-red-500',
  warning:     'border-l-2 border-l-amber-500',
  info:        'border-l-2 border-l-blue-500',
}

function renderCell(value: unknown, renderer?: CellRenderer): React.ReactNode {
  const str = String(value ?? '')
  if (renderer === 'change') {
    const isPositive = str.startsWith('+') || (!isNaN(+str) && +str > 0)
    const isNegative = str.startsWith('-') || (!isNaN(+str) && +str < 0)
    return (
      <span className={cn(
        'tabular-nums',
        isPositive && 'text-green-500',
        isNegative && 'text-red-500',
      )}>
        {str}
      </span>
    )
  }
  if (renderer === 'badge') {
    const v = value as { variant?: string; label?: string } | undefined
    if (v && v.label) {
      const variant = (v.variant || 'neutral') as BadgeVariant
      return <Badge label={v.label} variant={variant} />
    }
    return <span>{str}</span>
  }
  if (renderer === 'sparkline') {
    const data = Array.isArray(value) ? (value as number[]) : []
    return data.length > 0 ? <Sparkline data={data} /> : <span className="text-muted-foreground">—</span>
  }
  return str
}

export function Table({ columns, rows }: TableProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  if (!rows || rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-[13px] text-muted-foreground">
        {t('plugin.table.noData')}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-muted/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-2.5 text-left font-medium text-muted-foreground"
                style={col.renderer === 'sparkline' ? { minWidth: 80 } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const variant = (row._variant as StatCardVariant) ?? ''
            const variantStyle = ROW_VARIANT_STYLES[variant] ?? ''
            return (
              <tr
                key={i}
                className={cn(
                  'border-b last:border-0 transition-colors hover:bg-muted/30',
                  variantStyle,
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                    {renderCell(row[col.key], col.renderer)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
