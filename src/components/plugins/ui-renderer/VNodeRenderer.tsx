import * as React from 'react'
import type { VNode, FormActionData } from '@/lib/plugin/vnode-types'
import type { LocalizedString } from '@/lib/localized-string'
import { resolveLocalizedString } from '@/lib/localized-string'
import { StatCard } from './StatCard'
import { Sparkline } from './Sparkline'
import { Badge } from './Badge'
import { Chart } from './Chart'
import { Table } from './Table'
import { Layout } from './Layout'
import {
  Input,
  Textarea,
  Select,
  Number,
  Checkbox,
  Switch,
  ToggleGroup,
  RadioGroup,
  Button,
  TagList,
  SearchInput,
} from './plugin-inputs'

interface VNodeRendererProps {
  node: VNode
  language: string
  /** Called when a form action is triggered (button click inside a form). */
  onFormAction?: (data: FormActionData) => void
}

function t(text: LocalizedString, language: string): string {
  return resolveLocalizedString(text, language)
}

/**
 * Renders a VNode tree into React components.
 * Dispatches on node.type to the correct component.
 * Resolves all LocalizedString props using the given language.
 */
export function VNodeRenderer({ node, language, onFormAction }: VNodeRendererProps): React.JSX.Element | null {
  if (!node || !node.type) return null

  switch (node.type) {
    case 'card': {
      const { label, value, icon, variant, description, trend } = node.props as {
        label: LocalizedString; value: string; icon?: string
        variant: 'neutral' | 'success' | 'destructive' | 'warning' | 'info'
        description?: LocalizedString; trend?: number[]
      }
      return (
        <StatCard
          label={t(label, language)}
          value={value}
          icon={icon}
          variant={variant}
          description={description ? t(description, language) : undefined}
          trend={trend}
        />
      )
    }

    case 'sparkline': {
      const { data, color } = node.props as { data: number[]; color?: string }
      return <Sparkline data={data} color={color} />
    }

    case 'badge': {
      const { label, variant } = node.props as {
        label: LocalizedString
        variant: 'neutral' | 'success' | 'destructive' | 'warning' | 'info'
      }
      return <Badge label={t(label, language)} variant={variant} />
    }

    case 'pie-chart': {
      const { data, nameKey, dataKey, colors } = node.props as { data: Record<string, unknown>[]; nameKey: string; dataKey: string; colors?: string[] }
      return <Chart type="pie" data={data} nameKey={nameKey} dataKey={dataKey} colors={colors} />
    }

    case 'bar-chart': {
      const { data, xKey, yKey, colors } = node.props as { data: Record<string, unknown>[]; xKey: string; yKey: string; colors?: string[] }
      return <Chart type="bar" data={data} xKey={xKey} yKey={yKey} colors={colors} />
    }

    case 'area-chart': {
      const { data, xKey, yKey, colors } = node.props as { data: Record<string, unknown>[]; xKey: string; yKey: string; colors?: string[] }
      return <Chart type="area" data={data} xKey={xKey} yKey={yKey} colors={colors} />
    }

    case 'line-chart': {
      const { data, xKey, yKey, colors } = node.props as { data: Record<string, unknown>[]; xKey: string; yKey: string; colors?: string[] }
      return <Chart type="line" data={data} xKey={xKey} yKey={yKey} colors={colors} />
    }

    case 'table': {
      const { columns, rows } = node.props as { columns: { key: string; label: LocalizedString; renderer?: 'default' | 'change' }[]; rows: Record<string, unknown>[] }
      return (
        <Table
          columns={columns.map((c) => ({ key: c.key, label: t(c.label, language), renderer: c.renderer }))}
          rows={rows}
        />
      )
    }

    case 'grid': {
      const cols = (node.props as { cols?: number })?.cols ?? 2
      return <Layout type="grid" cols={cols}>{renderChildren(node.children, language, onFormAction)}</Layout>
    }

    case 'row':
      return <Layout type="row">{renderChildren(node.children, language, onFormAction)}</Layout>

    case 'col':
      return <Layout type="col">{renderChildren(node.children, language, onFormAction)}</Layout>

    case 'heading': {
      const text = (node.props as { text?: LocalizedString })?.text
      return <Layout type="heading" text={text ? t(text, language) : ''} />
    }

    case 'text': {
      const text = (node.props as { text?: LocalizedString })?.text
      return <Layout type="text" text={text ? t(text, language) : ''} />
    }

    case 'input': {
      const p = node.props as {
        id: string; label?: LocalizedString; value?: string; placeholder?: LocalizedString
        type?: 'text' | 'password' | 'email'; required?: boolean; disabled?: boolean
      }
      return (
        <Input
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          value={p.value}
          placeholder={p.placeholder ? t(p.placeholder, language) : undefined}
          type={p.type}
          required={p.required}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'textarea': {
      const p = node.props as {
        id: string; label?: LocalizedString; value?: string; placeholder?: LocalizedString
        rows?: number; required?: boolean; disabled?: boolean
      }
      return (
        <Textarea
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          value={p.value}
          placeholder={p.placeholder ? t(p.placeholder, language) : undefined}
          rows={p.rows}
          required={p.required}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'select': {
      const p = node.props as {
        id: string; label?: LocalizedString; value?: string
        options: { value: string; label: LocalizedString }[]
        placeholder?: LocalizedString; disabled?: boolean
      }
      return (
        <Select
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          value={p.value}
          options={p.options.map((o) => ({ value: o.value, label: t(o.label, language) }))}
          placeholder={p.placeholder ? t(p.placeholder, language) : undefined}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'number': {
      const p = node.props as {
        id: string; label?: LocalizedString; value?: number
        min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean
      }
      return (
        <Number
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          value={p.value}
          min={p.min}
          max={p.max}
          step={p.step}
          suffix={p.suffix}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'checkbox': {
      const p = node.props as {
        id: string; label: LocalizedString; description?: LocalizedString; checked?: boolean; disabled?: boolean
      }
      return (
        <Checkbox
          id={p.id}
          label={t(p.label, language)}
          description={p.description ? t(p.description, language) : undefined}
          checked={p.checked}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'switch': {
      const p = node.props as {
        id: string; label?: LocalizedString; description?: LocalizedString; checked?: boolean; disabled?: boolean
      }
      return (
        <Switch
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          description={p.description ? t(p.description, language) : undefined}
          checked={p.checked}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'toggle-group': {
      const p = node.props as {
        id: string; label?: LocalizedString; value: string[]
        options: { value: string; label: LocalizedString }[]; disabled?: boolean
      }
      return (
        <ToggleGroup
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          value={p.value}
          options={p.options.map((o) => ({ value: o.value, label: t(o.label, language) }))}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'radio-group': {
      const p = node.props as {
        id: string; label?: LocalizedString; value?: string
        options: { value: string; label: LocalizedString; description?: LocalizedString }[]
        disabled?: boolean
      }
      return (
        <RadioGroup
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          value={p.value}
          options={p.options.map((o) => ({
            value: o.value,
            label: t(o.label, language),
            description: o.description ? t(o.description, language) : undefined,
          }))}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'button': {
      const p = node.props as {
        id: string; label: LocalizedString; variant?: string; action: string; disabled?: boolean
      }
      return (
        <Button
          id={p.id}
          label={t(p.label, language)}
          variant={(p.variant as 'default' | 'primary' | 'destructive' | 'outline' | 'secondary' | 'ghost') ?? 'default'}
          action={p.action}
          disabled={p.disabled}
          onAction={onFormAction}
        />
      )
    }

    case 'tag-list': {
      const p = node.props as {
        id: string; label?: LocalizedString
        tags: { key: string; label: string; description?: string; badge?: LocalizedString; badgeVariant?: string; loading?: boolean }[]
        max?: number; emptyText?: LocalizedString
        addPanel?: VNode
      }
      return (
        <TagList
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          tags={p.tags.map(tag => ({ ...tag, badge: tag.badge ? t(tag.badge, language) : undefined }))}
          max={p.max}
          emptyText={p.emptyText ? t(p.emptyText, language) : undefined}
          addPanel={p.addPanel ? <VNodeRenderer node={p.addPanel} language={language} onFormAction={onFormAction} /> : undefined}
          onAction={onFormAction ?? (() => {})}
        />
      )
    }

    case 'search-input': {
      const p = node.props as {
        id: string; label?: LocalizedString; placeholder?: LocalizedString
        searchAction: string; minQueryLength?: number; debounceMs?: number
        results?: { key: string; title: string; subtitle?: string; badge?: LocalizedString; badgeVariant?: string; disabled?: boolean; disabledReason?: string }[]
        resultsLoading?: boolean; emptyText?: LocalizedString
        addButtonText?: LocalizedString; addedText?: LocalizedString
        searchingText?: LocalizedString; minQueryText?: LocalizedString
      }
      return (
        <SearchInput
          id={p.id}
          label={p.label ? t(p.label, language) : undefined}
          placeholder={p.placeholder ? t(p.placeholder, language) : undefined}
          searchAction={p.searchAction}
          minQueryLength={p.minQueryLength}
          debounceMs={p.debounceMs}
          results={p.results?.map(r => ({ ...r, badge: r.badge ? t(r.badge, language) : undefined }))}
          resultsLoading={p.resultsLoading}
          emptyText={p.emptyText ? t(p.emptyText, language) : undefined}
          addButtonText={p.addButtonText ? t(p.addButtonText, language) : undefined}
          addedText={p.addedText ? t(p.addedText, language) : undefined}
          searchingText={p.searchingText ? t(p.searchingText, language) : undefined}
          minQueryText={p.minQueryText ? t(p.minQueryText, language) : undefined}
          onAction={onFormAction ?? (() => {})}
        />
      )
    }

    default:
      return null
  }
}

function renderChildren(
  children: VNode[] | undefined,
  language: string,
  onFormAction?: (data: FormActionData) => void
): React.ReactNode {
  if (!children || children.length === 0) return null
  return children.map((child, i) => (
    <VNodeRenderer key={i} node={child} language={language} onFormAction={onFormAction} />
  ))
}
