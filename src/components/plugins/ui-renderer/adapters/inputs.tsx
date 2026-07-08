/**
 * Form/input component adapters — all 11 interactive components.
 */

import * as React from 'react'
import type { VNode } from '@/lib/plugin/vnode-types'
import type { LocalizedString } from '@/lib/localized-string'
import { resolveLocalizedString } from '@/lib/localized-string'
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
} from '../plugin-inputs'
import { registerAdapter, type AdapterContext } from './adapter-registry'

function t(text: LocalizedString, language: string): string {
  return resolveLocalizedString(text, language)
}

registerAdapter('input', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; value?: string; placeholder?: LocalizedString
      type?: 'text' | 'password' | 'email'; required?: boolean; disabled?: boolean
    }
    return (
      <Input
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        value={p.value}
        placeholder={p.placeholder ? t(p.placeholder, ctx.language) : undefined}
        type={p.type}
        required={p.required}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('textarea', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; value?: string; placeholder?: LocalizedString
      rows?: number; required?: boolean; disabled?: boolean
    }
    return (
      <Textarea
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        value={p.value}
        placeholder={p.placeholder ? t(p.placeholder, ctx.language) : undefined}
        rows={p.rows}
        required={p.required}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('select', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; value?: string
      options: { value: string; label: LocalizedString }[]
      placeholder?: LocalizedString; disabled?: boolean
    }
    return (
      <Select
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        value={p.value}
        options={p.options.map((o) => ({ value: o.value, label: t(o.label, ctx.language) }))}
        placeholder={p.placeholder ? t(p.placeholder, ctx.language) : undefined}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('number', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; value?: number
      min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean
    }
    return (
      <Number
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        value={p.value}
        min={p.min}
        max={p.max}
        step={p.step}
        suffix={p.suffix}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('checkbox', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label: LocalizedString; description?: LocalizedString; checked?: boolean; disabled?: boolean
    }
    return (
      <Checkbox
        id={p.id}
        label={t(p.label, ctx.language)}
        description={p.description ? t(p.description, ctx.language) : undefined}
        checked={p.checked}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('switch', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; description?: LocalizedString; checked?: boolean; disabled?: boolean
    }
    return (
      <Switch
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        description={p.description ? t(p.description, ctx.language) : undefined}
        checked={p.checked}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('toggle-group', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; value: string[]
      options: { value: string; label: LocalizedString }[]; disabled?: boolean
    }
    return (
      <ToggleGroup
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        value={p.value}
        options={p.options.map((o) => ({ value: o.value, label: t(o.label, ctx.language) }))}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('radio-group', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString; value?: string
      options: { value: string; label: LocalizedString; description?: LocalizedString }[]
      disabled?: boolean
    }
    return (
      <RadioGroup
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        value={p.value}
        options={p.options.map((o) => ({
          value: o.value,
          label: t(o.label, ctx.language),
          description: o.description ? t(o.description, ctx.language) : undefined,
        }))}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('button', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label: LocalizedString; variant?: string; action: string; disabled?: boolean
    }
    return (
      <Button
        id={p.id}
        label={t(p.label, ctx.language)}
        variant={(p.variant as 'default' | 'primary' | 'destructive' | 'outline' | 'secondary' | 'ghost') ?? 'default'}
        action={p.action}
        disabled={p.disabled}
        onAction={ctx.onFormAction}
      />
    )
  },
})

registerAdapter('tag-list', {
  render(node: VNode, ctx: AdapterContext) {
    const p = node.props as {
      id: string; label?: LocalizedString
      tags: { key: string; label: string; description?: string; badge?: LocalizedString; badgeVariant?: string; loading?: boolean }[]
      max?: number; emptyText?: LocalizedString
      addPanel?: VNode
    }
    return (
      <TagList
        id={p.id}
        label={p.label ? t(p.label, ctx.language) : undefined}
        tags={p.tags.map(tag => ({ ...tag, badge: tag.badge ? t(tag.badge, ctx.language) : undefined }))}
        max={p.max}
        emptyText={p.emptyText ? t(p.emptyText, ctx.language) : undefined}
        addPanel={p.addPanel ? ctx.renderChild(p.addPanel) : undefined}
        onAction={ctx.onFormAction ?? (() => {})}
      />
    )
  },
})

registerAdapter('search-input', {
  render(node: VNode, ctx: AdapterContext) {
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
        label={p.label ? t(p.label, ctx.language) : undefined}
        placeholder={p.placeholder ? t(p.placeholder, ctx.language) : undefined}
        searchAction={p.searchAction}
        minQueryLength={p.minQueryLength}
        debounceMs={p.debounceMs}
        results={p.results?.map(r => ({ ...r, badge: r.badge ? t(r.badge, ctx.language) : undefined }))}
        resultsLoading={p.resultsLoading}
        emptyText={p.emptyText ? t(p.emptyText, ctx.language) : undefined}
        addButtonText={p.addButtonText ? t(p.addButtonText, ctx.language) : undefined}
        addedText={p.addedText ? t(p.addedText, ctx.language) : undefined}
        searchingText={p.searchingText ? t(p.searchingText, ctx.language) : undefined}
        minQueryText={p.minQueryText ? t(p.minQueryText, ctx.language) : undefined}
        onAction={ctx.onFormAction ?? (() => {})}
      />
    )
  },
})
