import * as React from 'react'
import { cn } from '@/lib/utils'

interface LayoutProps {
  type: 'grid' | 'row' | 'col' | 'heading' | 'text'
  cols?: number
  text?: string
  children?: React.ReactNode
}

export function Layout({ type, cols, text, children }: LayoutProps): React.JSX.Element {
  switch (type) {
    case 'grid':
      return (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols ?? 2}, minmax(0, 1fr))` }}
        >
          {children}
        </div>
      )

    case 'row':
      return <div className="flex flex-row gap-3">{children}</div>

    case 'col':
      return <div className="flex flex-col gap-3">{children}</div>

    case 'heading':
      return <h3 className="text-[15px] font-semibold">{text ?? ''}</h3>

    case 'text':
      return <p className="text-[13px] text-muted-foreground">{text ?? ''}</p>

    default:
      return <>{children}</>
  }
}
