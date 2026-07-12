import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { motion, AnimatePresence } from 'motion/react'
import { ClipboardList, Target } from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'
import { useTeamStore } from '@/stores/team-store'
import { useAgentStore } from '@/stores/agent-store'
import { useTodoStore } from '@/stores/todo-store'
import { useInboxStore } from '@/stores/inbox-store'
import { teamTaskToItem, EMPTY_TASKS } from '@/lib/todo-utils'
import { ProgressCard } from './cards/ProgressCard'
import { TeamCard } from './cards/TeamCard'
import { ChangesCard } from './cards/ChangesCard'
import { ApprovalCard } from './cards/ApprovalCard'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'

function cardAnimation() {
  return {
    layout: true as const,
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8, height: 0 },
    transition: { duration: 0.2, ease: 'easeOut' as const },
  }
}

/**
 * AdaptiveDashboard is the central orchestrator for the right sidebar.
 *
 * It is ALWAYS mounted (RightPanel renders it unconditionally) so that it can
 * detect activity even when the panel is visually hidden.
 *
 * Architecture:
 * - Computes which cards have content by querying the relevant stores
 * - Auto-expand is triggered directly at data mutation points (stores), not here
 * - Panel close is handled by user action (toggle button) or navigation
 */
export function AdaptiveDashboard(): React.JSX.Element {
  const { t } = useTranslation('layout')

  const { activeTaskId, activeTask } = useChatStore(
    useShallow((s) => {
      const activeTask = s.tasks.find((taskItem) => taskItem.id === s.activeTaskId)
      return {
        activeTaskId: s.activeTaskId,
        activeTask,
      }
    }),
  )

  // Approval items for the active task
  const approvalItems = useInboxStore(
    useShallow((s) =>
      activeTaskId
        ? s.inboxItems.filter((item) => item.type === 'approval' && item.taskId === activeTaskId)
        : []
    )
  )

  // Team is per-task — look up directly from the activeTeams map.
  const team = useTeamStore((state) =>
    activeTaskId ? (state.activeTeams[activeTaskId] ?? null) : null
  )

  // Progress card: has todos from either the todo store or team tasks
  const taskJobs = useTodoStore(
    useShallow((state) => {
      if (!activeTaskId) return EMPTY_TASKS
      if (state.currentTaskId === activeTaskId) return state.tasks
      return state.tasksByTask[activeTaskId] ?? EMPTY_TASKS
    }),
  )
  const teamTasks = useMemo(
    () => (team?.tasks ?? []).map(teamTaskToItem),
    [team?.tasks],
  )
  const hasTodos = taskJobs.length > 0 || teamTasks.length > 0

  // Changes card: lightweight check (card does full aggregation internally)
  const changeSets = useAgentStore((s) => s.changeSets)
  const hasChanges = useMemo(() => {
    if (!activeTaskId) return false
    return Object.values(changeSets).some(
      (cs) => cs.taskId === activeTaskId || cs.changes.some((c) => c.taskId === activeTaskId)
    )
  }, [activeTaskId, changeSets])

  // Team card: active when the current task has a running team
  const hasTeam = !!team

  const hasApprovals = approvalItems.length > 0
  const anyCardVisible = hasApprovals || hasTodos || hasChanges || hasTeam

  if (!activeTask) {
    return (
      <PanelEmptyState
        icon={<Target className="size-7 text-muted-foreground/50" />}
        title={t('rightPanel.planEmptyTitle', {
          defaultValue: 'No active task',
        })}
      />
    )
  }

  if (!anyCardVisible) {
    return (
      <PanelEmptyState
        icon={<ClipboardList className="size-7 text-muted-foreground/50" />}
        title={t('rightPanel.noActivities', {
          defaultValue: 'No activities',
        })}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="space-y-2.5 p-2.5">
        <AnimatePresence mode="popLayout">
          {/* Approval cards — pinned at top, one per pending approval */}
          {approvalItems.map((item) => (
            <motion.div key={`approval-${item.id}`} {...cardAnimation()}>
              <ApprovalCard item={item} />
            </motion.div>
          ))}

          {/* Progress card — only when there are todos */}
          {hasTodos && (
            <motion.div key="progress" {...cardAnimation()}>
              <ProgressCard />
            </motion.div>
          )}

          {/* Team card — only when team is active */}
          {hasTeam && (
            <motion.div key="team" {...cardAnimation()}>
              <TeamCard />
            </motion.div>
          )}

          {/* Changes card — only when there are file changes */}
          {hasChanges && (
            <motion.div key="changes" {...cardAnimation()}>
              <ChangesCard />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
