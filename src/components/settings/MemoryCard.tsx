import { useState, useCallback, useRef, useEffect } from 'react'
import { Trash2, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MarkdownContent } from '@/components/chat/assistant/MarkdownRenderer'
import { cn } from '@/lib/utils'
import type { MemoryEntry } from '@/protocols/memory-types'
import { MEMORY_TYPE_LABELS } from '@/protocols/memory-types'

interface MemoryCardProps {
  entry: MemoryEntry
  onDelete: (entryId: string) => Promise<void>
}

const TYPE_STYLES: Record<string, { text: string; bg: string }> = {
  preference: { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  decision: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  context: { text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10' },
  reference: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10' },
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  const diffMon = Math.floor(diffDay / 30)
  return `${diffMon}mo ago`
}

// Compact typeset tuning for a narrow masonry card.
const CARD_PROSE_CLASS = cn('typeset', 'typeset-sm')

export function MemoryCard({ entry, onDelete }: MemoryCardProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deleteRef = useRef<HTMLDivElement>(null)

  const typeLabel = t(MEMORY_TYPE_LABELS[entry.type] ?? entry.type, entry.type)
  const typeStyle = TYPE_STYLES[entry.type] ?? TYPE_STYLES.reference
  const hasBody = entry.body.trim().length > 0

  // Close delete confirmation on click outside
  useEffect(() => {
    if (!showDeleteConfirm) return
    const handler = (e: MouseEvent) => {
      if (deleteRef.current && !deleteRef.current.contains(e.target as Node)) {
        setShowDeleteConfirm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDeleteConfirm])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await onDelete(entry.id)
      toast.success(t('memory.deletedToast'))
    } catch {
      toast.error(t('memory.deleteFailed'))
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }, [entry.id, onDelete, t])

  return (
    <article
      className={cn(
        'memory-card group relative rounded-lg border border-border/50 bg-background/40',
        'hover:border-border/80 hover:bg-background/70 transition-all',
        showDeleteConfirm && 'ring-1 ring-destructive/30'
      )}
    >
      <div className="p-4">
        {/* Delete — floats top-right on hover */}
        <button
          type="button"
          className="absolute right-3 top-3 size-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground hover:text-destructive"
          onClick={() => setShowDeleteConfirm(true)}
          title={t('memory.actions.delete', 'Delete')}
        >
          <Trash2 className="size-3.5" />
        </button>

        {/* Markdown body — bounded height, scrolls if long */}
        <div className="scrollbar-auto-hide max-h-[280px] overflow-y-auto">
          {hasBody ? (
            <MarkdownContent text={entry.body} className={CARD_PROSE_CLASS} />
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {t('memory.noContent', '(empty)')}
            </p>
          )}
        </div>

        {/* Footer: type on the left, time on the right */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
              typeStyle.bg,
              typeStyle.text
            )}
          >
            {typeLabel}
          </span>
          <div className="flex-1" />
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <Clock className="size-3" />
            {formatRelativeTime(entry.updated_at)}
          </span>
        </div>

        {/* Inline delete confirmation */}
        {showDeleteConfirm && (
          <div
            ref={deleteRef}
            className="memory-delete-bar mt-3 rounded-md bg-destructive/5 px-3 py-2.5 flex items-center justify-between gap-3"
          >
            <p className="text-xs text-muted-foreground flex-1">
              {t('memory.deleteConfirm', 'Delete this memory? This action cannot be undone.')}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                {t('memory.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                onClick={handleDelete}
                disabled={deleting}
              >
                {t('memory.confirmDelete', 'Delete')}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
