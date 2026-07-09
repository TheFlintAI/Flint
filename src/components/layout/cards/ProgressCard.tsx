import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ListChecks } from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'
import { TodoStatusList } from '@/components/chat/TodoCard'
import { useTodoStore } from '@/stores/todo-store'
import { useTeamStore } from '@/stores/team-store'
import { teamTaskToItem, EMPTY_TASKS } from '@/lib/todo-utils'

export function ProgressCard(): React.JSX.Element | null {
  const { t } = useTranslation('layout')

  const { activeTaskId, activeTask } = useChatStore(
    useShallow((s) => {
      const activeTask = s.tasks.find((taskItem) => taskItem.id === s.activeTaskId)
      return { activeTaskId: s.activeTaskId, activeTask }
    })
  )

  const taskJobs = useTodoStore(
    useShallow((state) => {
      if (!activeTaskId) return EMPTY_TASKS
      if (state.currentTaskId === activeTaskId) return state.tasks
      return state.tasksByTask[activeTaskId] ?? EMPTY_TASKS
    })
  )
  // Team is per-task — look up directly from the activeTeams map.
  const team = useTeamStore((state) =>
    activeTaskId ? (state.activeTeams[activeTaskId] ?? null) : null
  )
  const teamTasks = useMemo(
    () => (team?.tasks ?? []).map(teamTaskToItem),
    [team?.tasks],
  )
  const tasks = taskJobs.length > 0 ? taskJobs : teamTasks

  const completed = tasks.filter((t) => t.status === 'completed').length
  const total = tasks.length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  if (!activeTask || total === 0) return null

  return (
    <div className="rounded-lg border border-border/20 bg-muted/5">
      {/* Header — matches ChangesCard / TeamCard */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <ListChecks className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="text-[12px] font-medium text-foreground/80">
          {t('rightPanel.progress', { defaultValue: 'Progress' })}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {completed}/{total}
        </span>
        <span className="flex-1" />
      </div>

      {/* Progress bar */}
      <div className="mx-2.5 h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Task list */}
      <div className="px-2.5 pt-1.5 pb-2">
        <TodoStatusList tasks={tasks} embedded />
      </div>
    </div>
  )
}
