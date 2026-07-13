import { Suspense, lazy, useCallback, useEffect } from 'react'
import { X, PanelLeftOpen, PanelRightOpen, PanelRightClose, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { confirm } from '@/components/ui/confirm-dialog'
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { RightPanel } from './RightPanel'
import { TaskPane } from './TaskPane'
import { ErrorBoundary } from '@/components/error-boundary'
import { WindowControls } from './WindowControls'
import { useUIStore } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { useChatActions } from '@/hooks/use-chat-actions'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PageFallback } from '@/components/ui/lazy-fallback'
import {
  initFocusTracking,
  destroyFocusTracking,
} from '@/services/notifications'

const SettingsPage = lazy(async () => {
  const mod = await import('@/components/settings/SettingsPage')
  return { default: mod.SettingsPage }
})

const KeyboardShortcutsDialog = lazy(async () => {
  const mod = await import('@/components/settings/KeyboardShortcutsDialog')
  return { default: mod.KeyboardShortcutsDialog }
})

export function Layout(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const activeTaskTitle = useChatStore(
    useShallow((s) => {
      const activeTask = s.tasks.find((taskItem) => taskItem.id === s.activeTaskId)
      return activeTask?.title ?? null
    })
  )
  const activeTaskId = useChatStore((s) => s.activeTaskId)
  const tasksLoaded = useChatStore((s) => s._loaded)
  const streamingMessageId = useChatStore((s) => s.streamingMessageId)
  const initBackgroundProcessTracking = useAgentStore((s) => s.initBackgroundProcessTracking)

  const { stopStreaming } = useChatActions()

  const shouldUseStaticWindowTitle = import.meta.env.MODE === 'test' || navigator.webdriver

  useEffect(() => {
    void initBackgroundProcessTracking()
  }, [initBackgroundProcessTracking])

  // Initialise notification focus tracking — runs once at mount
  useEffect(() => {
    initFocusTracking().catch(() => {})
    return () => {
      destroyFocusTracking()
    }
  }, [])

  useEffect(() => {
    if (shouldUseStaticWindowTitle) {
      document.title = 'Flint'
      return
    }

    const base = activeTaskTitle ? `${activeTaskTitle} — Flint` : 'Flint'
    const prefix = streamingMessageId ? '• ' : ''
    document.title = `${prefix}${base}`
  }, [
    activeTaskTitle,
    shouldUseStaticWindowTitle,
    streamingMessageId
  ])

  useEffect(() => {
    if (activeTaskId) return
    const chatStore = useChatStore.getState()
    // Wait until the DB has been hydrated so we don't create a stray task
    // when existing tasks simply haven't loaded yet.
    if (!chatStore._loaded) return
    // Only spin up a new task when there is nothing to reopen;
    // otherwise fall back to the most recently updated task.
    const mostRecent = chatStore.tasks[0]?.id
    if (mostRecent) {
      chatStore.setActiveTask(mostRecent)
      useUIStore.getState().navigateToTask(mostRecent)
      return
    }
    const taskId = chatStore.createTask()
    useUIStore.getState().navigateToTask(taskId)
  }, [activeTaskId, tasksLoaded])

  const settingsPageOpen = useUIStore((s) => s.settingsPageOpen)
  const closeSettingsPage = useUIStore((s) => s.closeSettingsPage)
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar)
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)

  const getActiveTaskSnapshot = useCallback(
    (): ReturnType<typeof useChatStore.getState>['tasks'][number] | undefined =>
      useChatStore.getState().tasks.find((taskItem) => taskItem.id === activeTaskId),
    [activeTaskId]
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent): Promise<void> => {
      // Ctrl+,: Open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        useUIStore.getState().openSettingsPage()
      }
      // Ctrl+B: Toggle left sidebar
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'b') {
        e.preventDefault()
        toggleLeftSidebar()
      }
      // Ctrl+L: Clear current task
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault()
        if (activeTaskId) {
          const taskItem = getActiveTaskSnapshot()
          if (taskItem && taskItem.messageCount > 0) {
            const ok = await confirm({
              title: t('layout.clearConfirm', { count: taskItem.messageCount }),
              variant: 'destructive'
            })
            if (!ok) return
          }
          useChatStore.getState().clearTaskMessages(activeTaskId)
          if (taskItem && taskItem.messageCount > 0) toast.success(t('layout.messagesCleared'))
        }
      }
      // Ctrl+D: Duplicate current task
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        if (activeTaskId) {
          useChatStore.getState().duplicateTask(activeTaskId)
          toast.success(t('layout.taskDuplicated'))
        }
      }
      // Ctrl+P: Pin/unpin current task
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        if (activeTaskId) {
          const taskItem = getActiveTaskSnapshot()
          useChatStore.getState().togglePinTask(activeTaskId)
          toast.success(taskItem?.pinned ? t('layout.unpinned') : t('layout.pinned'))
        }
      }
      // Ctrl+Up/Down: Navigate between tasks
      if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const store = useChatStore.getState()
        const sorted = store.tasks.slice().sort((a, b) => {
          if (a.pinned && !b.pinned) return -1
          if (!a.pinned && b.pinned) return 1
          return b.updatedAt - a.updatedAt
        })
        if (sorted.length < 2) return
        const idx = sorted.findIndex((s) => s.id === store.activeTaskId)
        const next =
          e.key === 'ArrowDown'
            ? (idx + 1) % sorted.length
            : (idx - 1 + sorted.length) % sorted.length
        void useUIStore.getState().navigateToTask(sorted[next].id)
      }
      // Ctrl+Home/End: Scroll to top/bottom of messages
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault()
        const container = document.querySelector('.overflow-y-auto')
        if (container) {
          container.scrollTo({
            top: e.key === 'Home' ? 0 : container.scrollHeight,
            behavior: 'smooth'
          })
        }
      }
      // Escape: Stop streaming
      if (e.key === 'Escape' && streamingMessageId) {
        e.preventDefault()
        stopStreaming()
      }
      // Ctrl+/: Keyboard shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        useUIStore.getState().setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    toggleLeftSidebar,
    activeTaskId,
    stopStreaming,
    streamingMessageId,
    t,
    getActiveTaskSnapshot
  ])

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-screen overflow-hidden bg-sidebar">
        <div className="flex min-h-0 flex-1">
          <WorkspaceSidebar />

          <div className="flex min-w-0 flex-1 flex-col mr-1.5 mb-1.5 mt-1.5">
            <div className="titlebar-drag flex h-8 shrink-0 items-center justify-between pl-2">
              <div className="titlebar-no-drag flex items-center">
                {!leftSidebarOpen ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-md text-muted-foreground/80 hover:text-foreground"
                        onClick={toggleLeftSidebar}
                        aria-pressed={leftSidebarOpen}
                      >
                        <PanelLeftOpen className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t('sidebar.toggleSidebar')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
              <div className="titlebar-no-drag flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-md text-muted-foreground/80 hover:text-foreground"
                      onClick={toggleRightPanel}
                      aria-pressed={rightPanelOpen}
                    >
                      {rightPanelOpen ? (
                        <PanelRightClose className="size-4" />
                      ) : (
                        <PanelRightOpen className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {rightPanelOpen
                      ? t('topbar.closeInspector', { defaultValue: 'Close inspector' })
                      : t('topbar.openInspector', { defaultValue: 'Open inspector' })}
                  </TooltipContent>
                </Tooltip>
                <WindowControls />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-sm relative">
              {!leftSidebarOpen && (
                <div className="absolute left-3 bottom-3 z-10">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-md text-muted-foreground/70 hover:bg-accent hover:text-accent-foreground"
                        onClick={() => useUIStore.getState().openSettingsPage('general')}
                      >
                        <Settings className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {t('settings.redesign.preferences', { defaultValue: 'Preferences' })}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              {/* Intermediate flex wrappers — no overflow-hidden needed here;
                   the parent (line 303) already clips for rounded-2xl */}
              <div className="flex min-h-0 min-w-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <ErrorBoundary
                    renderFallback={(error, reset) => (
                      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden p-8 text-center">
                        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
                          <svg
                            className="size-6 text-destructive"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                            />
                          </svg>
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-foreground">
                            {t('layout.somethingWentWrong')}
                          </h3>
                          <p className="max-w-md text-xs text-muted-foreground">
                            {error?.message || t('layout.unexpectedError')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            onClick={reset}
                          >
                            {t('layout.tryAgain')}
                          </button>
                          <button
                            className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => window.location.reload()}
                          >
                            {t('layout.reloadApp')}
                          </button>
                          <button
                            className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => {
                              const text = `Error: ${error?.message}\nStack: ${error?.stack}`
                              navigator.clipboard.writeText(text)
                            }}
                          >
                            {t('layout.copyError')}
                          </button>
                        </div>
                        {error?.stack && (
                          <details className="w-full max-w-lg text-left">
                            <summary className="cursor-pointer text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                              {t('layout.errorDetails')}
                            </summary>
                            <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted p-2 text-[10px] leading-relaxed text-muted-foreground">
                              {error.stack}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  >
                    <div className="flex min-h-0 min-w-0 flex-1">
                      <TaskPane windowHeaderOwnsTitle />
                      <RightPanel />
                    </div>
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {settingsPageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="flex h-[min(769px,calc(100vh-2rem))] w-[min(1055px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
            <div className="flex h-10 shrink-0 items-center justify-end bg-sidebar px-3">
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={closeSettingsPage}
                aria-label={t('action.close', { ns: 'common', defaultValue: 'Close' })}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<PageFallback />}>
                <SettingsPage />
              </Suspense>
            </div>
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        <KeyboardShortcutsDialog />
      </Suspense>
    </TooltipProvider>
  )
}
