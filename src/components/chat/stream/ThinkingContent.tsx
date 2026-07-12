import { memo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown, { type Components } from 'react-markdown'
import {
  openMarkdownHref,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
} from '@/lib/utils/markdown-utils'
import { createMarkdownCodeComponent } from '@/components/chat/assistant/MarkdownCodeRenderer'
import { useStreamingRenderPool } from '@/hooks/use-typewriter'
import { Spinner } from '@/components/ui/spinner'

const THINKING_MD_COMPONENTS: Components = {
  code: createMarkdownCodeComponent(),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
      onClick={(event) => {
        if (!href) return
        const handled = openMarkdownHref(href)
        if (handled) event.preventDefault()
      }}
    >
      {children}
    </a>
  )
}

export interface ThinkingContentProps {
  thinking: string
  isStreaming?: boolean
  startedAt?: number
  completedAt?: number
}

/** Shared thinking body: streaming typewriter, settled markdown, or pending spinner. */
export const ThinkingContent = memo(function ThinkingContent({
  thinking,
  isStreaming = false,
  startedAt,
  completedAt,
}: ThinkingContentProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isThinking = isStreaming && !completedAt
  const renderPool = useStreamingRenderPool(thinking, isThinking)
  const hasThinkingContent = thinking.trim().length > 0
  const [liveElapsed, setLiveElapsed] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isThinking || !startedAt) return
    const tick = (): void => setLiveElapsed((Date.now() - startedAt) / 1000)
    tick()
    const interval = setInterval(tick, 100)
    return () => clearInterval(interval)
  }, [isThinking, startedAt])

  useEffect(() => {
    if (!isThinking || !hasThinkingContent || !contentRef.current) return
    contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [hasThinkingContent, isThinking, renderPool.text])

  if (hasThinkingContent) {
    return (
      <div ref={contentRef} className="max-h-80 overflow-y-auto">
        {isThinking ? (
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            {renderPool.text}
          </div>
        ) : (
          <div className="typeset typeset-chat">
            <Markdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
              components={THINKING_MD_COMPONENTS}
            >
              {thinking}
            </Markdown>
          </div>
        )}
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-1">
      <Spinner className="size-3.5" />
      <span className="text-[12px] text-muted-foreground/70">
        {t('thinking.pending', { defaultValue: 'Thinking' })}
      </span>
      {liveElapsed > 0 && (
        <span className="text-[10px] text-muted-foreground/40">
          {t('thinking.secondsShort', { seconds: liveElapsed.toFixed(1) })}
        </span>
      )}
    </div>
  )
})

ThinkingContent.displayName = 'ThinkingContent'
