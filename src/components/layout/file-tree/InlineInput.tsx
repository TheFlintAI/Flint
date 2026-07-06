import { useState, useEffect, useRef } from 'react'
import type React from 'react'

export function InlineInput({
  defaultValue,
  depth,
  icon,
  onConfirm,
  onCancel
}: {
  defaultValue: string
  depth: number
  icon: React.ReactNode
  onConfirm: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    // Auto-focus and select filename without extension
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = defaultValue.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : defaultValue.length)
  }, [defaultValue])

  return (
    <div
      className="flex items-center gap-1 py-[1px] pr-2 text-[12px]"
      style={{ paddingLeft: `${depth * 14 + 4 + 16}px` }}
    >
      {icon}
      <input
        ref={ref}
        className="workspace-filetree-input flex-1 min-w-0 rounded-sm border px-1 py-0 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring/20"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => onCancel()}
      />
    </div>
  )
}
