import * as React from 'react'
import Markdown, { type Components } from 'react-markdown'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  openMarkdownHref
} from '@/lib/utils/markdown-utils'
import { useStreamingRenderPool } from '@/hooks/use-typewriter'
import { createMarkdownCodeComponent } from './MarkdownCodeRenderer'
import { cn } from '@/lib/utils'

/**
 * Minimal link handler for react-markdown.
 * Opens external URLs via the system browser; local file paths open in the preview pane.
 */
const MarkdownLink: NonNullable<Components['a']> = ({ href, children }) => (
  <a
    href={href}
    onClick={(e) => {
      if (!href) return
      const handled = openMarkdownHref(href)
      if (handled) e.preventDefault()
    }}
    className="underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 cursor-pointer break-all transition-colors"
    title={href}
  >
    {children}
  </a>
)

/**
 * Renders markdown content with react-markdown.
 *
 * Styling for standard elements (headings, paragraphs, lists, tables, blockquotes,
 * images, etc.) is handled entirely by Tailwind Typography's `prose` class.
 * Only `code` and `a` are overridden for app-specific behavior.
 */
export const MarkdownContent = React.memo(function MarkdownContent({
  text,
  isStreaming: _isStreaming = false,
  className
}: {
  text: string
  isStreaming?: boolean
  className?: string
}): React.JSX.Element {
  const components = React.useMemo<Components>(
    () => ({
      // MarkdownCode owns its own chrome (border + header + highlighter), so the
      // default <pre> wrapper is redundant — and prose would style it into a dark
      // frame nesting the code box. Pass children through directly.
      pre: ({ children }) => <>{children}</>,
      code: createMarkdownCodeComponent(),
      a: MarkdownLink
    }),
    []
  )

  return (
    <div
      className={cn(
        'prose dark:prose-invert max-w-none prose-p:my-3 prose-headings:mt-4 prose-headings:mb-2 prose-ul:my-3 prose-ol:my-3 prose-li:my-0 prose-blockquote:my-3 prose-hr:my-4 prose-table:my-3 prose-img:my-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className
      )}
      style={{
        '--tw-prose-body': 'var(--foreground)',
        '--tw-prose-headings': 'var(--foreground)',
        '--tw-prose-bold': 'var(--foreground)',
        '--tw-prose-links': 'var(--secondary)',
        '--tw-prose-counters': 'var(--muted-foreground)',
        '--tw-prose-bullets': 'var(--muted-foreground)',
        '--tw-prose-quotes': 'var(--foreground)',
        '--tw-prose-hr': 'var(--border)',
        '--tw-prose-invert-body': 'var(--foreground)',
        '--tw-prose-invert-headings': 'var(--foreground)',
        '--tw-prose-invert-bold': 'var(--foreground)',
        '--tw-prose-invert-links': 'var(--secondary)',
        '--tw-prose-invert-counters': 'var(--muted-foreground)',
        '--tw-prose-invert-bullets': 'var(--muted-foreground)',
        '--tw-prose-invert-quotes': 'var(--foreground)',
        '--tw-prose-invert-hr': 'var(--border)'
      } as React.CSSProperties}
    >
      <Markdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  )
})

export function StreamingMarkdownContent({
  text,
  isStreaming
}: {
  text: string
  isStreaming: boolean
}): React.JSX.Element {
  const renderPool = useStreamingRenderPool(text, isStreaming)

  if (!text.trim()) {
    return <div className="break-words leading-relaxed text-foreground">{text}</div>
  }

  if (isStreaming) {
    return (
      <div
        className="contents"
        data-render-pool-size={renderPool.poolSize}
        data-rendered-length={renderPool.renderedLength}
        data-target-length={renderPool.targetLength}
      >
        <MarkdownContent text={renderPool.text} isStreaming={false} />
      </div>
    )
  }

  return <MarkdownContent text={text} isStreaming={false} />
}
