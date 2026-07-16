import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import {
  Check,
  CheckCheck,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useChatStore } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentStore } from '@/stores/agent-store'
import { useTeamStore } from '@/stores/team-store'
import { useInboxStore } from '@/stores/inbox-store'
import {
  abortTask,
  clearPendingTaskMessages
} from '@/hooks/use-chat-actions'
import { cn } from '@/lib/utils'
import { clampLeftSidebarWidth, LEFT_SIDEBAR_DEFAULT_WIDTH, LEFT_SIDEBAR_COLLAPSED_WIDTH } from './panel-constants'
import { toast } from 'sonner'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const SIDEBAR_TREE_ROW_CLASS = 'workspace-sidebar-row min-h-8 rounded-md border border-transparent'
const SIDEBAR_TREE_ACTIVE_CLASS = 'workspace-sidebar-row--active text-foreground'
const SIDEBAR_TREE_HOVER_CLASS =
  'workspace-sidebar-row--hover text-foreground/90 hover:text-foreground'
const SIDEBAR_TREE_LABEL_CLASS = 'text-[13px] leading-5'
const SIDEBAR_TREE_META_CLASS = 'text-[10px]'

type TaskListItem = ReturnType<typeof mapTask>

type TaskStatusKind = 'blocked' | 'running' | 'completed'

function mapTask(taskItem: ReturnType<typeof useChatStore.getState>['tasks'][number]): {
  id: string
  title: string
  updatedAt: number
  createdAt: number
  pinned?: boolean
  messageCount: number
} {
  return {
    id: taskItem.id,
    title: taskItem.title,
    updatedAt: taskItem.updatedAt,
    createdAt: taskItem.createdAt,
    pinned: taskItem.pinned,
    messageCount: taskItem.messageCount
  }
}

function areTaskListsEqual(
  left: ReturnType<typeof useChatStore.getState>['tasks'],
  right: ReturnType<typeof useChatStore.getState>['tasks']
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === b) continue
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.updatedAt !== b.updatedAt ||
      a.createdAt !== b.createdAt ||
      !!a.pinned !== !!b.pinned ||
      a.messageCount !== b.messageCount
    ) {
      return false
    }
  }
  return true
}

function sortTasks(left: TaskListItem, right: TaskListItem): number {
  if (!!left.pinned !== !!right.pinned) return left.pinned ? -1 : 1
  return right.updatedAt - left.updatedAt
}

function formatRelativeTime(updatedAt: number, locale: string): string {
  const elapsed = Date.now() - updatedAt
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: 'always',
    style: 'narrow'
  })
  if (elapsed < HOUR_MS) {
    return rtf.format(-Math.max(1, Math.round(elapsed / MINUTE_MS)), 'minute')
  }
  if (elapsed < DAY_MS) {
    return rtf.format(-Math.max(1, Math.round(elapsed / HOUR_MS)), 'hour')
  }
  if (elapsed < WEEK_MS) {
    return rtf.format(-Math.max(1, Math.round(elapsed / DAY_MS)), 'day')
  }
  return rtf.format(-Math.max(1, Math.round(elapsed / WEEK_MS)), 'week')
}

export function WorkspaceSidebar(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { t: tCommon } = useTranslation('common')
  const isMac = /Mac/.test(navigator.userAgent)
  const chatView = useUIStore((state) => state.chatView)
  const settingsPageOpen = useUIStore((state) => state.settingsPageOpen)
  const leftSidebarOpen = useUIStore((state) => state.leftSidebarOpen)
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth)
  const setLeftSidebarWidth = useUIStore((state) => state.setLeftSidebarWidth)
  const toggleLeftSidebar = useUIStore((state) => state.toggleLeftSidebar)
  const persistedLeftSidebarWidth = useSettingsStore((state) => state.leftSidebarWidth)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const tasksRaw = useStoreWithEqualityFn(
    useChatStore,
    (state) => state.tasks,
    areTaskListsEqual
  )
  const tasks = useMemo(() => tasksRaw.map(mapTask), [tasksRaw])
  const activeTaskId = useChatStore((state) => state.activeTaskId)
  const streamingTaskIdsSig = useChatStore((state) =>
    Object.keys(state.streamingMessages).sort().join(',')
  )
  const deleteTask = useChatStore((state) => state.deleteTask)
  const togglePinTask = useChatStore((state) => state.togglePinTask)
  const updateTaskTitle = useChatStore((state) => state.updateTaskTitle)
  const disableAutoTitle = useChatStore((state) => state.disableAutoTitle)
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renamingInputRef = useRef<HTMLInputElement>(null)
  const runningTasks = useAgentStore((state) => state.runningTasks)
  const runningAgentTaskIdsSig = ''
  const runningBackgroundTaskIdsSig = useAgentStore((state) =>
    Object.values(state.backgroundProcesses)
      .filter((process) => process.taskId && process.status === 'running')
      .map((process) => process.taskId as string)
      .sort()
      .join(',')
  )
  const activeTeams = useTeamStore((state) => state.activeTeams)
  const blockedCountsByTask = useInboxStore((state) => state.blockedCountsByTask)
  const language = useSettingsStore((state) => state.language)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    title: string
  } | null>(null)
  const [batchDeleteTargets, setBatchDeleteTargets] = useState<
    { id: string; title: string }[]
  | null>(null)
  const taskButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const rubberBandStartRef = useRef<{ x: number; y: number } | null>(null)
  const [isRubberBandSelecting, setIsRubberBandSelecting] = useState(false)
  const [rubberBandRect, setRubberBandRect] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const rubberBandRectRef = useRef<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const runningAgentTaskIds = useMemo(
    () => new Set<string>(),
    [runningAgentTaskIdsSig]
  )
  const runningBackgroundTaskIds = useMemo(
    () => new Set(runningBackgroundTaskIdsSig ? runningBackgroundTaskIdsSig.split(',') : []),
    [runningBackgroundTaskIdsSig]
  )
  const streamingTaskIds = useMemo(
    () => new Set(streamingTaskIdsSig ? streamingTaskIdsSig.split(',') : []),
    [streamingTaskIdsSig]
  )
  const chatSurfaceActive = !settingsPageOpen

  const sortedTasks = useMemo(() => tasks.slice().sort(sortTasks), [tasks])

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return sortedTasks
    return sortedTasks.filter((taskItem) => taskItem.title.toLowerCase().includes(query))
  }, [sortedTasks, searchQuery])

  const currentSidebarWidth = clampLeftSidebarWidth(
    leftSidebarWidth || persistedLeftSidebarWidth || LEFT_SIDEBAR_DEFAULT_WIDTH
  )

  const handleCreateTask = useCallback(() => {
    const chatStore = useChatStore.getState()
    const taskId = chatStore.createTask()
    useUIStore.getState().navigateToTask(taskId)
  }, [])

  const openTask = useCallback((taskId: string) => {
    useUIStore.getState().navigateToTask(taskId)
  }, [])

  const handleRenameStart = useCallback((taskId: string, currentTitle: string) => {
    setRenameValue(currentTitle)
    setRenamingTaskId(taskId)
  }, [])

  useEffect(() => {
    if (renamingTaskId) {
      const input = renamingInputRef.current
      if (input) {
        input.focus()
        input.select()
      }
    }
  }, [renamingTaskId])

  const handleRenameConfirm = useCallback(
    (taskId: string, newTitle: string) => {
      const trimmed = newTitle.trim()
      const task = useChatStore.getState().tasks.find((s) => s.id === taskId)
      if (trimmed && trimmed !== (task?.title ?? '')) {
        updateTaskTitle(taskId, trimmed)
        disableAutoTitle(taskId)
      }
      setRenamingTaskId(null)
      setRenameValue('')
    },
    [updateTaskTitle, disableAutoTitle]
  )

  const handleRenameCancel = useCallback(() => {
    setRenamingTaskId(null)
    setRenameValue('')
  }, [])

  const handleOpenSettings = useCallback(() => {
    useUIStore.getState().openSettingsPage('general')
  }, [])

  const getTaskStatusKind = useCallback(
    (taskId: string): TaskStatusKind | null => {
      if ((blockedCountsByTask[taskId] ?? 0) > 0) return 'blocked'
      if (
        runningTasks[taskId] === 'running' ||
        runningTasks[taskId] === 'retrying' ||
        runningAgentTaskIds.has(taskId) ||
        runningBackgroundTaskIds.has(taskId) ||
        streamingTaskIds.has(taskId) ||
        activeTeams[taskId] !== undefined
      )
        return 'running'
      if (runningTasks[taskId] === 'completed') return 'completed'
      return null
    },
    [
      activeTeams,
      blockedCountsByTask,
      runningBackgroundTaskIds,
      runningTasks,
      runningAgentTaskIds,
      streamingTaskIds
    ]
  )

  const deferDropdownAction = useCallback((action: () => void) => {
    window.setTimeout(action, 0)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setLastClickedId(null)
  }, [])

  const confirmBatchDelete = useCallback(() => {
    if (!batchDeleteTargets) return
    for (const target of batchDeleteTargets) {
      clearPendingTaskMessages(target.id)
      deleteTask(target.id)
    }
    toast.success(
      t('sidebar_toast.batchDeleted', { count: batchDeleteTargets.length })
    )
    setBatchDeleteTargets(null)
    clearSelection()
  }, [batchDeleteTargets, deleteTask, t, clearSelection])

  // Rubber band selection effect
  useEffect(() => {
    if (!isRubberBandSelecting) return

    const handleMouseMove = (e: MouseEvent): void => {
      if (!rubberBandStartRef.current) return
      const left = Math.min(rubberBandStartRef.current.x, e.clientX)
      const top = Math.min(rubberBandStartRef.current.y, e.clientY)
      const width = Math.abs(e.clientX - rubberBandStartRef.current.x)
      const height = Math.abs(e.clientY - rubberBandStartRef.current.y)
      const rect = { left, top, width, height }
      rubberBandRectRef.current = rect
      setRubberBandRect(rect)
    }

    const handleMouseUp = (): void => {
      const rect = rubberBandRectRef.current
      if (!rect) {
        setSelectedIds(new Set())
        setLastClickedId(null)
        setIsRubberBandSelecting(false)
        rubberBandStartRef.current = null
        return
      }

      const container = document.querySelector(
        '.workspace-sidebar-surface'
      ) as HTMLElement | null
      if (!container) {
        setIsRubberBandSelecting(false)
        setRubberBandRect(null)
        rubberBandRectRef.current = null
        rubberBandStartRef.current = null
        return
      }

      const containerRect = container.getBoundingClientRect()
      const selected = new Set<string>()

      for (const taskItem of filteredTasks) {
        const el = taskButtonRefs.current.get(taskItem.id)
        if (!el) continue
        const elRect = el.getBoundingClientRect()
        const elLeft = elRect.left - containerRect.left
        const elTop = elRect.top - containerRect.top
        const elRight = elLeft + elRect.width
        const elBottom = elTop + elRect.height
        const rbLeft = rect.left - containerRect.left
        const rbTop = rect.top - containerRect.top
        const rbRight = rbLeft + rect.width
        const rbBottom = rbTop + rect.height

        if (
          elLeft < rbRight &&
          elRight > rbLeft &&
          elTop < rbBottom &&
          elBottom > rbTop
        ) {
          selected.add(taskItem.id)
        }
      }

      setSelectedIds(selected)
      if (selected.size > 0) {
        setLastClickedId([...selected][selected.size - 1])
      }
      setIsRubberBandSelecting(false)
      setRubberBandRect(null)
      rubberBandRectRef.current = null
      rubberBandStartRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isRubberBandSelecting, filteredTasks])

  // Escape clears selection, Ctrl+A selects all — but never while editing text,
  // so native copy/paste/cut/select-all keep working inside inputs.
  useEffect(() => {
    const isEditingText = (el: Element | null): boolean =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isEditingText(document.activeElement)) return

      if (e.key === 'Escape') {
        setSelectedIds(new Set())
        setLastClickedId(null)
        return
      }
      // Ctrl+A / Cmd+A: select all visible tasks
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(filteredTasks.map((t) => t.id)))
        setLastClickedId(filteredTasks.length > 0 ? filteredTasks[filteredTasks.length - 1].id : null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [filteredTasks])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const hasRunning =
      runningTasks[deleteTarget.id] === 'running' ||
      runningTasks[deleteTarget.id] === 'retrying' ||
      runningAgentTaskIds.has(deleteTarget.id) ||
      runningBackgroundTaskIds.has(deleteTarget.id) ||
      streamingTaskIds.has(deleteTarget.id) ||
      activeTeams[deleteTarget.id] !== undefined
    if (hasRunning) {
      abortTask(deleteTarget.id)
    }
    clearPendingTaskMessages(deleteTarget.id)
    deleteTask(deleteTarget.id)
    toast.success(t('sidebar_toast.taskDeleted'))
    setDeleteTarget(null)
  }, [
    activeTeams,
    deleteTask,
    deleteTarget,
    runningBackgroundTaskIds,
    runningTasks,
    runningAgentTaskIds,
    streamingTaskIds,
    t
  ])

  const relativeTimeLocale = language === 'zh' ? 'zh-CN' : 'en'

  const renderTaskItem = (
    taskItem: TaskListItem,
    locale: string,
    active: boolean
  ): React.JSX.Element => {
    const statusKind = getTaskStatusKind(taskItem.id)
    const isSelected = selectedIds.has(taskItem.id)
    const isMultiSelectMode = selectedIds.size > 0
    const showBatchMenu = isMultiSelectMode && isSelected

    const handleCheckboxClick = (e: React.MouseEvent): void => {
      e.stopPropagation()
      e.preventDefault()
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(taskItem.id)) next.delete(taskItem.id)
        else next.add(taskItem.id)
        return next
      })
      setLastClickedId(taskItem.id)
    }

    return (
      <ContextMenu key={taskItem.id}>
        <ContextMenuTrigger asChild>
          <button
            ref={(el) => {
              if (el) taskButtonRefs.current.set(taskItem.id, el as HTMLButtonElement)
              else taskButtonRefs.current.delete(taskItem.id)
            }}
            type="button"
            className={cn(
              'group/session relative flex w-full items-center gap-1.5 px-1.5 py-1 text-left transition-colors',
              SIDEBAR_TREE_ROW_CLASS,
              (active || isSelected) ? SIDEBAR_TREE_ACTIVE_CLASS : SIDEBAR_TREE_HOVER_CLASS
            )}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(taskItem.id)) next.delete(taskItem.id)
                  else next.add(taskItem.id)
                  return next
                })
                setLastClickedId(taskItem.id)
                return
              }
              if (e.shiftKey && lastClickedId) {
                e.preventDefault()
                const allIds = filteredTasks.map((t) => t.id)
                const startIdx = allIds.indexOf(lastClickedId)
                const endIdx = allIds.indexOf(taskItem.id)
                if (startIdx !== -1 && endIdx !== -1) {
                  const range = allIds.slice(
                    Math.min(startIdx, endIdx),
                    Math.max(startIdx, endIdx) + 1
                  )
                  setSelectedIds(new Set(range))
                }
                return
              }
              setSelectedIds(new Set())
              setLastClickedId(null)
              openTask(taskItem.id)
            }}
          >
            <span
              className={cn(
                'absolute left-1.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-full transition-opacity',
                isMultiSelectMode || isSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/session:opacity-100'
              )}
              onClick={handleCheckboxClick}
              role="checkbox"
              aria-checked={isSelected}
            >
              {isSelected ? (
                <Check className="size-3.5 text-primary" />
              ) : (
                <span className="size-3.5 rounded-full border border-muted-foreground/50 bg-background/80" />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 font-medium transition-[padding]',
                !(renamingTaskId === taskItem.id) && 'truncate',
                isMultiSelectMode || isSelected ? 'pl-5' : 'pl-0 group-hover/session:pl-5',
                SIDEBAR_TREE_LABEL_CLASS
              )}
            >
              {taskItem.pinned && <Pin className="mr-1 inline size-3 shrink-0 text-muted-foreground" />}
              {renamingTaskId === taskItem.id ? (
                <input
                  ref={renamingInputRef}
                  className="w-full min-w-0 bg-transparent px-0.5 text-[13px] leading-5 font-medium text-foreground outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleRenameConfirm(taskItem.id, renameValue)
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      handleRenameCancel()
                    }
                  }}
                  onBlur={(e) => {
                    handleRenameConfirm(taskItem.id, e.target.value)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                taskItem.title || t('sidebar.defaultTaskTitle')
              )}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {!active && statusKind && (
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    statusKind === 'blocked' && 'bg-amber-500',
                    statusKind === 'running' && 'bg-emerald-500 animate-pulse',
                    statusKind === 'completed' && 'bg-emerald-500'
                  )}
                  aria-label={
                    statusKind === 'blocked'
                      ? t('sidebar.statusBlocked')
                      : statusKind === 'running'
                        ? t('sidebar.statusRunning')
                        : t('sidebar.statusCompleted')
                  }
                />
              )}
              <span className={cn('text-muted-foreground/80', SIDEBAR_TREE_META_CLASS)}>
                {formatRelativeTime(taskItem.updatedAt, locale)}
              </span>
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          {showBatchMenu ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() =>
                  setBatchDeleteTargets(
                    filteredTasks
                      .filter((t) => selectedIds.has(t.id))
                      .map((t) => ({ id: t.id, title: t.title }))
                  )
                }
              >
                <Trash2 className="size-4" />
                {t('sidebar.deleteSelected', { defaultValue: 'Delete {{count}} tasks', count: selectedIds.size })}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  setSelectedIds(new Set(filteredTasks.map((t) => t.id)))
                  setLastClickedId(filteredTasks.length > 0 ? filteredTasks[filteredTasks.length - 1].id : null)
                }}
              >
                <CheckCheck className="size-4" />
                {t('sidebar.selectAll')}
              </ContextMenuItem>
              <ContextMenuItem onClick={clearSelection}>
                <Square className="size-4" />
                {t('sidebar.deselectAll')}
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem
                onClick={() => {
                  togglePinTask(taskItem.id)
                  toast.success(
                    taskItem.pinned
                      ? t('sidebar_toast.unpinned')
                      : t('sidebar_toast.pinnedMsg')
                  )
                }}
              >
                {taskItem.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {taskItem.pinned ? tCommon('action.unpin') : t('sidebar.pinToTop')}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => handleRenameStart(taskItem.id, taskItem.title)}
              >
                <Pencil className="size-4" />
                {tCommon('action.rename')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() =>
                  deferDropdownAction(() =>
                    setDeleteTarget({
                      id: taskItem.id,
                      title: taskItem.title || t('sidebar.defaultTaskTitle')
                    })
                  )
                }
              >
                <Trash2 className="size-4" />
                {tCommon('action.delete')}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <>
      <motion.aside
        className="workspace-sidebar-surface relative flex h-full shrink-0 flex-col bg-sidebar pt-1.5 pb-1.5 text-sidebar-foreground overflow-hidden"
        animate={{ width: leftSidebarOpen ? currentSidebarWidth : LEFT_SIDEBAR_COLLAPSED_WIDTH }}
        transition={{ type: 'spring', stiffness: 400, damping: 38 }}
      >
        <AnimatePresence mode="wait">
          {leftSidebarOpen ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex h-full flex-col"
            >
              {/* Header */}
              <div
                className={cn(
                  'workspace-sidebar-titlebar titlebar-drag flex h-8 shrink-0 items-center px-2',
                  isMac ? 'pl-[78px]' : ''
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="titlebar-no-drag size-8 rounded-md text-muted-foreground/80 hover:text-foreground"
                  onClick={toggleLeftSidebar}
                  title={t('sidebar.toggleSidebar')}
                  aria-pressed={leftSidebarOpen}
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              </div>

              {/* Task list */}
              <div className="flex min-h-0 flex-1 flex-col px-2">
                <div className="flex items-center gap-1.5 py-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('sidebar.searchTasks')}
                      className="h-8 rounded-md border-border/60 bg-background/50 pl-7 pr-2 text-[13px] placeholder:text-muted-foreground/50 focus-visible:ring-1"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
                        onClick={() => setSearchQuery('')}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0 rounded-md border-border/60 bg-background/50 hover:bg-accent hover:text-accent-foreground"
                    onClick={handleCreateTask}
                    title={t('sidebar.newTask')}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>

                {/* Selection toolbar */}
                <AnimatePresence>
                  {selectedIds.size > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-1 rounded-md border border-border/60 bg-accent/50 px-1.5 py-1 mb-0.5">
                        <span className="text-[11px] font-medium text-muted-foreground min-w-0 truncate">
                          {t('sidebar.selectedCount', { count: selectedIds.size })}
                        </span>
                        <div className="ml-auto flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 rounded-sm hover:bg-accent"
                            onClick={() => {
                              setSelectedIds(new Set(filteredTasks.map((t) => t.id)))
                              setLastClickedId(filteredTasks.length > 0 ? filteredTasks[filteredTasks.length - 1].id : null)
                            }}
                            title={t('sidebar.selectAll')}
                          >
                            <CheckCheck className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 rounded-sm hover:bg-accent"
                            onClick={clearSelection}
                            title={t('sidebar.deselectAll')}
                          >
                            <Square className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 rounded-sm hover:bg-destructive/20 hover:text-destructive"
                            onClick={() =>
                              setBatchDeleteTargets(
                                filteredTasks
                                  .filter((t) => selectedIds.has(t.id))
                                  .map((t) => ({ id: t.id, title: t.title }))
                              )
                            }
                            title={t('sidebar.deleteSelected', { count: selectedIds.size })}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div
                  className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2"
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return
                    if (e.button !== 0) return
                    rubberBandStartRef.current = { x: e.clientX, y: e.clientY }
                    setIsRubberBandSelecting(true)
                  }}
                >
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map((taskItem) =>
                      renderTaskItem(
                        taskItem,
                        relativeTimeLocale,
                        chatSurfaceActive &&
                          chatView === 'task' &&
                          taskItem.id === activeTaskId
                      )
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 px-3.5 py-5 text-center text-[12px] text-muted-foreground">
                      {searchQuery ? t('sidebar.noSearchResults') : t('sidebar.noTasks')}
                    </div>
                  )}
                </div>
                {/* Rubber band selection overlay */}
                {isRubberBandSelecting && rubberBandRect && (
                  <div
                    className="pointer-events-none fixed z-50 border border-foreground/15 bg-accent/30"
                    style={{
                      left: rubberBandRect.left,
                      top: rubberBandRect.top,
                      width: rubberBandRect.width,
                      height: rubberBandRect.height
                    }}
                  />
                )}              </div>

              {/* Bottom settings button */}
              <div className="shrink-0 px-2 py-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={handleOpenSettings}
                  title={t('settings.redesign.preferences', { defaultValue: 'Preferences' })}
                >
                  <Settings className="size-4" />
                </Button>
              </div>

              {/* Resize handle */}
              <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize transition-colors hover:bg-muted-foreground/20"
                onMouseDown={(event) => {
                  event.preventDefault()
                  const startX = event.clientX
                  const startWidth = currentSidebarWidth
                  const handleMouseMove = (mouseEvent: MouseEvent): void => {
                    setLeftSidebarWidth(startWidth + (mouseEvent.clientX - startX))
                  }
                  const handleMouseUp = (): void => {
                    const nextWidth = clampLeftSidebarWidth(useUIStore.getState().leftSidebarWidth)
                    setLeftSidebarWidth(nextWidth)
                    updateSettings({ leftSidebarWidth: nextWidth })
                    window.removeEventListener('mousemove', handleMouseMove)
                    window.removeEventListener('mouseup', handleMouseUp)
                  }
                  window.addEventListener('mousemove', handleMouseMove)
                  window.addEventListener('mouseup', handleMouseUp)
                }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full"
            />
          )}
        </AnimatePresence>
      </motion.aside>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCommon('action.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteConfirm', { title: deleteTarget?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              {tCommon('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Delete Dialog */}
      <AlertDialog
        open={!!batchDeleteTargets}
        onOpenChange={(open) => {
          if (!open) setBatchDeleteTargets(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('sidebar.batchDeleteTitle', {
                defaultValue: 'Delete {{count}} tasks',
                count: batchDeleteTargets?.length ?? 0
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.batchDeleteConfirm', {
                defaultValue:
                  'Are you sure you want to delete {{count}} tasks? This action cannot be undone.',
                count: batchDeleteTargets?.length ?? 0
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmBatchDelete}>
              {tCommon('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
