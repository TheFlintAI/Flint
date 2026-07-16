import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { MONO_FONT } from '@/lib/utils/fonts'
import { decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { OutputPre, CopyButton } from './parts'
import { useUIStore } from '@/stores/ui-store'

export type SearchOutputMeta = {
  truncated: boolean
  timedOut: boolean
  limitReason?: string | null
  warnings: string[]
  filesSkipped?: number
  error?: string
}

export type SearchVisualState = 'found' | 'empty' | 'warning' | 'error'

export type ParsedGrepEntry = {
  file: string
  line?: number
  column?: number
  text: string
  kind?: 'match' | 'context'
  count?: number
}

// ── Highlight text ───────────────────────────────────────────────────

export function HighlightText({
  text,
  pattern
}: {
  text: string
  pattern?: string
}): React.JSX.Element {
  if (!pattern) return <>{text}</>
  let parts: string[] | null = null
  try {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(${escaped})`, 'gi')
    parts = text.split(re)
  } catch {
    parts = null
  }
  if (!parts || parts.length <= 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="rounded-sm bg-amber-200/70 px-px text-amber-900 dark:bg-amber-500/25 dark:text-amber-200"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMeta(rawMeta: unknown): SearchOutputMeta {
  if (!isRecord(rawMeta)) {
    return { truncated: false, timedOut: false, warnings: [] }
  }
  return {
    truncated: rawMeta.truncated === true,
    timedOut: rawMeta.timedOut === true,
    limitReason: typeof rawMeta.limitReason === 'string' ? rawMeta.limitReason : null,
    warnings: Array.isArray(rawMeta.warnings)
      ? rawMeta.warnings.filter((w): w is string => typeof w === 'string')
      : [],
    filesSkipped: typeof rawMeta.filesSkipped === 'number' ? rawMeta.filesSkipped : undefined
  }
}

// ── Parsers ──────────────────────────────────────────────────────────

export function parseStructuredGrepEntry(item: unknown): ParsedGrepEntry | null {
  if (!isRecord(item)) return null
  const file =
    typeof item.file === 'string' ? item.file : typeof item.path === 'string' ? item.path : null
  if (!file) return null
  return {
    file,
    line: typeof item.line === 'number' ? item.line : undefined,
    column: typeof item.column === 'number' ? item.column : undefined,
    text: typeof item.text === 'string' ? item.text : '',
    kind: item.kind === 'context' ? 'context' : 'match',
    count: typeof item.count === 'number' ? item.count : undefined
  }
}

export function parseGrepOutput(output: string): {
  matches: ParsedGrepEntry[]
  meta: SearchOutputMeta
  output?: string
} | null {
  const decoded = decodeStructuredToolResult(output)
  if (!decoded) {
    if (output.trim().length === 0) return null
    // Plain text output (compact form)
    return {
      matches: [],
      meta: { truncated: false, timedOut: false, warnings: [] },
      output
    }
  }

  // Compact form: array of matches
  if (Array.isArray(decoded)) {
    return {
      matches: decoded.map(parseStructuredGrepEntry).filter(Boolean) as ParsedGrepEntry[],
      meta: { truncated: false, timedOut: false, warnings: [] }
    }
  }

  if (!isRecord(decoded)) return null

  const rawOutput = typeof decoded.output === 'string' ? decoded.output : undefined
  const matches: unknown[] = Array.isArray(decoded.matches) ? decoded.matches : []
  const rawMeta = isRecord(decoded.meta) ? decoded.meta : decoded

  return {
    matches: matches.map(parseStructuredGrepEntry).filter(Boolean) as ParsedGrepEntry[],
    meta: normalizeMeta(rawMeta),
    output: rawOutput
  }
}

export function parseGlobOutput(output: string): {
  matches: string[]
  meta: SearchOutputMeta
} | null {
  const decoded = decodeStructuredToolResult(output)
  if (!decoded) return null

  // Compact form: array of paths
  if (Array.isArray(decoded)) {
    return {
      matches: decoded.filter((p): p is string => typeof p === 'string'),
      meta: { truncated: false, timedOut: false, warnings: [] }
    }
  }

  if (!isRecord(decoded)) return null

  const matches: unknown[] = Array.isArray(decoded.matches) ? decoded.matches : []
  const rawMeta = isRecord(decoded.meta) ? decoded.meta : decoded

  return {
    matches: matches.filter((p): p is string => typeof p === 'string'),
    meta: normalizeMeta(rawMeta)
  }
}

// ── Visual state ─────────────────────────────────────────────────────

export function getSearchVisualState(meta: SearchOutputMeta, matchCount: number): SearchVisualState {
  if (meta.warnings.length > 0 && matchCount === 0) return 'error'
  if (meta.truncated || meta.timedOut || meta.warnings.length > 0) return 'warning'
  if (matchCount > 0) return 'found'
  return 'empty'
}

export function SearchStateBadge({ state }: { state: SearchVisualState }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const config =
    state === 'error'
      ? {
          label: t('toolCall.searchState.error'),
          className: 'border-destructive/30 bg-destructive/10 text-destructive'
        }
      : state === 'warning'
        ? {
            label: t('toolCall.searchState.warning'),
            className: 'border-amber-400/30 bg-amber-400/10 text-amber-500'
          }
        : state === 'found'
          ? {
              label: t('toolCall.searchState.found'),
              className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-500'
            }
          : {
              label: t('toolCall.searchState.noMatches'),
              className: 'border-muted-foreground/20 bg-muted/40 text-muted-foreground'
            }

  return (
    <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-medium', config.className)}>
      {config.label}
    </span>
  )
}

// ── Hints and empty state ────────────────────────────────────────────

export function SearchMetaHint({ meta }: { meta: SearchOutputMeta }): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const notes: string[] = [
    meta.truncated
      ? t('toolCall.searchState.truncated', {
          reason: meta.limitReason ? `: ${meta.limitReason}` : ''
        })
      : '',
    meta.timedOut ? t('toolCall.searchState.timedOut') : '',
    meta.filesSkipped ? t('toolCall.searchState.filesSkipped', { count: meta.filesSkipped }) : '',
    ...meta.warnings
  ].filter(Boolean)

  if (notes.length === 0) return null

  return (
    <div className="mb-1 text-[10px] text-amber-600/80 dark:text-amber-400/80">
      {notes.join(' · ')}
    </div>
  )
}

export function SearchEmptyState(): React.JSX.Element {
  const { t } = useTranslation('chat')
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
      {t('toolCall.searchState.noMatches')}
    </div>
  )
}

// ── Grep output block ────────────────────────────────────────────────

export function GrepOutputBlock({
  output,
  pattern
}: {
  output: string
  pattern?: string
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const parsed = React.useMemo(() => parseGrepOutput(output), [output])

  const groups = React.useMemo(() => {
    if (!parsed) return []
    const map = new Map<string, Array<{ line?: number; column?: number; text: string; count?: number }>>()
    for (const r of parsed.matches) {
      const list = map.get(r.file) ?? []
      list.push({ line: r.line, column: r.column, text: r.text, count: r.count })
      map.set(r.file, list)
    }
    return Array.from(map.entries())
  }, [parsed])

  if (!parsed) return <OutputPre text={output} />
  if (parsed.matches.length === 0 && parsed.output?.trim()) {
    return <OutputPre text={parsed.output} />
  }

  return (
    <div>
      <div className="relative group/sr">
        <div className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover/sr:opacity-100">
          <CopyButton text={output} />
        </div>
        <SearchMetaHint meta={parsed.meta} />
        {groups.length === 0 ? (
          <SearchEmptyState />
        ) : (
          <div
            className="max-h-72 overflow-auto text-[11px] font-mono"
            style={{ fontFamily: MONO_FONT }}
          >
            {groups.map(([file, matches]) => (
              <div key={file} className="px-3 py-1.5">
                <div
                  className="mb-0.5 cursor-pointer truncate text-sky-600 transition-colors hover:text-sky-700 dark:text-blue-400/70 dark:hover:text-blue-300"
                  title={t('toolCall.clickToInsert', { path: file })}
                  onClick={() => {
                    const short = file.split(/[\\/]/).slice(-2).join('/')
                    useUIStore.getState().setPendingInsertText(short)
                  }}
                >
                  {file.split(/[\\/]/).slice(-3).join('/')}
                </div>
                {matches.map((m, i) => (
                  <div key={i} className="flex gap-2 text-foreground/70 dark:text-zinc-400">
                    <span className="w-12 shrink-0 select-none text-right text-muted-foreground/70 dark:text-zinc-600">
                      {typeof m.count === 'number'
                        ? m.count
                        : typeof m.line === 'number'
                          ? m.column
                            ? `${m.line}:${m.column}`
                            : m.line
                          : ''}
                    </span>
                    <span className="truncate">
                      {m.text ? <HighlightText text={m.text} pattern={pattern} /> : null}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Glob output block ────────────────────────────────────────────────

export function GlobOutputBlock({ output }: { output: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const maxVisibleItems = 200
  const parsed = React.useMemo(() => parseGlobOutput(output), [output])
  if (!parsed) return <OutputPre text={output} />
  const visibleItems = parsed.matches.slice(0, maxVisibleItems)
  const hiddenCount = Math.max(0, parsed.matches.length - visibleItems.length)

  return (
    <div>
      <div className="relative group/sr">
        <div className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover/sr:opacity-100">
          <CopyButton text={parsed.matches.join('\n')} />
        </div>
        <SearchMetaHint meta={parsed.meta} />
        {visibleItems.length === 0 ? (
          <SearchEmptyState />
        ) : (
          <div
            className="max-h-48 space-y-0.5 overflow-auto px-1 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-400"
            style={{ fontFamily: MONO_FONT }}
          >
            {visibleItems.map((p, i) => (
              <div
                key={i}
                className="cursor-pointer truncate text-sky-600 transition-colors hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
                title={t('toolCall.clickToInsert', { path: p })}
                onClick={() => {
                  const short = p.split(/[\\/]/).slice(-2).join('/')
                  useUIStore.getState().setPendingInsertText(short)
                }}
              >
                {p}
              </div>
            ))}
            {hiddenCount > 0 ? (
              <div className="pt-1 text-[10px] text-muted-foreground">
                {t('toolCall.moreResultsHidden', { shown: visibleItems.length, hidden: hiddenCount })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
