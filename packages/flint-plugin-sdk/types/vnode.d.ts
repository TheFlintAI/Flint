/**
 * VNode — Virtual UI component type definitions.
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

// ── Display component props ────────────────────────────────────────────────

export type StatCardVariant = 'neutral' | 'success' | 'destructive' | 'warning' | 'info'
export type BadgeVariant = StatCardVariant
export type CellRenderer = 'default' | 'change' | 'badge' | 'sparkline'

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

export interface ChartProps {
  data: Record<string, unknown>[]
  nameKey?: string
  dataKey?: string
  xKey?: string
  yKey?: string
  colors?: string[]
}

export interface TableProps {
  columns: { key: string; label: LocalizedString; renderer?: CellRenderer }[]
  rows: Record<string, unknown>[]
}

// ── Layout component props ─────────────────────────────────────────────────

export interface GridProps {
  cols: number
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
  variant?: 'default' | 'primary' | 'destructive' | 'outline' | 'secondary' | 'ghost'
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

// ── Plugin UI API ──────────────────────────────────────────────────────────

export interface PluginUI {
  /** Register a custom tab in the plugin settings panel. */
  tab(id: string, label: LocalizedString, icon: string, render: () => VNode): void
  /** Trigger re-render of a registered tab. */
  refresh(id: string): void

  // Display components
  card(props: StatCardProps): VNode
  sparkline(props: SparklineProps): VNode
  badge(props: BadgeProps): VNode
  pie(props: ChartProps): VNode
  bar(props: ChartProps): VNode
  area(props: ChartProps): VNode
  line(props: ChartProps): VNode
  table(props: TableProps): VNode

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
   *     'my-form': { change({ values }) { ... } }
   *   })
   *
   * Function form — catch-all:
   *   $plugin.ui.onAction(({ formId, action, values }) => { ... })
   */
  onAction(routes: Record<string, Record<string, (data: FormActionData) => void>>): { dispose(): void }
  onAction(callback: (data: FormActionData) => void): { dispose(): void }
}
