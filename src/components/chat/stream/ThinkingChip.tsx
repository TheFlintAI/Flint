import { memo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, Brain } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ThinkingContent } from './ThinkingContent'

interface ThinkingChipProps {
  thinking: string
  isStreaming?: boolean
  startedAt?: number
  completedAt?: number
}

export const ThinkingChip = memo(function ThinkingChip({
  thinking,
  isStreaming = false,
  startedAt,
  completedAt,
}: ThinkingChipProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const isThinking = isStreaming && !completedAt
  const hasThinkingContent = thinking.trim().length > 0
  const [open, setOpen] = useState(isThinking)
  const prevIsThinkingRef = useRef(isThinking)

  // Auto-expand during streaming, collapse when done
  useEffect(() => {
    if (isThinking) {
      setOpen(true)
    } else if (prevIsThinkingRef.current && !isThinking && hasThinkingContent) {
      // Just finished streaming — keep open briefly then collapse
      const timer = setTimeout(() => setOpen(false), 800)
      prevIsThinkingRef.current = isThinking
      return () => clearTimeout(timer)
    }
    prevIsThinkingRef.current = isThinking
  }, [isThinking, hasThinkingContent])

  if (!isThinking && !hasThinkingContent) return null

  const durationLabel = isThinking
    ? t('thinking.thinkingEllipsis')
    : t('thinking.thoughts')

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        if (isThinking) return
        setOpen(nextOpen)
      }}
      className="overflow-hidden bg-transparent rounded-lg border border-border/40"
    >
      <CollapsibleTrigger
        disabled={isThinking}
        className={cn(
          'group flex w-full items-center gap-2 rounded-t-lg px-3 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50',
        )}
      >
        <span className="flex items-center gap-1.5">
          <Brain className="size-3.5 text-muted-foreground/70" />
          <span className={cn(
            'font-medium text-muted-foreground/80 transition-colors group-hover:text-foreground',
            isThinking && 'shimmer',
          )}>
            {durationLabel}
          </span>
        </span>

        <span className="ml-auto">
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-2.5 text-sm text-muted-foreground/80 leading-relaxed">
          <ThinkingContent
            thinking={thinking}
            isStreaming={isStreaming}
            startedAt={startedAt}
            completedAt={completedAt}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

ThinkingChip.displayName = 'ThinkingChip'
