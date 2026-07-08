/**
 * VNode types — re-exported from @flint/plugin-sdk.
 *
 * The SDK is the SINGLE SOURCE OF TRUTH for all VNode types.
 * This file is a thin re-export shim so existing host-side import paths
 * (`@/lib/plugin/vnode-types`) continue to work.
 */

export type {
  // Primitives
  LocalizedString,
  VNode,

  // Variants & enums
  StatCardVariant,
  BadgeVariant,
  CellRenderer,
  ButtonVariant,

  // Discriminated union
  TypedVNode,

  // Display
  StatCardVNode,
  SparklineVNode,
  BadgeVNode,
  PieChartVNode,
  BarChartVNode,
  AreaChartVNode,
  LineChartVNode,
  TableVNode,

  // Layout
  GridVNode,
  RowVNode,
  ColVNode,
  HeadingVNode,
  TextVNode,

  // Interactive input
  InputVNode,
  TextareaVNode,
  SelectVNode,
  NumberVNode,
  CheckboxVNode,
  SwitchVNode,
  ToggleGroupVNode,
  RadioGroupVNode,
  ButtonVNode,
  TagListVNode,
  SearchInputVNode,

  // Props
  StatCardProps,
  SparklineProps,
  BadgeProps,
  PieChartProps,
  BarChartProps,
  AreaChartProps,
  LineChartProps,
  TableProps,
  GridProps,
  InputProps,
  TextareaProps,
  SelectProps,
  NumberProps,
  CheckboxProps,
  SwitchProps,
  ToggleGroupProps,
  RadioGroupProps,
  ButtonProps,
  TagItem,
  TagListProps,
  SearchResultItem,
  SearchInputProps,
  FormActionData,

  // Plugin UI API
  PluginView,
  PluginChartFactory,
  PluginUI,
} from '@flint/plugin-sdk'
