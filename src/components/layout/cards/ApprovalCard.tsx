import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldQuestion } from 'lucide-react'
import { useAgentStore } from '@/stores/agent-store'
import { useInboxStore, type PendingInboxItem } from '@/stores/inbox-store'
import { MONO_FONT } from '@/lib/utils/fonts'

export const ApprovalCard = memo(function ApprovalCard({
  item,
}: {
  item: PendingInboxItem
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const resolveToolApproval = useAgentStore((s) => s.resolveToolApproval)
  const resolveInboxItem = useInboxStore((s) => s.resolveInboxItem)

  const command = item.title
  const source = item.description
  const toolCallId = item.toolUseId

  const handleResolve = useCallback((approved: boolean) => {
    if (toolCallId) resolveToolApproval(toolCallId, approved)
    resolveInboxItem(item.id)
  }, [toolCallId, item.id, resolveToolApproval, resolveInboxItem])

  return (
    <div className="approval-pending rounded-lg bg-muted/5">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <ShieldQuestion className="size-3.5 shrink-0 text-amber-500/80" />
        <span className="text-[12px] font-medium text-foreground/80">
          {t('rightPanel.approvalTitle', { defaultValue: 'Command Approval' })}
        </span>
        {source && (
          <span className="truncate text-[10px] text-muted-foreground/60">
            {t('rightPanel.approvalFrom', { defaultValue: 'from {{source}}', source })}
          </span>
        )}
      </div>

      <div className="mx-2.5 mb-2 rounded-md bg-background/60 px-2.5 py-2">
        <pre
          className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-foreground/85"
          style={{ fontFamily: MONO_FONT }}
        >
          {command}
        </pre>
      </div>

      <div className="flex items-center gap-2 px-2.5 pb-2">
        <button
          type="button"
          onClick={() => handleResolve(false)}
          className="flex-1 rounded-md bg-destructive/10 px-3 py-1.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/20"
        >
          {t('rightPanel.approvalDeny', { defaultValue: 'Deny' })}
        </button>
        <button
          type="button"
          onClick={() => handleResolve(true)}
          className="flex-1 rounded-md bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
        >
          {t('rightPanel.approvalAllow', { defaultValue: 'Allow' })}
        </button>
      </div>
    </div>
  )
})

ApprovalCard.displayName = 'ApprovalCard'
