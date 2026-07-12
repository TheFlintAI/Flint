import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toolRegistry } from '@/lib/agent/tool-registry'
import { resolveLocalizedString } from '@/lib/localized-string'
import { getToolIcon } from '@/lib/tools/tool-icon'
import { StatusPill } from '@/components/chat/tool-panel/parts'
import type { ToolCallState } from '@/lib/agent/types'
import { formatToolLogTitle } from './tool-log-title'

// One tool call = one log line, aligned with the other activity rows. The full
// tool body lives in the main chat panel; the sidebar only reports that it
// happened and how it ended. The title is per-call friendly — e.g. "Read
// package.json" rather than the generic "Read file" — using the call's input.
export const ToolLogRow = memo(function ToolLogRow({
  toolCall,
}: {
  toolCall: ToolCallState
}): React.JSX.Element {
  const { t, i18n } = useTranslation('chat')
  const Icon = getToolIcon(toolCall.name)

  const displayName = useMemo(() => {
    const friendly = formatToolLogTitle(toolCall.name, toolCall.input, t)
    if (friendly) return friendly
    const handler = toolRegistry.get(toolCall.name)
    if (handler?.displayName) {
      return resolveLocalizedString(handler.displayName, i18n.language)
    }
    return t(`toolLabels.${toolCall.name}`, { defaultValue: toolCall.name })
  }, [toolCall.name, toolCall.input, t, i18n.language])

  const elapsed =
    toolCall.startedAt && toolCall.completedAt
      ? `${((toolCall.completedAt - toolCall.startedAt) / 1000).toFixed(1)}s`
      : null

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <Icon className="size-3 shrink-0 text-muted-foreground/55" />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground/75">
        {displayName}
      </span>
      {elapsed && (
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground/45">
          {elapsed}
        </span>
      )}
      <StatusPill status={toolCall.status} toolName={toolCall.name} title={toolCall.error} />
    </div>
  )
})

ToolLogRow.displayName = 'ToolLogRow'
