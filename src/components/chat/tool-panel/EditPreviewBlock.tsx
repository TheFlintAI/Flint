import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { CopyButton } from './parts'
import { lineCount } from './utils'
import type { ToolCallStatus } from '@/lib/agent/types'

export { lineCount }

export function getNumericInputValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function getCompleteWorkText(input: Record<string, unknown>): {
  text: string
  fullText: string
  chars: number
  lines: number
  truncated: boolean
} {
  const fullText =
    typeof input.report === 'string'
      ? input.report
      : typeof input.preview === 'string'
        ? input.preview
        : ''
  const previewText =
    typeof input.report_preview === 'string'
      ? input.report_preview
      : typeof input.preview === 'string'
        ? input.preview
        : fullText
  const text = previewText || fullText
  const chars = getNumericInputValue(input.report_chars) ?? (fullText.length || text.length)
  const lines = getNumericInputValue(input.report_lines) ?? (text ? lineCount(text) : 0)
  const truncated =
    input.report_truncated === true ||
    input._truncated === true ||
    (typeof input.report_preview === 'string' && typeof input.report !== 'string')

  return { text, fullText, chars, lines, truncated }
}

export function extractReportHeadings(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.trim())
    .filter((line): line is string => !!line)
    .slice(0, 4)
}

export function CompleteWorkPreviewLine({ line }: { line: string }): React.JSX.Element | null {
  const trimmed = line.trim()
  if (!trimmed) return <div className="h-2" />

  const heading = trimmed.match(/^#{1,6}\s+(.+)/)?.[1]?.trim()
  if (heading) {
    return (
      <div className="mt-2 flex items-center gap-2 first:mt-0">
        <span className="h-4 w-1 rounded-full bg-violet-400/70" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground/90">
          {heading}
        </span>
      </div>
    )
  }

  const bullet = trimmed.match(/^[-*]\s+(.+)/)?.[1]?.trim()
  if (bullet) {
    return (
      <div className="flex gap-2 text-[11px] leading-5 text-foreground/78">
        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-400/70" />
        <span className="min-w-0 break-words">{bullet}</span>
      </div>
    )
  }

  return (
    <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-foreground/78">
      {line}
    </p>
  )
}

export function CompleteWorkInputBlock({
  input,
  status
}: {
  input: Record<string, unknown>
  status?: ToolCallStatus | 'completed'
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const report = getCompleteWorkText(input)
  const isLive = status === 'streaming' || status === 'running'
  const isComplete = status === 'completed'
  const headings = extractReportHeadings(report.text)
  const visibleLines = report.text.split('\n').slice(0, 18)
  const density = Math.min(1, Math.max(0.08, report.chars / 6000))
  const blockCount =
    headings.length ||
    report.text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean).length
  const copyText = report.fullText || report.text

  return (
    <div className="overflow-hidden rounded-lg border border-violet-500/20 bg-violet-500/[0.04]">
      <div className="border-b border-violet-500/15 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg border border-violet-400/25 bg-violet-400/10 text-violet-300">
            <FileText className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-foreground/90">
                {isComplete
                  ? t('toolCall.completeWork.submitted')
                  : t('toolCall.completeWork.submitting')}
              </span>
              {isLive ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 text-[9px] text-violet-200">
                  <span className="size-1.5 rounded-full bg-violet-300 animate-pulse" />
                  {t('toolCall.completeWork.live')}
                </span>
              ) : null}
              {report.truncated ? (
                <span className="rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[9px] text-muted-foreground/70">
                  {t('toolCall.completeWork.preview')}
                </span>
              ) : null}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/70">
              <div
                className="h-full rounded-full bg-violet-400/80 transition-[width] duration-300"
                style={{ width: `${Math.round(density * 100)}%` }}
              />
            </div>
          </div>
          {copyText ? <CopyButton text={copyText} title={t('toolCall.completeWork.copy')} /> : null}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[
            [t('toolCall.completeWork.chars'), report.chars.toLocaleString()],
            [t('toolCall.completeWork.lines'), report.lines.toLocaleString()],
            [t('toolCall.completeWork.blocks'), blockCount.toLocaleString()]
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-md border border-border/50 bg-background/55 px-2 py-1.5"
            >
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground/55">
                {label}
              </div>
              <div className="mt-0.5 text-[12px] font-semibold tabular-nums text-foreground/85">
                {value}
              </div>
            </div>
          ))}
        </div>

        {headings.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {headings.map((heading) => (
              <span
                key={heading}
                className="max-w-[180px] truncate rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-[10px] text-violet-200/90"
              >
                {heading}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="max-h-72 overflow-auto px-3 py-2.5">
        {report.text ? (
          <div className="space-y-1">
            {visibleLines.map((line, index) => (
              <CompleteWorkPreviewLine key={`${index}:${line.slice(0, 16)}`} line={line} />
            ))}
            {(report.truncated || report.text.split('\n').length > visibleLines.length) && (
              <div className="pt-1 text-[10px] text-muted-foreground/60">
                {t('toolCall.completeWork.previewContinues')}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/65">
            <span className="size-1.5 rounded-full bg-violet-300 animate-pulse" />
            {t('toolCall.completeWork.waiting')}
          </div>
        )}
      </div>
    </div>
  )
}
