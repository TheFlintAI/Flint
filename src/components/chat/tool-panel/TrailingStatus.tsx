import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCallStatus } from '@/lib/agent/types'
import { StatusPill } from './parts'

export function TrailingStatus({
  status,
  error,
  startedAt,
  completedAt,
  open,
  toolName,
}: {
  status: ToolCallStatus | 'completed'
  error?: string
  startedAt?: number
  completedAt?: number
  open: boolean
  toolName?: string
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const outputError = error || (status === 'error' ? t('error.label') : null)
  const elapsed =
    startedAt && completedAt
      ? `${((completedAt - startedAt) / 1000).toFixed(1)}s`
      : null
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <StatusPill status={status} title={outputError ?? undefined} toolName={toolName} />
      {elapsed ? (
        <span className="tabular-nums text-[9px] text-muted-foreground/60">
          {elapsed}
        </span>
      ) : null}
      {open ? (
        <ChevronDown className="size-3 text-muted-foreground/60" />
      ) : (
        <ChevronRight className="size-3 text-muted-foreground/60" />
      )}
    </span>
  )
}
