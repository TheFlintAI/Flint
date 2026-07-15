import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import { Archive, ChevronRight, ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { UnifiedMessage } from '@/lib/api/types'
import { isCompressionMessage, extractMessageText } from '@/lib/agent/compression'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
} from '@/lib/utils/markdown-utils'

interface ContextCompressionMessageProps {
  message: UnifiedMessage
}

function DetailChip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
      {children}
    </span>
  )
}

export function ContextCompressionMessage({
  message,
}: ContextCompressionMessageProps): React.JSX.Element | null {
  const { t } = useTranslation('agent')
  const tokenFormatter = new Intl.NumberFormat()

  if (!isCompressionMessage(message)) return null

  const meta = message.meta?.compression
  const content = extractMessageText(message).trim()
  const hasContent = content.length > 0
  // Content-empty compression message means streaming is in progress
  const isCompressing = !hasContent

  const [open, setOpen] = useState(isCompressing)
  const prevIsCompressingRef = useRef(isCompressing)

  // When compression completes, auto-collapse after a brief delay
  useEffect(() => {
    if (prevIsCompressingRef.current && !isCompressing && open) {
      const timer = setTimeout(() => setOpen(false), 800)
      prevIsCompressingRef.current = isCompressing
      return () => clearTimeout(timer)
    }
    prevIsCompressingRef.current = isCompressing
  }, [isCompressing, open])

  const titleLabel = isCompressing
    ? t('contextCompression.compressing', { defaultValue: 'Compressing context…' })
    : t('contextCompression.compressed', { defaultValue: 'Context compressed' })

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-2 overflow-hidden rounded-md border border-amber-500/25 bg-amber-500/8"
    >
      <CollapsibleTrigger
        className={cn(
          'group flex w-full items-center gap-2 rounded-t-md px-3 py-2 text-left transition-colors hover:bg-amber-500/10',
        )}
      >
        <Archive className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />

        <span className={cn(
          'inline-flex items-center text-[11px] font-medium text-amber-800 dark:text-amber-200',
          isCompressing && 'shimmer',
        )}>
          {titleLabel}
        </span>

        {typeof meta?.preTokens === 'number' && meta.preTokens > 0 ? (
          <DetailChip>
            {t('contextCompression.boundaryPreTokens', {
              defaultValue: '{{tokens}} tokens at trigger',
              tokens: tokenFormatter.format(meta.preTokens)
            })}
          </DetailChip>
        ) : null}

        <span className="ml-auto flex items-center gap-2">
          {typeof meta?.messagesCompressed === 'number' && meta.messagesCompressed > 0 ? (
            <DetailChip>
              {t('contextCompression.boundarySummarized', {
                defaultValue: '{{count}} messages summarized',
                count: meta.messagesCompressed
              })}
            </DetailChip>
          ) : null}
          {open ? (
            <ChevronDown className="size-3 text-amber-500/50 transition-colors group-hover:text-amber-600" />
          ) : (
            <ChevronRight className="size-3 text-amber-500/50 transition-colors group-hover:text-amber-600" />
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {hasContent ? (
          <div className="px-4 py-3 text-sm leading-relaxed typeset typeset-sm">
            <Markdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            >
              {content}
            </Markdown>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3">
            <div className="size-3.5 rounded-full border-2 border-amber-400/40 border-t-amber-500 animate-spin" />
            <span className="text-[12px] text-muted-foreground/70">
              {t('contextCompression.pending', { defaultValue: 'Summarizing conversation…' })}
            </span>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
