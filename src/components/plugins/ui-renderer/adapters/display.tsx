/**
 * Display component adapters — card, badge, sparkline, table.
 */

import type { VNode } from '@/lib/plugin/vnode-types'
import type { LocalizedString } from '@/lib/localized-string'
import { resolveLocalizedString } from '@/lib/localized-string'
import { StatCard } from '../StatCard'
import { Sparkline } from '../Sparkline'
import { Badge } from '../Badge'
import { Table } from '../Table'
import { registerAdapter, type AdapterContext } from './adapter-registry'

function t(text: LocalizedString, language: string): string {
  return resolveLocalizedString(text, language)
}

registerAdapter('card', {
  render(node: VNode, ctx: AdapterContext) {
    const { label, value, icon, variant, description, trend, trendColorConvention } = node.props as {
      label: LocalizedString; value: string; icon?: string
      variant: 'neutral' | 'success' | 'destructive' | 'warning' | 'info'
      description?: LocalizedString; trend?: number[]; trendColorConvention?: 'cn' | 'us'
    }
    return (
      <StatCard
        label={t(label, ctx.language)}
        value={value}
        icon={icon}
        variant={variant}
        description={description ? t(description, ctx.language) : undefined}
        trend={trend}
        trendColorConvention={trendColorConvention}
      />
    )
  },
})

registerAdapter('sparkline', {
  render(node: VNode, _ctx: AdapterContext) {
    const { data, color } = node.props as { data: number[]; color?: string }
    return <Sparkline data={data} color={color} />
  },
})

registerAdapter('badge', {
  render(node: VNode, ctx: AdapterContext) {
    const { label, variant } = node.props as {
      label: LocalizedString
      variant: 'neutral' | 'success' | 'destructive' | 'warning' | 'info'
    }
    return <Badge label={t(label, ctx.language)} variant={variant} />
  },
})

registerAdapter('table', {
  render(node: VNode, ctx: AdapterContext) {
    const { columns, rows } = node.props as {
      columns: { key: string; label: LocalizedString; renderer?: 'default' | 'change' | 'badge' | 'sparkline' }[]
      rows: Record<string, unknown>[]
    }
    return (
      <Table
        columns={columns.map((c) => ({ key: c.key, label: t(c.label, ctx.language), renderer: c.renderer }))}
        rows={rows}
      />
    )
  },
})
