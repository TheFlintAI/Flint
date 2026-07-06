import { useTranslation } from 'react-i18next'
import {
  SendHorizontal,
  Megaphone,
  PowerOff,
  Moon,
  ShieldQuestion,
  ShieldCheck,
  ClipboardList,
  ClipboardCheck,
  SlidersHorizontal,
  Check,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TeamRuntimeMessageRecord, TeamRuntimeMessageType } from '@/protocols/team-runtime-types'

function formatAge(
  t: (key: string, options?: Record<string, unknown>) => string,
  ts: number
): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return t('time.sAgo', { ns: 'common', count: sec })
  if (sec < 3600) return t('time.mAgo', { ns: 'common', count: Math.floor(sec / 60) })
  return t('time.hAgo', { ns: 'common', count: Math.floor(sec / 3600) })
}

// The middle icon doubles as the message-type indicator (replacing a generic
// arrow), so the category is readable at a glance instead of via a faint
// color stripe. Each entry pairs a lucide icon with a subtle tint.
const TYPE_ICON: Record<TeamRuntimeMessageType, { Icon: LucideIcon; className: string }> = {
  message:                  { Icon: SendHorizontal,      className: 'text-primary/60' },
  broadcast:                { Icon: Megaphone,           className: 'text-amber-500/70' },
  shutdown_request:         { Icon: PowerOff,            className: 'text-destructive/70' },
  shutdown_response:        { Icon: Check,               className: 'text-muted-foreground/45' },
  idle_notification:        { Icon: Moon,                className: 'text-muted-foreground/45' },
  permission_request:       { Icon: ShieldQuestion,      className: 'text-amber-500/70' },
  permission_response:      { Icon: ShieldCheck,         className: 'text-muted-foreground/50' },
  plan_approval_request:    { Icon: ClipboardList,       className: 'text-amber-500/70' },
  plan_approval_response:   { Icon: ClipboardCheck,      className: 'text-muted-foreground/50' },
  team_permission_update:   { Icon: ShieldCheck,         className: 'text-amber-500/70' },
  mode_set_request:         { Icon: SlidersHorizontal,   className: 'text-amber-500/70' }
}

function actorLabel(who: string, broadcastLabel: string): string {
  if (who === 'all') return broadcastLabel
  if (who === 'lead') return 'Lead'
  return who
}

interface TeamMessageBubbleProps {
  msg: TeamRuntimeMessageRecord
}

export function TeamMessageBubble({ msg }: TeamMessageBubbleProps): React.JSX.Element {
  const { t } = useTranslation()
  const broadcastLabel = t('teamMessage.broadcast', { defaultValue: 'Everyone' })
  const { Icon, className: iconClassName } = TYPE_ICON[msg.type] ?? {
    Icon: SendHorizontal,
    className: 'text-primary/60'
  }
  const body = msg.summary?.trim() || msg.content

  return (
    <div className="rounded-md border border-border/15 bg-muted/15 px-2.5 py-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px]">
        <span className="font-medium text-foreground/80">{actorLabel(msg.from, broadcastLabel)}</span>
        <Icon className={cn('size-3 shrink-0', iconClassName)} />
        <span className="text-muted-foreground/65">{actorLabel(msg.to, broadcastLabel)}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/40">
          {formatAge(t, msg.timestamp)}
        </span>
      </div>
      <p
        className="line-clamp-3 text-[11px] leading-relaxed text-foreground/75"
        title={msg.content}
      >
        {body}
      </p>
    </div>
  )
}
