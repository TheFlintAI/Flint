import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, MessageSquare, Loader2 } from 'lucide-react'
import { useTeamStore } from '@/stores/team-store'
import { useChatStore } from '@/stores/chat-store'
import { TeamMemberPanel } from './TeamMemberPanel'
import { TeamMessageBubble } from './TeamMessageBubble'
import type { TeamMember, TeamTask } from '@/lib/agent/teams/types'
import type { TeamRuntimeMessageRecord } from '@/protocols/team-runtime-types'

export function TeamCard(): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const activeTaskId = useChatStore((s) => s.activeTaskId)
  // Team is per-task — look up directly from the activeTeams map.
  const activeTeam = useTeamStore((s) =>
    activeTaskId ? (s.activeTeams[activeTaskId] ?? null) : null
  )

  const { members, tasks, messages } = useMemo<{
    members: TeamMember[]
    tasks: TeamTask[]
    messages: TeamRuntimeMessageRecord[]
  }>(() => ({
    members: activeTeam?.members ?? [],
    tasks: activeTeam?.tasks ?? [],
    messages: activeTeam?.messages ?? [],
  }), [activeTeam])

  if (!activeTeam || !activeTaskId) return null

  const isEmpty = members.length === 0 && tasks.length === 0

  return (
    <div className="rounded-lg border border-border/20 bg-muted/5">
      {/* Header — logo + title (matches ChangesCard / ProgressCard) */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Users className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">
          {activeTeam.name}
        </span>
      </div>

      <div className="space-y-1.5 px-3 pb-2">
        {/* Members + live activity */}
        {members.length > 0 && (
          <div className="space-y-1.5">
            {members.map((m) => (
              <TeamMemberPanel key={m.id} member={m} />
            ))}
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="border-t border-border/20 pt-1.5">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <MessageSquare className="size-3.5" />
              <span>{t('rightPanel.orchestrationTeamMessages', { defaultValue: 'Team Messages' })}</span>
              <span className="text-[11px] text-muted-foreground/60">({messages.length})</span>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
              {messages.map((msg) => (
                <TeamMessageBubble key={msg.id} msg={msg} />
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="mb-3 size-5 animate-spin text-muted-foreground/30" />
            <p className="text-[12px] text-muted-foreground">
              {t('rightPanel.teamWaitingMembers', { defaultValue: 'Waiting for team members...' })}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
