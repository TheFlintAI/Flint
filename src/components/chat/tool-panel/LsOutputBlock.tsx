import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, File } from 'lucide-react'
import { MONO_FONT } from '@/lib/utils/fonts'
import { decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { OutputPre, CopyButton } from './parts'
import { isRecord } from './SearchOutputBlocks'
import { useUIStore } from '@/stores/ui-store'

export type LsEntry = { name: string; type: string; path?: string }

export function parseLsEntries(output: string | undefined): LsEntry[] | null {
  if (!output?.trim()) return null
  const decoded = decodeStructuredToolResult(output)
  if (!Array.isArray(decoded)) return null
  return decoded
    .map((entry): LsEntry | null => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.type !== 'string') {
        return null
      }
      return {
        name: entry.name,
        type: entry.type,
        path: typeof entry.path === 'string' ? entry.path : undefined
      }
    })
    .filter((entry): entry is LsEntry => !!entry)
}

export function LSOutputBlock({ output }: { output: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const parsed = React.useMemo(() => parseLsEntries(output), [output])
  if (!parsed || !Array.isArray(parsed)) return <OutputPre text={output} />

  const dirs = parsed.filter((e) => e.type === 'directory')
  const files = parsed.filter((e) => e.type === 'file')

  return (
    <div>
      <div className="relative group/ls">
        <div className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover/ls:opacity-100">
          <CopyButton text={parsed.map((e) => e.name).join('\n')} />
        </div>
        <div
          className="max-h-48 space-y-0.5 overflow-auto px-1 py-1 text-[11px] font-mono"
          style={{ fontFamily: MONO_FONT }}
        >
        {dirs.map((e) => (
          <div
            key={e.name}
            className="flex items-center gap-1.5 text-amber-600/80 dark:text-amber-400/70"
          >
            <Folder className="size-3 shrink-0" />
            <span>{e.name}/</span>
          </div>
        ))}
        {files.map((e) => (
          <div
            key={e.name}
            className="flex cursor-pointer items-center gap-1.5 text-foreground/70 transition-colors hover:text-sky-600 dark:text-zinc-400 dark:hover:text-blue-400"
            title={t('toolCall.clickToInsert', { path: e.path || e.name })}
            onClick={() => {
              const short = (e.path || e.name).split(/[\\/]/).slice(-2).join('/')
              useUIStore.getState().setPendingInsertText(short)
            }}
          >
            <File className="size-3 shrink-0 text-zinc-500" />
            <span>{e.name}</span>
          </div>
        ))}
        {dirs.length === 0 && files.length === 0 ? (
          <div className="text-muted-foreground">{t('toolCall.searchState.noMatches')}</div>
        ) : null}
      </div>
      </div>
    </div>
  )
}
