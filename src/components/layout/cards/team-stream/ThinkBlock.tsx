import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

// Sidebar-native thinking block: a borderless inline trigger aligned with the
// other activity rows, expanding to a muted plain-text body. No bordered box
// (the member block is the only container), no markdown prose.
export const ThinkBlock = memo(function ThinkBlock({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const hasContent = text.trim().length > 0
  const [open, setOpen] = useState(streaming)
  const prevStreamingRef = useRef(streaming)

  // Auto-expand while actively thinking; collapse shortly after it settles.
  useEffect(() => {
    if (streaming) {
      setOpen(true)
    } else if (prevStreamingRef.current && !streaming && hasContent) {
      const timer = setTimeout(() => setOpen(false), 800)
      prevStreamingRef.current = streaming
      return () => clearTimeout(timer)
    }
    prevStreamingRef.current = streaming
  }, [streaming, hasContent])

  if (!streaming && !hasContent) return null

  const label = streaming ? t('thinking.thinkingEllipsis') : t('thinking.thoughts')

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger
        disabled={streaming}
        className={cn(
          'group flex w-full items-center gap-1.5 text-left text-[10px] text-muted-foreground/70',
          'transition-colors hover:text-muted-foreground',
        )}
      >
        <Brain className="size-3 shrink-0 text-muted-foreground/55" />
        <span className={cn('font-medium', streaming && 'shimmer')}>{label}</span>
        {open ? (
          <ChevronDown className="ml-auto size-3 shrink-0 text-muted-foreground/40" />
        ) : (
          <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground/40" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-0.5 pl-4 text-[10px] leading-relaxed text-muted-foreground/65 whitespace-pre-wrap break-words">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

ThinkBlock.displayName = 'ThinkBlock'
