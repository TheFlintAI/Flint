import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User, ChevronDown, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Badge, type BadgeTone } from '@/components/chat/tool-panel/parts'
import { MemberActivityStream } from './team-stream/MemberActivityStream'
import type { TeamMember, TeamMemberStatus } from '@/lib/agent/teams/types'

// Badge tone per TeamMemberStatus. The left-side avatar is a unified static
// User icon — status is conveyed solely by the badge, so the old per-status
// spinner/icon pair was redundant.
const STATUS_TONE: Record<TeamMemberStatus, BadgeTone> = {
  working:   'blue',
  idle:      'default',
  waiting:   'amber',
  stopped:   'default',
  completed: 'green',
  failed:    'red',
}

interface TeamMemberPanelProps {
  member: TeamMember
}

export function TeamMemberPanel({ member }: TeamMemberPanelProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const tone = STATUS_TONE[member.status] ?? 'default'
  const statusLabel = t(`teamCard.memberStatus.${member.status}`, { defaultValue: member.status })
  const isWorking = member.status === 'working'

  const hasActivity = isWorking && (
    member.streamingText.length > 0 || member.toolCalls.length > 0
  )
  const hasContent = hasActivity || isWorking // activity stream or Starting… pending
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-lg bg-muted/25 p-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Member row — avatar + name + status badge + collapse toggle */}
        <div className="flex items-center gap-2">
          <User className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">
            {member.name}
            {member.role === 'lead' && (
              <span className="ml-1 text-[9px] font-medium text-amber-600">(Lead)</span>
            )}
          </span>
          <Badge tone={tone}>{statusLabel}</Badge>
          {hasContent && (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                aria-label={open ? t('teamCard.collapse', { defaultValue: 'Collapse' }) : t('teamCard.expand', { defaultValue: 'Expand' })}
              >
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
            </CollapsibleTrigger>
          )}
        </div>

        {/* Live activity — flat, sidebar-sized stream */}
        <CollapsibleContent>
          {hasContent && (
            <div className="mt-1 space-y-1">
              {hasActivity && (
                <MemberActivityStream
                  streamingText={member.streamingText}
                  toolCalls={member.toolCalls}
                  toolCursors={member.toolCursors ?? {}}
                  working={isWorking}
                />
              )}
              {isWorking && !hasActivity && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/40" />
                  <span>{t('teamCard.starting', { defaultValue: 'Starting…' })}</span>
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
