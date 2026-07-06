import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  openMarkdownHref,
} from '@/lib/utils/markdown-utils'
import { MONO_FONT } from '@/lib/utils/fonts'
import { cn } from '@/lib/utils'

// Sidebar-tuned markdown: same parser pipeline as the chat surface, but
// stripped of `prose` typography and heavy code-block chrome. Sized for a
// ~300px oversight card, not the primary reading pane.

const COMPONENTS: Components = {
  pre: ({ children }) => (
    <pre
      className={cn(
        'my-1 max-h-40 overflow-auto rounded-md bg-muted/35 p-2',
        'text-[10px] leading-relaxed text-foreground/80',
      )}
      style={{ fontFamily: MONO_FONT }}
    >
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const text = String(children ?? '')
    const isBlock = (typeof className === 'string' && className.includes('language-')) || text.includes('\n')
    if (isBlock) return <code>{children}</code>
    return (
      <code
        className="rounded-sm bg-muted/50 px-1 py-px text-[10px] text-foreground/85"
        style={{ fontFamily: MONO_FONT }}
      >
        {children}
      </code>
    )
  },
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2 break-all hover:text-primary/80"
      onClick={(event) => {
        if (!href) return
        if (openMarkdownHref(href)) event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1 mt-2 text-[11px] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-2 text-[11px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1.5 text-[11px] font-semibold">{children}</h3>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-4 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-4 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-border/40 pl-2 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-1.5 border-border/30" />,
  table: ({ children }) => (
    <table className="my-1 block w-full overflow-x-auto text-[10px]">{children}</table>
  ),
  th: ({ children }) => <th className="border border-border/30 px-1.5 py-0.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border/30 px-1.5 py-0.5">{children}</td>,
  img: ({ src, alt }) => <img src={src} alt={alt} className="my-1 max-w-full rounded-md" />,
}

export const MiniMarkdown = memo(function MiniMarkdown({
  text,
}: {
  text: string
}): React.JSX.Element {
  if (!text.trim()) return <span className="text-[11px] text-muted-foreground/50">…</span>
  return (
    <div className="text-[11px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  )
})

MiniMarkdown.displayName = 'MiniMarkdown'
