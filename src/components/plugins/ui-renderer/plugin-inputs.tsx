import * as React from 'react'
import { cn } from '@/lib/utils'
import { motion, type HTMLMotionProps } from 'motion/react'
import { Reorder } from 'framer-motion'
import { ChevronUp, ChevronDown, Check, Search, X, Plus, Loader2, ListFilter } from 'lucide-react'
import { Button as ShadcnButton } from '@/components/ui/button'
import { ToggleGroup as ShadcnToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useTranslation } from 'react-i18next'

// Shared styles

const labelCls = 'text-[12px] font-medium text-foreground/80'
const descCls = 'text-[11px] text-muted-foreground'

const inputBaseCls = cn(
  'w-full min-w-0 rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none',
  'placeholder:text-muted-foreground',
  'focus-visible:border-ring/40 focus-visible:ring-ring/20 focus-visible:ring-1',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
)

// Shared onAction type

type PluginAction = (data: { formId: string; action: string; values: Record<string, unknown> }) => void

// Input

interface InputProps {
  id: string; label?: string; value?: string; placeholder?: string
  type?: 'text' | 'password' | 'email'; required?: boolean; disabled?: boolean
  onAction?: PluginAction
}

export function Input({ id, label, value: initial = '', placeholder, type = 'text', required, disabled, onAction }: InputProps): React.JSX.Element {
  const [value, setValue] = React.useState(initial)
  React.useEffect(() => { setValue(initial) }, [initial])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setValue(next)
    onAction?.({ formId: id, action: 'change', values: { value: next } })
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={id} className={labelCls}>{label}</label>}
      <input
        id={id} type={type} value={value} required={required} disabled={disabled}
        onChange={handleChange}
        placeholder={placeholder}
        data-slot="input"
        className={cn(inputBaseCls, 'h-9 px-3 py-1 text-sm')}
      />
    </div>
  )
}

// Textarea

interface TextareaProps {
  id: string; label?: string; value?: string; placeholder?: string
  rows?: number; required?: boolean; disabled?: boolean
  onAction?: PluginAction
}

export function Textarea({ id, label, value: initial = '', placeholder, rows = 4, required, disabled, onAction }: TextareaProps): React.JSX.Element {
  const [value, setValue] = React.useState(initial)
  React.useEffect(() => { setValue(initial) }, [initial])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setValue(next)
    onAction?.({ formId: id, action: 'change', values: { value: next } })
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={id} className={labelCls}>{label}</label>}
      <textarea
        id={id} value={value} required={required} disabled={disabled}
        onChange={handleChange}
        placeholder={placeholder} rows={rows}
        data-slot="textarea"
        className={cn(inputBaseCls, 'min-h-16 px-3 py-2 text-sm field-sizing-content')}
      />
    </div>
  )
}

// Select

interface SelectProps {
  id: string; label?: string; value?: string
  options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean
  onAction?: PluginAction
}

export function Select({ id, label, value: initial = '', options, placeholder, disabled, onAction }: SelectProps): React.JSX.Element {
  const [value, setValue] = React.useState(initial)
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => { setValue(initial) }, [initial])
  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? ''

  const handleSelect = (optValue: string) => {
    setValue(optValue)
    setOpen(false)
    onAction?.({ formId: id, action: 'change', values: { value: optValue } })
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={labelCls}>{label}</span>}
      <div className="relative">
        <button
          type="button" disabled={disabled}
          onClick={() => setOpen(!open)}
          className={cn(
            inputBaseCls,
            'flex h-9 items-center justify-between gap-2 px-3 py-2 text-sm',
            !selectedLabel && 'text-muted-foreground'
          )}
        >
          <span className="truncate">{selectedLabel || placeholder || ' '}</span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            >
              <div className="max-h-60 overflow-y-auto p-1">
                {options.map((opt) => (
                  <button
                    key={opt.value} type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none',
                      'hover:bg-accent hover:text-accent-foreground',
                      opt.value === value && 'bg-accent/50 font-medium'
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.value === value && (
                      <span className="absolute right-2 flex size-3.5 items-center justify-center">
                        <Check className="size-4" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}

// Number

interface NumberProps {
  id: string; label?: string; value?: number
  min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean
  onAction?: PluginAction
}

export function Number({ id, label, value: initial = 0, min = 0, max, step = 1, suffix, disabled, onAction }: NumberProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [value, setValue] = React.useState(String(initial ?? ''))
  React.useEffect(() => { setValue(String(initial ?? '')) }, [initial])

  const notify = React.useCallback((nextStr: string) => {
    setValue(nextStr)
    const num = parseFloat(nextStr)
    onAction?.({ formId: id, action: 'change', values: { value: isNaN(num) ? nextStr : num } })
  }, [id, onAction])

  const applyStep = React.useCallback((multiplier: number) => {
    const current = parseFloat(value) || 0
    let next = current + step * multiplier
    if (max !== undefined) next = Math.min(next, max)
    next = Math.max(min, next)
    const decimals = (step.toString().split('.')[1] || '').length
    notify(next.toFixed(decimals))
  }, [value, step, min, max, notify])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) notify(raw)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); applyStep(1) }
    if (e.key === 'ArrowDown') { e.preventDefault(); applyStep(-1) }
  }

  const btnBase = 'flex-1 flex items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-30'

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={labelCls}>{label}</span>}
      <div className={cn(
        'relative flex items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring/40 focus-within:ring-ring/20 focus-within:ring-1',
        disabled && 'opacity-50'
      )}>
        <input
          type="text" inputMode="numeric" value={value} disabled={disabled}
          onChange={handleChange} onKeyDown={handleKeyDown}
          data-slot="input"
          className="flex-1 min-w-0 border-0 bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed text-sm"
        />
        {suffix && <span className="text-xs text-muted-foreground font-medium select-none mr-1">{suffix}</span>}
        <div className="flex flex-col self-stretch w-[18px] shrink-0 mx-0.5 my-0.5">
          <button type="button" tabIndex={-1} disabled={disabled} onClick={() => applyStep(1)} className={cn(btnBase, 'rounded-t-sm')} aria-label={t('plugin.form.increment')}>
            <ChevronUp className="size-2.5" />
          </button>
          <button type="button" tabIndex={-1} disabled={disabled} onClick={() => applyStep(-1)} className={cn(btnBase, 'rounded-b-sm')} aria-label={t('plugin.form.decrement')}>
            <ChevronDown className="size-2.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Checkbox

interface CheckboxProps {
  id: string; label: string; description?: string; checked?: boolean; disabled?: boolean
  onAction?: PluginAction
}

export function Checkbox({ id, label, description, checked: initial = false, disabled, onAction }: CheckboxProps): React.JSX.Element {
  const [checked, setChecked] = React.useState(initial)
  React.useEffect(() => { setChecked(initial) }, [initial])

  const handleToggle = React.useCallback(() => {
    const next = !checked
    setChecked(next)
    onAction?.({ formId: id, action: 'change', values: { checked: next } })
  }, [checked, id, onAction])

  return (
    <button
      type="button" role="checkbox" aria-checked={checked} disabled={disabled}
      onClick={handleToggle}
      className="group flex items-center justify-between gap-4 w-full outline-none disabled:opacity-50"
    >
      <div className="flex flex-col gap-0.5 text-left min-w-0">
        <span className="text-[13px] font-medium select-none">{label}</span>
        {description && <span className={descCls}>{description}</span>}
      </div>
      <span className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border border-input shadow-xs transition-colors',
        checked && 'bg-primary border-primary',
        'group-focus-visible:border-ring/40 group-focus-visible:ring-ring/20 group-focus-visible:ring-1'
      )}>
        {checked && (
          <motion.span
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <Check className="size-3 text-primary-foreground" />
          </motion.span>
        )}
      </span>
    </button>
  )
}

// Switch

interface SwitchProps {
  id: string; label?: string; description?: string; checked?: boolean; disabled?: boolean
  onAction?: PluginAction
}

export function Switch({ id, label, description, checked: initial = false, disabled, onAction }: SwitchProps): React.JSX.Element {
  const [checked, setChecked] = React.useState(initial)
  React.useEffect(() => { setChecked(initial) }, [initial])

  const handleToggle = () => {
    const next = !checked
    setChecked(next)
    onAction?.({ formId: id, action: 'change', values: { checked: next } })
  }

  return (
    <div className="flex items-center justify-between gap-4">
      {(label || description) && (
        <div className="flex flex-col gap-0.5">
          {label && <span className="text-[13px] font-medium">{label}</span>}
          {description && <span className={descCls}>{description}</span>}
        </div>
      )}
      <button
        type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={handleToggle}
        className={cn(
          'peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none',
          'focus-visible:border-ring/40 focus-visible:ring-ring/20 focus-visible:ring-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input dark:bg-input/80'
        )}
      >
        <motion.span
          animate={{ x: checked ? 'calc(100% - 2px)' : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={cn(
            'pointer-events-none block size-4 rounded-full bg-background ring-0',
            !checked && 'dark:bg-foreground'
          )}
        />
      </button>
    </div>
  )
}

// ToggleGroup

interface ToggleGroupProps {
  id: string; label?: string; value: string[]
  options: { value: string; label: string }[]; disabled?: boolean
  onAction?: PluginAction
}

export function ToggleGroup({ id, label, value, options, disabled, onAction }: ToggleGroupProps): React.JSX.Element {
  const [selected, setSelected] = React.useState<string[]>(value)
  React.useEffect(() => { setSelected(value) }, [value])

  const handleChange = React.useCallback((next: string[]) => {
    setSelected(next)
    onAction?.({ formId: id, action: 'change', values: { value: next } })
  }, [id, onAction])

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={labelCls}>{label}</span>}
      <ShadcnToggleGroup
        type="multiple"
        variant="outline"
        value={selected}
        onValueChange={handleChange}
        disabled={disabled}
        className="self-start gap-1.5 [&>button]:h-7 [&>button]:px-2 [&>button]:text-xs [&>button]:min-w-0"
      >
          {options.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value}>
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ShadcnToggleGroup>
    </div>
  )
}

// RadioGroup

interface RadioGroupProps {
  id: string; label?: string; value?: string
  options: { value: string; label: string; description?: string }[]; disabled?: boolean
  onAction?: PluginAction
}

export function RadioGroup({ id, label, value: initial = '', options, disabled, onAction }: RadioGroupProps): React.JSX.Element {
  const [value, setValue] = React.useState(initial)
  React.useEffect(() => { setValue(initial) }, [initial])

  const handleChange = React.useCallback((next: string) => {
    setValue(next)
    onAction?.({ formId: id, action: 'change', values: { value: next } })
  }, [id, onAction])

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={labelCls}>{label}</span>}
      <div className="flex flex-col gap-1">
        {options.map((opt) => (
          <button
            key={opt.value} type="button" role="radio"
            aria-checked={opt.value === value} disabled={disabled}
            onClick={() => handleChange(opt.value)}
            className={cn(
              'group flex items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors',
              opt.value === value ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-accent/50',
              'focus-visible:border-ring/40 focus-visible:ring-ring/20 focus-visible:ring-1',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            <span className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border shadow-xs transition-colors',
              opt.value === value ? 'border-primary border-[5px]' : 'border-input'
            )} />
            <div className="flex flex-col gap-0.5">
              <span className={cn('text-[13px] font-medium', opt.value === value && 'text-foreground')}>
                {opt.label}
              </span>
              {opt.description && <span className={descCls}>{opt.description}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// Button

interface ButtonProps {
  id: string; label: string
  variant?: 'default' | 'primary' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  action: string; disabled?: boolean
  onAction?: PluginAction
}

export function Button({ id, label, variant = 'default', action, disabled, onAction }: ButtonProps): React.JSX.Element {
  const handleClick = React.useCallback(() => {
    onAction?.({ formId: id, action, values: {} })
  }, [id, action, onAction])

  return (
    <ShadcnButton
      variant={variant === 'primary' ? 'default' : variant}
      disabled={disabled}
      onClick={handleClick}
      className="self-start"
    >
      {label}
    </ShadcnButton>
  )
}

// TagList

interface TagListProps {
  id: string
  label?: string
  tags: { key: string; label: string; description?: string; badge?: string; badgeVariant?: string; loading?: boolean }[]
  max?: number
  emptyText?: string
  addPanel?: React.ReactNode
  onAction: PluginAction
}

const badgeVariantCls: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  destructive: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
}

export function TagList({ id, label, tags, max, emptyText, addPanel, onAction }: TagListProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const orderedKeys = React.useMemo(() => tags.map(t => t.key), [tags])

  const handleReorder = React.useCallback(
    (reordered: string[]) => {
      onAction({ formId: id, action: 'reorder', values: { orderedKeys: reordered } })
    },
    [id, onAction]
  )

  const handleRemove = React.useCallback(
    (tagKey: string) => {
      onAction({ formId: id, action: 'remove-tag', values: { tagKey } })
    },
    [id, onAction]
  )

  const count = tags.length
  const isFull = max !== undefined && count >= max
  const [addOpen, setAddOpen] = React.useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        {label && <span className={labelCls}>{label}</span>}
        <div className="flex items-center gap-1.5">
          {max !== undefined && (
            <span className={cn('text-[11px] font-medium tabular-nums', isFull ? 'text-destructive' : 'text-muted-foreground')}>
              {count}/{max}
            </span>
          )}
          {addPanel && !isFull && (
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <ShadcnButton variant="ghost" size="icon-xs" aria-label={t('plugin.form.add')}>
                  <Plus className="size-3.5" />
                </ShadcnButton>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" sideOffset={8} className="w-72 p-3">
                {addPanel}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Tag list or empty state */}
      {tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
          <ListFilter className="size-8 text-muted-foreground/40" />
          <span className="text-[13px] text-muted-foreground">{emptyText || t('plugin.form.noItems')}</span>
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={orderedKeys}
          onReorder={handleReorder}
          className="flex flex-col gap-1.5"
        >
          {tags.map((tag) => (
            <Reorder.Item
              key={tag.key}
              value={tag.key}
              className={cn(
                'group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors',
                'hover:border-border/80',
                !tag.loading && 'cursor-grab active:cursor-grabbing'
              )}
              whileDrag={{
                scale: 1.02,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                borderColor: 'hsl(var(--ring))',
                zIndex: 50,
              }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              layout
            >
              {/* Content */}
              <div className="flex-1 min-w-0 flex items-center gap-2.5">
                {tag.loading ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
                <span className="text-[13px] font-medium truncate">{tag.label}</span>
                {tag.description && (
                  <span className="text-[12px] text-muted-foreground truncate hidden sm:inline">
                    {tag.description}
                  </span>
                )}
                {tag.badge && (
                  <span
                    className={cn(
                      'shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      badgeVariantCls[tag.badgeVariant ?? 'neutral'] ?? badgeVariantCls.neutral
                    )}
                  >
                    {tag.badge}
                  </span>
                )}
              </div>

              {/* Remove button — visible only on hover */}
              {!tag.loading && (
                <button
                  type="button"
                  onClick={() => handleRemove(tag.key)}
                  className="shrink-0 inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                  aria-label={t('plugin.form.remove')}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}
    </div>
  )
}

// SearchInput

interface SearchInputProps {
  id: string
  label?: string
  placeholder?: string
  searchAction: string
  minQueryLength?: number
  debounceMs?: number
  results?: { key: string; title: string; subtitle?: string; badge?: string; badgeVariant?: string; disabled?: boolean; disabledReason?: string }[]
  resultsLoading?: boolean
  emptyText?: string
  disabled?: boolean
  disabledReason?: string
  addButtonText?: string
  addedText?: string
  searchingText?: string
  minQueryText?: string
  onAction: (data: { formId: string; action: string; values: Record<string, unknown> }) => void
}

export function SearchInput({
  id,
  label,
  placeholder,
  searchAction,
  minQueryLength = 2,
  debounceMs = 300,
  results,
  resultsLoading,
  emptyText,
  disabled: inputDisabled,
  disabledReason,
  addButtonText,
  addedText,
  searchingText,
  minQueryText,
  onAction,
}: SearchInputProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [query, setQuery] = React.useState('')
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const submittedRef = React.useRef(false)

  const queryLen = query.trim().length
  const belowMin = queryLen > 0 && queryLen < minQueryLength

  // Debounced search emission
  const emitSearch = React.useCallback(
    (q: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        submittedRef.current = true
        onAction({ formId: id, action: searchAction, values: { query: q } })
      }, debounceMs)
    },
    [id, searchAction, debounceMs, onAction]
  )

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    submittedRef.current = false
    if (val.trim().length >= minQueryLength) {
      emitSearch(val.trim())
    } else {
      if (timerRef.current) clearTimeout(timerRef.current)
      onAction({ formId: id, action: searchAction, values: { query: '' } })
    }
  }

  const handleSelect = (key: string) => {
    onAction({ formId: id, action: 'select-result', values: { key } })
    setQuery('')
    submittedRef.current = false
  }

  const handleFocus = () => {
    // Re-emit search if we have a valid query already (e.g. re-focus after outside click)
    if (queryLen >= minQueryLength) {
      emitSearch(query.trim())
    }
  }

  // Clear query on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setQuery('')
        submittedRef.current = false
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Dropdown visible only when there's content to show
  const showDropdown = !inputDisabled && (resultsLoading || queryLen > 0)

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
      {label && <span className={labelCls}>{label}</span>}

      <div className="relative">
        {/* Input */}
        <div
          className={cn(
            inputBaseCls,
            'flex h-9 items-center gap-2 px-3 py-1 text-sm',
            inputDisabled && 'opacity-50'
          )}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={handleFocus}
            placeholder={inputDisabled && disabledReason ? disabledReason : placeholder}
            disabled={inputDisabled}
            data-slot="input"
            className="flex-1 min-w-0 border-0 bg-transparent px-0 py-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed text-sm"
          />
        </div>

        {/* Dropdown */}
        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setQuery(''); submittedRef.current = false }} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            >
              <div className="max-h-60 overflow-y-auto">
                {/* Loading state */}
                {resultsLoading && (
                  <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>{searchingText || t('plugin.form.searching')}</span>
                  </div>
                )}

                {/* Below min query */}
                {!resultsLoading && belowMin && (
                  <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                    {minQueryText
                      ? minQueryText.replace('{n}', String(minQueryLength))
                      : t('plugin.form.enterMinChars', { count: minQueryLength })
                    }
                  </div>
                )}

                {/* Empty results — only shown after search submitted */}
                {!resultsLoading && !belowMin && submittedRef.current && (!results || results.length === 0) && (
                  <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                    {emptyText || t('plugin.form.noResults')}
                  </div>
                )}

                {/* Results — only shown after search submitted */}
                {!resultsLoading && !belowMin && submittedRef.current && results && results.length > 0 && (
                  <div className="p-1">
                    {results.map((item) => (
                      <div
                        key={item.key}
                        className={cn(
                          'flex items-center gap-2 rounded-sm px-2 py-1.5',
                          !item.disabled && 'hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        {/* Content */}
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-[13px] font-medium truncate">{item.title}</span>
                          {item.subtitle && (
                            <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                              {item.subtitle}
                            </span>
                          )}
                          {item.badge && (
                            <span
                              className={cn(
                                'shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                badgeVariantCls[item.badgeVariant ?? 'neutral'] ?? badgeVariantCls.neutral
                              )}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>

                        {/* Action */}
                        {item.disabled ? (
                          <span className="shrink-0 text-[11px] text-muted-foreground/50 px-1">
                            {item.disabledReason || addedText || t('plugin.form.added')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelect(item.key)}
                            className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Plus className="size-3" />
                            {addButtonText || t('plugin.form.add')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
