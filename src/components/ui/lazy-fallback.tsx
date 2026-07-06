import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

// Page / panel — spinner (full-area centered)

function PageFallback(): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Spinner className="size-5" />
    </div>
  )
}

function PanelFallback(): React.JSX.Element {
  return <PageFallback />
}

// Content block — skeleton (matches the loaded content's shape)

/** Mermaid / syntax-highlighted code block placeholder. */
function CodeBlockFallback(): React.JSX.Element {
  return <Skeleton className="my-3 h-40 w-full" />
}

/** Diff viewer placeholder (ChangesCard, fs-tool). */
function DiffFallback(): React.JSX.Element {
  return <Skeleton className="h-24 w-full" />
}

/** Terminal emulator placeholder (BashOutputBlock). */
function TerminalFallback(): React.JSX.Element {
  return <Skeleton className="h-[320px] w-full bg-black/80" />
}

/** Multi-line text placeholder for message/content loading. */
function TextLinesFallback({ lines = 3 }: { lines?: number }): React.JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${100 - (i * 15 + (i > 0 ? 10 : 0))}%` }}
        />
      ))}
    </div>
  )
}

/** Inline element placeholder — tiny skeleton for button/icon loading. */
function InlineFallback({ className }: { className?: string }): React.JSX.Element {
  return <Skeleton className={className} />
}

export {
  PageFallback,
  PanelFallback,
  CodeBlockFallback,
  DiffFallback,
  TerminalFallback,
  TextLinesFallback,
  InlineFallback,
}
