/**
 * VNode — Virtual UI component type definitions.
 *
 * This is the SINGLE SOURCE OF TRUTH for all VNode types used by the
 * Flint plugin system. Both the SDK runtime and the host renderer
 * derive their types from this file.
 *
 * Plugins return VNode trees (plain JSON) from render functions.
 * The host renders them as React components via VNodeRenderer.
 *
 * All user-facing text props accept either a plain string or a
 * localized object `Record<string, string>` (e.g. `{ en: "...", zh: "..." }`).
 */

// ── Primitives ─────────────────────────────────────────────────────────────

/** A string that can be plain or localized.
 * Pass `{ en: "...", zh: "...", ja: "..." }` for i18n — any language code works.
 * Resolution order: target language → 'en' → first available → ''. */
export type LocalizedString = string | Record<string, string>

/** Base VNode shape — all variants extend this. */
export interface VNode {
  type: string
  props?: Record<string, unknown>
  children?: VNode[]
}

// ── Permission ─────────────────────────────────────────────────────────────

/**
 * Permission values for plugin.toml `permissions` array.
 *
 * Wildcard permissions grant all sub-permissions:
 *   `fs`        → fs:read + fs:write
 *   `clipboard` → clipboard:read + clipboard:write
 *
 * @example permissions = ["shell", "network", "fs:read"]
 */
export type PluginPermission =
  | 'shell'
  | 'fs' | 'fs:read' | 'fs:write'
  | 'network'
  | 'clipboard' | 'clipboard:read' | 'clipboard:write'

// ── Shared enums & variants ────────────────────────────────────────────────

export type StatCardVariant = 'neutral' | 'success' | 'destructive' | 'warning' | 'info'
export type BadgeVariant = StatCardVariant
export type CellRenderer = 'default' | 'change' | 'badge' | 'sparkline'
export type ButtonVariant = 'default' | 'primary' | 'destructive' | 'outline' | 'secondary' | 'ghost'

// ── Display component props ────────────────────────────────────────────────

export interface StatCardProps {
  label: LocalizedString
  value: string
  icon?: string
  variant: StatCardVariant
  description?: LocalizedString
  trend?: number[]
}

export interface SparklineProps {
  data: number[]
  color?: string
}

export interface BadgeProps {
  label: LocalizedString
  variant: BadgeVariant
}

export interface PieChartProps {
  data: Record<string, unknown>[]
  nameKey: string
  dataKey: string
  colors?: string[]
}

export interface BarChartProps {
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  colors?: string[]
}

export interface AreaChartProps {
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  colors?: string[]
}

export interface LineChartProps {
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  colors?: string[]
}

export interface TableProps {
  columns: { key: string; label: LocalizedString; renderer?: CellRenderer }[]
  rows: Record<string, unknown>[]
}

// ── Layout component props ─────────────────────────────────────────────────

export interface GridProps {
  cols?: number
}

// ── Form component props ───────────────────────────────────────────────────

export interface InputProps {
  id: string
  label?: LocalizedString
  value?: string
  placeholder?: LocalizedString
  type?: 'text' | 'password' | 'email'
  required?: boolean
  disabled?: boolean
}

export interface TextareaProps {
  id: string
  label?: LocalizedString
  value?: string
  placeholder?: LocalizedString
  rows?: number
  required?: boolean
  disabled?: boolean
}

export interface SelectProps {
  id: string
  label?: LocalizedString
  value?: string
  options: { value: string; label: LocalizedString }[]
  placeholder?: LocalizedString
  disabled?: boolean
}

export interface NumberProps {
  id: string
  label?: LocalizedString
  value?: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}

export interface CheckboxProps {
  id: string
  label: LocalizedString
  description?: LocalizedString
  checked?: boolean
  disabled?: boolean
}

export interface SwitchProps {
  id: string
  label?: LocalizedString
  description?: LocalizedString
  checked?: boolean
  disabled?: boolean
}

export interface ToggleGroupProps {
  id: string
  label?: LocalizedString
  value: string[]
  options: { value: string; label: LocalizedString }[]
  disabled?: boolean
}

export interface RadioGroupProps {
  id: string
  label?: LocalizedString
  value?: string
  options: { value: string; label: LocalizedString; description?: LocalizedString }[]
  disabled?: boolean
}

export interface ButtonProps {
  id: string
  label: LocalizedString
  variant?: ButtonVariant
  action: string
  disabled?: boolean
}

// ── Tag list ────────────────────────────────────────────────────────────────

export interface TagItem {
  key: string
  label: string
  description?: string
  badge?: LocalizedString
  badgeVariant?: BadgeVariant
  loading?: boolean
}

export interface TagListProps {
  id: string
  label?: LocalizedString
  tags: TagItem[]
  max?: number
  emptyText?: LocalizedString
  addPanel?: VNode
}

// ── Search input ────────────────────────────────────────────────────────────

export interface SearchResultItem {
  key: string
  title: string
  subtitle?: string
  badge?: LocalizedString
  badgeVariant?: BadgeVariant
  disabled?: boolean
  disabledReason?: string
}

export interface SearchInputProps {
  id: string
  label?: LocalizedString
  placeholder?: LocalizedString
  searchAction: string
  minQueryLength?: number
  debounceMs?: number
  results?: SearchResultItem[]
  resultsLoading?: boolean
  emptyText?: LocalizedString
  addButtonText?: LocalizedString
  addedText?: LocalizedString
  searchingText?: LocalizedString
  minQueryText?: LocalizedString
}

/** Data sent to the plugin when a form action is triggered. */
export interface FormActionData {
  formId: string
  action: string
  values: Record<string, unknown>
}

// ── Discriminated union VNode types ────────────────────────────────────────

/** All supported VNode types as a discriminated union on `type`. */
export type TypedVNode =
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

// Display variants

export interface StatCardVNode {
  type: 'card'
  props: StatCardProps
}

export interface SparklineVNode {
  type: 'sparkline'
  props: SparklineProps
}

export interface BadgeVNode {
  type: 'badge'
  props: BadgeProps
}

export interface PieChartVNode {
  type: 'pie-chart'
  props: PieChartProps
}

export interface BarChartVNode {
  type: 'bar-chart'
  props: BarChartProps
}

export interface AreaChartVNode {
  type: 'area-chart'
  props: AreaChartProps
}

export interface LineChartVNode {
  type: 'line-chart'
  props: LineChartProps
}

export interface TableVNode {
  type: 'table'
  props: TableProps
}

// Layout variants

export interface GridVNode {
  type: 'grid'
  props?: GridProps
  children: TypedVNode[]
}

export interface RowVNode {
  type: 'row'
  children: TypedVNode[]
}

export interface ColVNode {
  type: 'col'
  children: TypedVNode[]
}

export interface HeadingVNode {
  type: 'heading'
  props: { text: LocalizedString }
}

export interface TextVNode {
  type: 'text'
  props: { text: LocalizedString }
}

// Interactive input variants

export interface InputVNode {
  type: 'input'
  props: InputProps
}

export interface TextareaVNode {
  type: 'textarea'
  props: TextareaProps
}

export interface SelectVNode {
  type: 'select'
  props: SelectProps
}

export interface NumberVNode {
  type: 'number'
  props: NumberProps
}

export interface CheckboxVNode {
  type: 'checkbox'
  props: CheckboxProps
}

export interface SwitchVNode {
  type: 'switch'
  props: SwitchProps
}

export interface ToggleGroupVNode {
  type: 'toggle-group'
  props: ToggleGroupProps
}

export interface RadioGroupVNode {
  type: 'radio-group'
  props: RadioGroupProps
}

export interface ButtonVNode {
  type: 'button'
  props: ButtonProps
}

export interface TagListVNode {
  type: 'tag-list'
  props: TagListProps
}

export interface SearchInputVNode {
  type: 'search-input'
  props: SearchInputProps
}

// ── Plugin UI API ──────────────────────────────────────────────────────────

/** View/tab management — separate from component factories. */
export interface PluginView {
  /** Register a custom tab in the plugin settings panel. */
  register(id: string, label: LocalizedString, icon: string, render: () => VNode): void
  /** Trigger re-render of a registered tab. Omit id to refresh all tabs. */
  refresh(id?: string): void
}

/** Chart component factories (grouped sub-namespace). */
export interface PluginChartFactory {
  pie(props: PieChartProps): VNode
  bar(props: BarChartProps): VNode
  area(props: AreaChartProps): VNode
  line(props: LineChartProps): VNode
}

/** Component factories for building plugin UI. */
export interface PluginUI {
  // Display components
  card(props: StatCardProps): VNode
  sparkline(props: SparklineProps): VNode
  badge(props: BadgeProps): VNode
  table(props: TableProps): VNode

  // Chart sub-namespace
  chart: PluginChartFactory

  // Layout components
  grid(props: GridProps, children: VNode[]): VNode
  row(children: VNode[]): VNode
  col(children: VNode[]): VNode
  heading(text: LocalizedString): VNode
  text(text: LocalizedString): VNode

  // Interactive input components
  input(props: InputProps): VNode
  textarea(props: TextareaProps): VNode
  select(props: SelectProps): VNode
  number(props: NumberProps): VNode
  checkbox(props: CheckboxProps): VNode
  switch(props: SwitchProps): VNode
  toggleGroup(props: ToggleGroupProps): VNode
  radioGroup(props: RadioGroupProps): VNode
  button(props: ButtonProps): VNode
  tagList(props: TagListProps): VNode
  searchInput(props: SearchInputProps): VNode

  /**
   * Register form action handlers.
   *
   * Object form (recommended) — routes by formId → action:
   *   $plugin.ui.onAction({
   *     'my-form': {
   *       change({ values }) { ... },
   *       submit({ values }) { ... },
   *     }
   *   })
   *
   * Function form — catch-all:
   *   $plugin.ui.onAction(({ formId, action, values }) => { ... })
   */
  onAction(routes: Record<string, Record<string, (data: FormActionData) => void>>): { dispose(): void }
  onAction(callback: (data: FormActionData) => void): { dispose(): void }
}
