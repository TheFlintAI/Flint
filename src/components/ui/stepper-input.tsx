'use client'

import * as React from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface StepperInputProps extends Omit<React.ComponentProps<'input'>, 'type' | 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  step?: number
  shiftStep?: number
  min?: number
  /** Unit suffix displayed right next to the number, e.g. "K" / "M" */
  suffix?: string
}

function StepperInput({
  className,
  value,
  onChange,
  step = 1,
  shiftStep,
  min = 0,
  disabled,
  suffix,
  ...props
}: StepperInputProps) {
  const { t } = useTranslation('common')
  const effectiveShiftStep = shiftStep ?? step * 10

  const applyStep = React.useCallback(
    (multiplier: number) => {
      const current = parseFloat(value) || 0
      const next = current + step * multiplier
      const clamped = Math.max(min, next)
      // Preserve decimal places from step
      const stepDecimals = (step.toString().split('.')[1] || '').length
      onChange(clamped.toFixed(stepDecimals))
    },
    [value, step, min, onChange]
  )

  const handleClick = (e: React.MouseEvent, direction: 1 | -1) => {
    e.preventDefault()
    const multiplier = e.shiftKey ? effectiveShiftStep / step : 1
    applyStep(direction * multiplier)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      applyStep(e.shiftKey ? effectiveShiftStep / step : 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      applyStep(e.shiftKey ? -(effectiveShiftStep / step) : -1)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      onChange(raw)
    }
  }

  const btnBase =
    'flex-1 flex items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-30'

  return (
    <div
      className={cn(
        'relative flex items-center w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring/40 focus-within:ring-ring/20 focus-within:ring-1',
        disabled && 'opacity-50'
      )}
    >
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        data-slot="input"
        className={cn(
          'flex-1 min-w-0 border-0 bg-transparent px-3 py-1 outline-none',
          'placeholder:text-muted-foreground',
          'disabled:pointer-events-none disabled:cursor-not-allowed',
          className
        )}
        {...props}
      />
      {suffix && (
        <span className="text-xs text-muted-foreground font-medium select-none">
          {suffix}
        </span>
      )}
      <div className="flex flex-col self-stretch w-[18px] shrink-0 mx-0.5 my-0.5">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={(e) => handleClick(e, 1)}
          className={cn(btnBase, 'rounded-t-sm')}
          aria-label={t('stepper.increment')}
        >
          <ChevronUp className="size-2.5" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={(e) => handleClick(e, -1)}
          className={cn(btnBase, 'rounded-b-sm')}
          aria-label={t('stepper.decrement')}
        >
          <ChevronDown className="size-2.5" />
        </button>
      </div>
    </div>
  )
}

export { StepperInput }
