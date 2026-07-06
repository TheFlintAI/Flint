import { type Components } from 'react-markdown'
import * as React from 'react'
import { MONO_FONT } from '@/lib/utils/fonts'
import { LazySyntaxHighlighter } from '@/components/chat/LazySyntaxHighlighter'
import { CopyButton } from '@/components/chat/assistant/ActionBar'
import {
  isMarkdownCodeBlock,
  resolveLocalFilePath,
  openLocalFilePath
} from '@/lib/utils/markdown-utils'
import { useTranslation } from 'react-i18next'
import { CodeBlockFallback } from '@/components/ui/lazy-fallback'

const MermaidBlock = React.lazy(() =>
  import('@/components/chat/assistant/MermaidBlock').then(m => ({ default: m.MermaidBlock }))
)

/**
 * Unified code renderer for react-markdown.
 *
 * Three rendering paths:
 * 1. Inline code — styled `<code>` tag, clickable if it looks like a local file path
 * 2. Mermaid code block  — delegates to {@link MermaidBlock}
 * 3. Other code blocks   — syntax highlighting via {@link LazySyntaxHighlighter},
 *    or plain `<pre>` for unsupported languages
 */
export function MarkdownCode({
  children,
  className,
  node,
  filePath
}: {
  children: React.ReactNode
  className?: string
  node?: { position?: { start?: { line?: number }; end?: { line?: number } } }
  /** Base directory for resolving relative file paths in inline code */
  filePath?: string
}): React.JSX.Element {
  const rawCode = String(children ?? '')
  const code = rawCode.replace(/\n$/, '')
  const match = /language-([\w-]+)/.exec(className || '')
  const language = match?.[1]
  const { t } = useTranslation('chat')

  // Inline code (no language class, single line)
  if (!match && !className && !isMarkdownCodeBlock(rawCode, node)) {
    const resolvedPath = resolveLocalFilePath(code, filePath)
    if (resolvedPath) {
      return (
        <button
          type="button"
          className="cursor-pointer rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono text-primary underline-offset-2 hover:underline transition-colors"
          style={{ fontFamily: MONO_FONT }}
          title={resolvedPath}
          onClick={() => {
            void openLocalFilePath(code, filePath)
          }}
        >
          {children}
        </button>
      )
    }
    return (
      <code
        className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground/85"
        style={{ fontFamily: MONO_FONT }}
      >
        {children}
      </code>
    )
  }

  // Mermaid
  if (language?.toLowerCase() === 'mermaid') {
    return (
      <React.Suspense fallback={<CodeBlockFallback />}>
        <MermaidBlock code={code} />
      </React.Suspense>
    )
  }

  // Syntax-highlighted code block
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg bg-muted/45">
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55">
          {language || t('codeBlock.textFallback')}
        </span>
        <div className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <CopyButton text={code} />
        </div>
      </div>
      <LazySyntaxHighlighter
        language={language || t('codeBlock.textFallback')}
        customStyle={{
          margin: 0,
          padding: '2px 16px 14px',
          fontSize: '12.5px',
          lineHeight: '1.6',
          background: 'transparent',
          fontFamily: MONO_FONT,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
        codeTagProps={{
          style: {
            fontFamily: 'inherit',
            fontSize: 'inherit'
          }
        }}
      >
        {code}
      </LazySyntaxHighlighter>
    </div>
  )
}

/**
 * Returns a {@link MarkdownCode} component bound to the given `filePath`,
 * suitable for passing directly to react-markdown's `components.code`.
 */
export function createMarkdownCodeComponent(
  filePath?: string
): NonNullable<Components['code']> {
  return function MarkdownCodeComponent({ children, className, node }) {
    return (
      <MarkdownCode className={className} node={node} filePath={filePath}>
        {children}
      </MarkdownCode>
    )
  }
}
