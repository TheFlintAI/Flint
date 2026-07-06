import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'
import { Maximize2, Copy, Loader2 } from 'lucide-react'
import { applyMermaidTheme, copyMermaidToClipboard } from '@/lib/chat/mermaid-theme'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

interface MermaidBlockProps {
  code: string
}

export function MermaidBlock({ code }: MermaidBlockProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const renderDiagram = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        applyMermaidTheme()
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`
        const container = document.createElement('div')
        const { svg: resultSvg } = await mermaid.render(id, code.trim(), container)
        if (!cancelled) {
          setSvg(resultSvg)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('mermaid.failedToRender'))
          setLoading(false)
        }
      }
    }
    renderDiagram()
    return () => { cancelled = true }
  }, [code])

  const handleCopyImage = useCallback(async () => {
    try {
      const result = await copyMermaidToClipboard(code, svg ?? undefined)
      toast.success(result === 'image' ? t('mermaid.copiedAsImage') : t('mermaid.copiedAsText'))
    } catch {
      toast.error(t('mermaid.failedToCopy'))
    }
  }, [code, svg])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">{t('mermaid.rendering')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">{t('mermaid.renderFailed')}</p>
        <pre className="mt-2 text-xs text-muted-foreground">{error}</pre>
      </div>
    )
  }

  return (
    <>
      <div className="group relative">
        <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="rounded-md bg-background/80 p-1.5 hover:bg-accent"
            onClick={handleCopyImage}
            title={t('mermaid.copyDiagram')}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md bg-background/80 p-1.5 hover:bg-accent"
            onClick={() => setZoomed(true)}
            title={t('mermaid.zoomIn')}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
        <div
          ref={containerRef}
          className="flex justify-center overflow-x-auto py-2"
          dangerouslySetInnerHTML={{ __html: svg ?? '' }}
        />
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setZoomed(false)}
        >
          <div
            className="max-h-full max-w-full overflow-auto rounded-xl bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex justify-center"
              dangerouslySetInnerHTML={{ __html: svg ?? '' }}
            />
          </div>
        </div>
      )}
    </>
  )
}
