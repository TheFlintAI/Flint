/**
 * VNode — Virtual UI component types (host-side).
 *
 * Discriminated union wrappers for type-narrowing in VNodeRenderer.
 * Canonical prop types and primitives live in @flint/plugin-sdk/types/vnode.
 */

import type { LocalizedString } from '@/lib/localized-string'
import type {
  StatCardVariant,
  BadgeVariant,
  CellRenderer,
  FormActionData,
} from '@flint/plugin-sdk'

export type { StatCardVariant, BadgeVariant, CellRenderer, FormActionData }

export type VNode =
  // Display
  | StatCardVNode
  | SparklineVNode
  | BadgeVNode
  | PieChartVNode
  | BarChartVNode
  | AreaChartVNode
  | LineChartVNode
  | TableVNode
  // Layout
  | GridVNode
  | RowVNode
  | ColVNode
  | HeadingVNode
  | TextVNode
  // Interactive input
  | InputVNode
  | TextareaVNode
  | SelectVNode
  | NumberVNode
  | CheckboxVNode
  | SwitchVNode
  | ToggleGroupVNode
  | RadioGroupVNode
  | ButtonVNode
  | TagListVNode
  | SearchInputVNode

// Display

export interface StatCardVNode {
  type: 'card'
  props: {
    label: LocalizedString
    value: string
    icon?: string
    variant: StatCardVariant
    description?: LocalizedString
    trend?: number[]
  }
}

export interface SparklineVNode {
  type: 'sparkline'
  props: {
    data: number[]
    color?: string
  }
}

export interface BadgeVNode {
  type: 'badge'
  props: {
    label: LocalizedString
    variant: BadgeVariant
  }
}

export interface PieChartVNode {
  type: 'pie-chart'
  props: {
    data: Record<string, unknown>[]
    nameKey: string
    dataKey: string
    colors?: string[]
  }
}

export interface BarChartVNode {
  type: 'bar-chart'
  props: {
    data: Record<string, unknown>[]
    xKey: string
    yKey: string
    colors?: string[]
  }
}

export interface AreaChartVNode {
  type: 'area-chart'
  props: {
    data: Record<string, unknown>[]
    xKey: string
    yKey: string
    colors?: string[]
  }
}

export interface LineChartVNode {
  type: 'line-chart'
  props: {
    data: Record<string, unknown>[]
    xKey: string
    yKey: string
    colors?: string[]
  }
}

export interface TableVNode {
  type: 'table'
  props: {
    columns: { key: string; label: LocalizedString; renderer?: CellRenderer }[]
    rows: Record<string, unknown>[]
  }
}

// Layout

export interface GridVNode {
  type: 'grid'
  props: { cols: number }
  children: VNode[]
}

export interface RowVNode {
  type: 'row'
  children: VNode[]
}

export interface ColVNode {
  type: 'col'
  children: VNode[]
}

export interface HeadingVNode {
  type: 'heading'
  props: { text: LocalizedString }
}

export interface TextVNode {
  type: 'text'
  props: { text: LocalizedString }
}

// Interactive input

export interface InputVNode {
  type: 'input'
  props: {
    id: string
    label?: LocalizedString
    value?: string
    placeholder?: LocalizedString
    type?: 'text' | 'password' | 'email'
    required?: boolean
    disabled?: boolean
  }
}

export interface TextareaVNode {
  type: 'textarea'
  props: {
    id: string
    label?: LocalizedString
    value?: string
    placeholder?: LocalizedString
    rows?: number
    required?: boolean
    disabled?: boolean
  }
}

export interface SelectVNode {
  type: 'select'
  props: {
    id: string
    label?: LocalizedString
    value?: string
    options: { value: string; label: LocalizedString }[]
    placeholder?: LocalizedString
    disabled?: boolean
  }
}

export interface NumberVNode {
  type: 'number'
  props: {
    id: string
    label?: LocalizedString
    value?: number
    min?: number
    max?: number
    step?: number
    suffix?: string
    disabled?: boolean
  }
}

export interface CheckboxVNode {
  type: 'checkbox'
  props: {
    id: string
    label: LocalizedString
    description?: LocalizedString
    checked?: boolean
    disabled?: boolean
  }
}

export interface SwitchVNode {
  type: 'switch'
  props: {
    id: string
    label?: LocalizedString
    description?: LocalizedString
    checked?: boolean
    disabled?: boolean
  }
}

export interface ToggleGroupVNode {
  type: 'toggle-group'
  props: {
    id: string
    label?: LocalizedString
    value: string[]
    options: { value: string; label: LocalizedString }[]
    disabled?: boolean
  }
}

export interface RadioGroupVNode {
  type: 'radio-group'
  props: {
    id: string
    label?: LocalizedString
    value?: string
    options: { value: string; label: LocalizedString; description?: LocalizedString }[]
    disabled?: boolean
  }
}

export interface ButtonVNode {
  type: 'button'
  props: {
    id: string
    label: LocalizedString
    variant?: 'default' | 'primary' | 'destructive' | 'outline' | 'secondary' | 'ghost'
    action: string
    disabled?: boolean
  }
}

export interface TagListVNode {
  type: 'tag-list'
  props: {
    id: string
    label?: LocalizedString
    tags: { key: string; label: string; description?: string; badge?: string; badgeVariant?: string; loading?: boolean }[]
    max?: number
    emptyText?: LocalizedString
    addPanel?: VNode
  }
}

export interface SearchInputVNode {
  type: 'search-input'
  props: {
    id: string
    label?: LocalizedString
    placeholder?: LocalizedString
    searchAction: string
    minQueryLength?: number
    debounceMs?: number
    results?: { key: string; title: string; subtitle?: string; badge?: string; badgeVariant?: string; disabled?: boolean; disabledReason?: string }[]
    resultsLoading?: boolean
    emptyText?: LocalizedString
    addButtonText?: LocalizedString
    addedText?: LocalizedString
    searchingText?: LocalizedString
    minQueryText?: LocalizedString
  }
}
