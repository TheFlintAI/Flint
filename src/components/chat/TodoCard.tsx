import * as React from 'react'
import { ChevronDown, ChevronUp, ListChecks, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { TodoItem } from '@/stores/todo-store'

function StatusDot({ status }: { status: TodoItem['status'] }): React.JSX.Element {
  switch (status) {
    case 'completed':
      return (
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <span className="size-2.5 rounded-full bg-green-500" />
        </span>
      )
    case 'in_progress':
      return (
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <Loader2 className="size-3.5 animate-spin text-blue-500" />
        </span>
      )
    case 'pending':
    default:
      return (
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <span className="size-2.5 rounded-full border border-muted-foreground/30" />
        </span>
      )
  }
}

const COLLAPSED_VISIBLE_RECENT_TASK_COUNT = 3

interface TodoStatusListProps {
  tasks: TodoItem[]
  pendingSubject?: string | null
  focusedTaskId?: string
  embedded?: boolean
  className?: string
}

export function TodoStatusList({
  tasks,
  pendingSubject = null,
  focusedTaskId,
  embedded = false,
  className
}: TodoStatusListProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)
  const total = tasks.length || (pendingSubject ? 1 : 0)
  const completed = tasks.filter((task) => task.status === 'completed').length

  const { hiddenCount, visibleTasks } = (() => {
    if (tasks.length <= COLLAPSED_VISIBLE_RECENT_TASK_COUNT) {
      return { hiddenCount: 0, visibleTasks: tasks }
    }

    const recentTaskIds = new Set(
      tasks.slice(-COLLAPSED_VISIBLE_RECENT_TASK_COUNT).map((task) => task.id)
    )
    const nextVisibleTasks = tasks.filter(
      (task) => task.status !== 'completed' || recentTaskIds.has(task.id)
    )

    return {
      hiddenCount: Math.max(0, tasks.length - nextVisibleTasks.length),
      visibleTasks: nextVisibleTasks
    }
  })()

  React.useEffect(() => {
    if (hiddenCount === 0) {
      setExpanded(false)
    }
  }, [hiddenCount])

  const displayTasks = hiddenCount > 0 && !expanded ? visibleTasks : tasks
  const showPendingPlaceholder = !!pendingSubject && displayTasks.length === 0

  if (total === 0 && !pendingSubject) {
    return <></>
  }

  return (
    <div className={cn(embedded ? 'min-w-0 space-y-0.5' : 'my-5 min-w-0', className)}>
      {!embedded && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListChecks className="size-3.5 shrink-0" />
          <span>{t('todo.tasksDone', { completed, total })}</span>
        </div>
      )}

      <div className={cn(!embedded && 'mt-2', 'space-y-1')}>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground/80 transition-colors hover:bg-muted/40 hover:text-foreground/80"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            <span>
              {expanded ? t('todo.showLess') : t('todo.showEarlierTasks', { count: hiddenCount })}
            </span>
          </button>
        )}
        {displayTasks.map((task) => (
          <div
            key={task.id}
            className={cn(
              'flex items-start gap-1.5',
              embedded
                ? 'px-0.5 py-0.5'
                : 'rounded-lg border border-border/60 bg-background/70 px-3 py-1.5 shadow-sm',
              task.id === focusedTaskId && 'border-foreground/15 bg-accent/40'
            )}
          >
            <span className="mt-0.5">
              <StatusDot status={task.status} />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'text-xs leading-relaxed',
                  task.status === 'completed' && 'text-muted-foreground line-through',
                  task.status === 'pending' && 'text-muted-foreground/70'
                )}
              >
                {task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject}
              </div>
              {task.owner && (
                <div className="text-[10px] text-muted-foreground/50">{task.owner}</div>
              )}
            </div>
          </div>
        ))}
        {showPendingPlaceholder && (
          <div className="flex items-start gap-2 rounded-md px-1.5 py-1">
            <span className="mt-0.5">
              <StatusDot status="pending" />
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground/70">
              {pendingSubject}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
