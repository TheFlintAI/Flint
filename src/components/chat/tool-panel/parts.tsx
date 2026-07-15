import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONO_FONT } from '@/lib/utils/fonts'
import type { ToolCallStatus } from '@/lib/agent/types'
import { getToolIcon } from '@/lib/tools/tool-icon'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { ImagePreview } from '../ImagePreview'
import { getImageBlockPreviewSrc } from './utils'

// --- Tones ---

export type BadgeTone = 'default' | 'blue' | 'amber' | 'green' | 'red'

const TONE_CLASS: Record<BadgeTone, string> = {
  default: 'border-border/60 bg-muted/45 text-muted-foreground',
  blue: 'border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  amber: 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  red: 'border-destructive/25 bg-destructive/10 text-destructive'
}

// --- Icon ---

export function ToolIcon({ name, className }: { name: string; className?: string }): React.JSX.Element {
  const Icon = getToolIcon(name)
  return <Icon className={className ?? 'size-3.5'} />
}

// --- Badges ---

export function Badge({
  children,
  tone = 'default',
  className,
  title
}: {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
  title?: string
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

// --- Run-status pill (owned by the shell, not individual tools) ---

function statusPillTone(status: ToolCallStatus | 'completed'): BadgeTone {
  if (status === 'error') return 'red'
  if (status === 'running') return 'blue'
  if (status === 'awaiting_approval') return 'amber'
  return 'default'
}

export function StatusPill({
  status,
  title,
  toolName,
}: {
  status: ToolCallStatus | 'completed'
  title?: string
  toolName?: string
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  let label: string | null = null
  if (status === 'streaming') {
    if (toolName) {
      const key = `toolCall.streamingLabels.${toolName}`
      const streamLabel = t(key)
      label = streamLabel !== key ? streamLabel : t('toolCall.receivingArgs')
    } else {
      label = t('toolCall.receivingArgs')
    }
  } else if (status === 'running') {
    if (toolName) {
      const key = `toolCall.runningLabels.${toolName}`
      const runLabel = t(key)
      label = runLabel !== key ? runLabel : t('toolCall.executing')
    } else {
      label = t('toolCall.executing')
    }
  } else if (status === 'awaiting_approval') {
    label = t('toolCall.awaitingApproval')
  } else if (status === 'error') label = t('error.label')
  if (!label) return null
  return (
    <Badge tone={statusPillTone(status)} title={title}>
      {label}
    </Badge>
  )
}

// --- Standard leading header cluster (icon + title + subtitle) ---
// Badges are rendered separately by ToolShell at the far right.

export interface ToolPanelLeadProps {
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  titleAttr?: string
}

export function ToolPanelLead({
  icon,
  title,
  subtitle,
  titleAttr
}: ToolPanelLeadProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" title={titleAttr}>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate text-[12px] font-semibold text-foreground/85 transition-colors group-hover:text-foreground">
          {title}
        </span>
        {subtitle ? (
          <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground/60 sm:inline">
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  )
}

// --- Copy button (single source of truth) ---

export function CopyButton({
  text,
  title,
  className
}: {
  text: string
  title?: string
  className?: string
}): React.JSX.Element {
  const { t: tCommon } = useTranslation('common')
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={cn(
        'rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
      title={title ?? tCommon('action.copy')}
    >
      {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
    </button>
  )
}

// --- Input field row (label + value) ---

export function FieldRow({
  label,
  value,
  mono
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="min-w-[70px] shrink-0 select-none text-right text-muted-foreground/50">
        {label}
      </span>
      <span
        className={cn('break-all', mono && 'font-mono text-[11px]')}
        style={mono ? { fontFamily: MONO_FONT } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

// --- Plain output block: code text only, no redundant title ---

export function OutputPre({
  text,
  maxHeightClass = 'max-h-48'
}: {
  text: string
  maxHeightClass?: string
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const [expanded, setExpanded] = React.useState(false)
  const isLong = text.length > 500
  const displayed = isLong && !expanded ? text.slice(0, 500) + '…' : text
  return (
    <div>
      <pre
        className={`${maxHeightClass} overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground/80`}
        style={{ fontFamily: MONO_FONT }}
      >
        {displayed}
      </pre>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? tCommon('action.showLess')
            : t('toolCall.showAll', { chars: text.length, lines: text.split('\n').length })}
        </button>
      ) : null}
    </div>
  )
}

// --- Image output (auto-rendered for tools returning image blocks) ---

export function ImageOutputBlock({
  output
}: {
  output: import('@/lib/api/types').ToolResultContent
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  if (!Array.isArray(output)) return null
  const images = output.filter((b): b is import('@/lib/api/types').ImageBlock => b.type === 'image')
  const notes = output.filter(
    (b): b is import('@/lib/api/types').TextBlock => b.type === 'text' && b.text.trim().length > 0
  )
  if (images.length === 0) return null
  return (
    <div className="space-y-3">
      {images.map((img, i) => {
        const src = getImageBlockPreviewSrc(img)
        if (!src && !img.source.filePath) return null
        return (
          <ImagePreview
            key={`${img.source.filePath ?? img.source.url ?? img.source.data?.slice(0, 48) ?? i}-${i}`}
            src={src}
            alt={t('imagePreview.toolOutput')}
            filePath={img.source.filePath}
          />
        )
      })}
      {notes.length > 0 ? (
        <div className="space-y-1">
          {notes.map((note, index) => (
            <p
              key={`${note.text}-${index}`}
              className="whitespace-pre-wrap break-words rounded-md bg-muted/20 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {note.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// --- Open a URL in the system browser ---

function openExternal(url: string): void {
  void tauriCommands.invoke(TAURI_COMMANDS.SHELL_OPEN_EXTERNAL, url)
}

// --- Clickable link list (WebSearch results, plugin link bodies) ---

export interface LinkItem {
  title: string
  url: string
  snippet?: string
}

export function LinkList({ items }: { items: LinkItem[] }): React.JSX.Element {
  const { t } = useTranslation('chat')
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        {t('toolCall.webSearch.noResults')}
      </div>
    )
  }
  return (
    <ul className="max-h-80 space-y-1 overflow-auto">
      {items.map((r, i) => (
        <li key={`${r.url}-${i}`}>
          <button
            type="button"
            onClick={() => openExternal(r.url)}
            title={t('toolCall.webSearch.open')}
            className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
          >
            <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-sky-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-foreground/85 group-hover:text-sky-600 dark:group-hover:text-sky-300">
                {r.title}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground/55">{r.url}</span>
              {r.snippet ? (
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground/70">
                  {r.snippet}
                </span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// --- Shared utility: is the tool in a live (streaming/running/awaiting_approval) state ---

export function isToolLive(status: ToolCallStatus | 'completed'): boolean {
  return status === 'streaming' || status === 'running' || status === 'awaiting_approval'
}

// --- Shared error block ---

export function ErrorBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
      {text}
    </pre>
  )
}

// --- Shared "no output yet" placeholder with optional pulse dot ---

export function EmptyHint({
  ctx,
  pulse = false
}: {
  ctx: { t: (key: string, opts?: Record<string, unknown>) => string }
  pulse?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
      {pulse ? <span className="size-1.5 rounded-full bg-muted-foreground/30 animate-pulse" /> : null}
      {ctx.t('toolCall.noOutputYet')}
    </div>
  )
}
