import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextEditorHandle {
  focus: () => void
  focusAtEnd: () => void
  getSelection: () => { start: number; end: number }
  setSelection: (start: number, end?: number) => void
  clear: () => void
}

interface TextEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>
  onDrop?: React.DragEventHandler<HTMLTextAreaElement>
  onDragOver?: React.DragEventHandler<HTMLTextAreaElement>
  onDragLeave?: React.DragEventHandler<HTMLTextAreaElement>
  onFocus?: () => void
  onBlur?: () => void
  className?: string
}

export const TextEditor = React.forwardRef<TextEditorHandle, TextEditorProps>(
  function TextEditor(
    {
      value,
      onChange,
      disabled = false,
      placeholder,
      minHeight = 120,
      maxHeight,
      onKeyDown,
      onPaste,
      onDrop,
      onDragOver,
      onDragLeave,
      onFocus,
      onBlur,
      className
    },
    ref
  ) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const compositionRef = React.useRef(false)

    React.useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus()
      },
      focusAtEnd: () => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      },
      getSelection: () => ({
        start: textareaRef.current?.selectionStart ?? 0,
        end: textareaRef.current?.selectionEnd ?? 0
      }),
      setSelection: (start, end = start) => {
        const el = textareaRef.current
        if (!el) return
        el.setSelectionRange(start, end)
      },
      clear: () => {
        onChange('')
      }
    }))

    // Auto-resize
    React.useEffect(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      const scrollH = el.scrollHeight
      let targetH = Math.max(minHeight, scrollH)
      if (maxHeight) targetH = Math.min(targetH, maxHeight)
      el.style.height = `${targetH}px`
    }, [value, minHeight, maxHeight])

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value)
      },
      [onChange]
    )

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (compositionRef.current && e.key === 'Enter') {
          // Let IME handle composition
          return
        }
        onKeyDown?.(e)
      },
      [onKeyDown]
    )

    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onCompositionStart={() => {
          compositionRef.current = true
        }}
        onCompositionEnd={() => {
          compositionRef.current = false
        }}
        className={cn(
          'composer-textarea block w-full resize-none border-0 bg-transparent p-2 pb-2 pr-3',
          'text-base leading-relaxed outline-none md:text-sm',
          'placeholder:text-muted-foreground/50',
          'min-h-0 min-w-0 flex-1',
          className
        )}
        rows={1}
        spellCheck={false}
        data-gramm="false"
        role="textbox"
        aria-multiline="true"
        style={{ minHeight: `${minHeight}px` }}
      />
    )
  }
)
