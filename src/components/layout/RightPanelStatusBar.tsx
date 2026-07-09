import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Clock, Circle } from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'
import { useProviderStore } from '@/stores/provider-store'
import { useTeamStore } from '@/stores/team-store'
import { cn } from '@/lib/utils'
import {
  formatTokens
} from '@/lib/utils/format-tokens'
import {
  resolveCompressionContextLength,
  getEffectiveContextWindow
} from '@/lib/agent/context-compression'

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(0)}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h${mins % 60}m`
}

export function RightPanelStatusBar(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { activeTaskId, activeTask } = useChatStore(
    useShallow((s) => {
      const activeTask = s.tasks.find((taskItem) => taskItem.id === s.activeTaskId)
      return { activeTaskId: s.activeTaskId, activeTask }
    })
  )
  const providerState = useProviderStore(
    useShallow((s) => ({
      providers: s.providers,
      activeProviderId: s.activeProviderId,
      activeModelId: s.activeModelId
    }))
  )
  const resolvedProviderId = activeTask?.providerId ?? providerState.activeProviderId
  const resolvedModelId = activeTask?.modelId ?? providerState.activeModelId
  const activeProvider = providerState.providers.find((p) => p.id === resolvedProviderId) ?? null
  const activeModelCfg = activeProvider?.models.find((m) => m.id === resolvedModelId) ?? null

  const stats = useMemo(() => {
    if (!activeTask) return null
    const now = Date.now()
    const elapsed = now - activeTask.createdAt

    const totals = activeTask.messages.reduce(
      (acc, m) => {
        if (m.usage) {
          acc.input += m.usage.inputTokens ?? 0
          acc.output += m.usage.outputTokens
          if (m.usage.cacheReadTokens) acc.cacheRead += m.usage.cacheReadTokens
          if (m.usage.reasoningTokens) acc.reasoning += m.usage.reasoningTokens
        }
        return acc
      },
      { input: 0, output: 0, cacheRead: 0, reasoning: 0 }
    )

    // Include team member token usage — only for the current task's team.
    const teamStore = useTeamStore.getState()
    const taskTeam = activeTaskId ? (teamStore.activeTeams[activeTaskId] ?? null) : null
    const allTeamMembers = [
      ...(taskTeam?.members ?? []),
      ...teamStore.teamHistory.filter((t) => t.taskId === activeTaskId).flatMap((t) => t.members)
    ]
    for (const member of allTeamMembers) {
      if (member.usage) {
        totals.input += member.usage.inputTokens ?? 0
        totals.output += member.usage.outputTokens
        if (member.usage.cacheReadTokens) totals.cacheRead += member.usage.cacheReadTokens
        if (member.usage.reasoningTokens) totals.reasoning += member.usage.reasoningTokens
      }
    }

    const hasUsage = totals.input + totals.output > 0
    const totalTokens = hasUsage ? totals.input + totals.output : 0

    const lastUsage = [...activeTask.messages].reverse().find(
      (m) => m.usage && (m.usage.contextTokens ?? 0) > 0
    )?.usage
    const ctxUsed = lastUsage?.contextTokens ?? 0
    const compressionConfig = activeModelCfg
      ? { enabled: true, contextLength: resolveCompressionContextLength(activeModelCfg), threshold: 0.8, preCompressThreshold: 0.65, reservedOutputBudget: 4096 }
      : null
    const compressionWindow = compressionConfig ? getEffectiveContextWindow(compressionConfig) : null
    const ctxLimit = lastUsage?.contextLength ?? compressionConfig?.contextLength ?? null
    const ctxGaugeLimit = compressionWindow ?? ctxLimit
    const pct = ctxGaugeLimit ? Math.min((ctxUsed / ctxGaugeLimit) * 100, 100) : null

    return { elapsed, totalTokens, ctxUsed, ctxGaugeLimit, pct, hasUsage }
  }, [activeTask, activeModelCfg, activeTaskId])

  if (!stats || !activeTask) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border/40 bg-muted/15 px-3">
        <Circle className="size-2 text-muted-foreground/30" />
        <span className="text-[10px] text-muted-foreground/50">
          {t('rightPanel.statusBar.idle', { defaultValue: 'No active task' })}
        </span>
      </div>
    )
  }

  const barColor =
    stats.pct === null
      ? 'bg-muted-foreground/20'
      : stats.pct > 80
        ? 'bg-destructive'
        : stats.pct > 50
          ? 'bg-amber-500'
          : 'bg-emerald-500'

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border/40 bg-muted/15 px-3">
      <Circle className={cn('size-2', stats.hasUsage ? 'text-emerald-500' : 'text-muted-foreground/30')} />

      {stats.ctxGaugeLimit != null && stats.pct != null && (
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="h-1.5 flex-1 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barColor)}
              style={{ width: `${Math.min(stats.pct, 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {formatTokens(stats.ctxUsed)}/{formatTokens(stats.ctxGaugeLimit)}
          </span>
        </div>
      )}

      <span className="shrink-0 flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground/70">
        <Clock className="size-3" />
        {formatElapsed(stats.elapsed)}
      </span>
    </div>
  )
}
