import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout } from './components/layout/Layout'
import { Toaster } from './components/ui/sonner'
import { ConfirmDialogProvider } from './components/ui/confirm-dialog'
import { ErrorBoundary } from './components/error-boundary'
import { useSettingsStore } from './stores/settings-store'
import { initProviderStore } from './stores/provider-store'
import { useAgentStore } from './stores/agent-store'
import { useChatStore } from './stores/chat-store'
import { useTodoStore } from './stores/todo-store'
import { useTeamStore } from './stores/team-store'
import { useUIStore } from './stores/ui-store'
import { scheduleCoreToolsRegistration } from './lib/tools/registration'
import { registerAllProviders } from './lib/api'
import { toast } from 'sonner'
import i18n from './locales'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { settingsKvStore } from '@/services/tauri-api/command-storage'
import { usePluginStore } from '@/stores/plugin-store'
import { agentStream } from '@/services/tauri-api/agent-stream-events'
import { nanoid } from 'nanoid'
import type { UnifiedMessage } from './lib/api/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('App')
import { parseChatRoute, readPersistedChatRoute, replaceChatRoute } from './lib/chat-route'
import {
  installAgentRuntimeSyncListener,
  withAgentRuntimeSyncSuppressed,
  type AgentRuntimeSyncEvent
} from '@/lib/agent/runtime-sync'
import { installTaskRuntimeSyncListener } from '@/lib/agent/task-runtime-sync'
import { loadMemoryIndex } from './lib/agent/memory-files'
import type { MemoryIndexSnapshot } from '@/protocols/memory-types'

// Register synchronous providers and viewers immediately at startup
registerAllProviders()
initProviderStore()
agentStream.attach()

const GLOBAL_MEMORY_REMINDER_MARKER = '[global-memory-update]'
const RENDERER_OOM_RECOVERY_PARAM = 'ocRecoverWebviewOom'

function consumeWebviewOomRecoveryFlag(): boolean {
  const url = new URL(window.location.href)
  const shouldRecover = url.searchParams.get(RENDERER_OOM_RECOVERY_PARAM) === '1'
  if (!shouldRecover) return false

  url.searchParams.delete(RENDERER_OOM_RECOVERY_PARAM)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return true
}

function buildGlobalMemoryReminder(snapshot: MemoryIndexSnapshot): string {
  const timeLabel = snapshot.updated_at
    ? new Date(snapshot.updated_at).toLocaleString()
    : new Date().toLocaleString()
  const entryCount = snapshot.total_entries
  const statusLine = entryCount > 0
    ? `Global memory updated (${timeLabel}). ${entryCount} entries.`
    : `Global memory unavailable or empty (${timeLabel}).`
  return [
    '<system-reminder>',
    GLOBAL_MEMORY_REMINDER_MARKER,
    statusLine,
    '</system-reminder>'
  ].join('\n')
}

function upsertGlobalMemoryReminder(taskId: string, snapshot: MemoryIndexSnapshot): void {
  const store = useChatStore.getState()
  const messages = store.getTaskMessages(taskId)
  const reminder = buildGlobalMemoryReminder(snapshot)
  const existing = [...messages].reverse().find((msg) => {
    if (msg.role !== 'system') return false
    if (typeof msg.content !== 'string') return false
    return msg.content.includes(GLOBAL_MEMORY_REMINDER_MARKER)
  })

  if (existing) {
    store.updateMessage(taskId, existing.id, { content: reminder })
    return
  }

  const msg: UnifiedMessage = {
    id: nanoid(),
    role: 'system',
    content: reminder,
    createdAt: Date.now()
  }
  store.addMessage(taskId, msg)
}

function App(): React.JSX.Element {
  const { t } = useTranslation('common')
  const appReady = useChatStore((s) => s._loaded)
  const webviewOomRecoveryRef = useRef(consumeWebviewOomRecoveryFlag())

  // Ensure dark mode is always active
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // Load tasks from SQLite on startup
  useEffect(() => {
    void (async () => {
      const currentRoute = parseChatRoute(window.location.hash)
      const currentRouteIsDefaultHome = !currentRoute.taskId

      if (currentRouteIsDefaultHome) {
        const persistedRoute = await readPersistedChatRoute()
        if (persistedRoute?.taskId) {
          replaceChatRoute(persistedRoute)
        }
      }

      await useChatStore.getState().loadFromDb()
      useUIStore.getState().applyChatRouteFromLocation()

      if (webviewOomRecoveryRef.current) {
        const recoveryTaskId = useChatStore.getState().activeTaskId
        useUIStore.setState({ rightPanelOpen: false })
        await useChatStore.getState().recoverFromWebviewOom(recoveryTaskId)
        toast.warning(t('app.errors.recoveredReducedMemory'))
      }
    })()

    // Restore persisted API key from settings store
    settingsKvStore.init().then(() => {
      const key = settingsKvStore.get('apiKey')
      if (typeof key === 'string' && key) {
        useSettingsStore.getState().updateSettings({ apiKey: key })
      }
    })
  }, [])

  // Schedule deferred core tools registration
  useEffect(() => {
    scheduleCoreToolsRegistration()
  }, [])

  // Sync route state from hash changes
  useEffect(() => {
    const syncFromLocation = (): void => {
      useUIStore.getState().applyChatRouteFromLocation()
    }

    window.addEventListener('hashchange', syncFromLocation)
    return () => window.removeEventListener('hashchange', syncFromLocation)
  }, [])

  useEffect(() => installTaskRuntimeSyncListener(), [])

  useEffect(
    () =>
      installAgentRuntimeSyncListener((event: AgentRuntimeSyncEvent) => {
        withAgentRuntimeSyncSuppressed(() => {
          const store = useAgentStore.getState()
          switch (event.kind) {
            case 'set_running':
              store.setRunning(event.running)
              return
            case 'set_session_status':
              store.setTaskStatus(event.taskId, event.status)
              return
            case 'add_tool_call':
              store.addToolCall(event.toolCall, event.taskId)
              return
            case 'update_tool_call':
              store.updateToolCall(event.id, event.patch, event.taskId)
              return
            case 'task_add':
              useTodoStore.getState().applySyncedPlanItemAdd(event.task)
              return
            case 'task_update':
              useTodoStore.getState().applySyncedPlanItemUpdate(event.id, event.patch)
              return
            case 'task_delete':
              useTodoStore.getState().applySyncedPlanItemDelete(event.id)
              return
            case 'task_delete_session':
              useTodoStore.getState().applySyncedDeletePlanItemTasks(event.taskId)
              return
            case 'team_event':
              useTeamStore.getState().handleTeamEvent(event.event, event.taskId ?? undefined)
              return
            case 'team_meta':
              useTeamStore.getState().updateTeamMeta(event.patch)
              return
            case 'clear_session_team':
              useTeamStore.getState().clearTaskTeam(event.taskId)
              return
            case 'resolve_approval':
              store.resolveApproval(event.toolCallId, event.approved)
              return
            case 'clear_pending_approvals':
              store.clearPendingApprovals()
              return
          }
        })
      }),
    []
  )

  // Listen for backend task update / delete events
  useEffect(() => {
    const offTaskUpdated = tauriCommands.on(
      TAURI_COMMANDS.CHAT_TASK_UPDATED,
      (data: unknown) => {
        const payload = data as {
          reason?: string
          task?: {
            id: string
            title: string
            icon: string | null
            created_at: number
            updated_at: number
            project_id?: string | null
            working_folder: string | null
            ssh_connection_id?: string | null
            pinned: number
            message_count?: number
            provider_id?: string | null
            model_id?: string | null
          }
        }

        if (!payload?.task?.id) return
        const taskPayload = payload.task

        const structuralReasons = new Set([
          'message-added',
          'messages-cleared',
          'messages-replaced',
          'messages-truncated',
          'task-created'
        ])
        const reason = payload.reason ?? ''
        const chatState = useChatStore.getState()
        const existingTask = chatState.tasks.find(
          (taskItem) => taskItem.id === taskPayload.id
        )
        const payloadMessageCount =
          taskPayload.message_count ??
          existingTask?.messageCount ??
          existingTask?.messages.length ??
          0
        const localMessageCount =
          existingTask?.messageCount ?? existingTask?.messages.length ?? 0
        const hasResidentMessages = Boolean(
          existingTask &&
          (existingTask.messages.length > 0 ||
            (existingTask.messagesLoaded && existingTask.messageCount > 0))
        )
        const isAppendReason =
          reason === 'message-added' || reason === 'task-created'
        const isReplaceReason = reason === 'messages-replaced' || reason === 'messages-truncated'
        const shouldReloadMessages =
          structuralReasons.has(reason) &&
          hasResidentMessages &&
          (isReplaceReason || (isAppendReason && localMessageCount !== payloadMessageCount))

        chatState.upsertTaskFromSync(taskPayload, {
          preserveLoadedMessages: hasResidentMessages || shouldReloadMessages
        })

        if (shouldReloadMessages) {
          void chatState
            .loadRecentTaskMessages(taskPayload.id, true)
            .finally(() => useChatStore.getState().releaseDormantTasks())
        }
      }
    )

    const offTaskDeleted = tauriCommands.on(
      TAURI_COMMANDS.CHAT_TASK_DELETED,
      (data: unknown) => {
        const payload = data as { taskId?: string }
        if (!payload?.taskId) return
        useChatStore.getState().removeTaskFromSync(payload.taskId)
      }
    )

    return () => {
      offTaskUpdated()
      offTaskDeleted()
    }
  }, [])

  // Watch global memory file and refresh system context on changes
  useEffect(() => {
    let disposed = false
    let ready = false
    let lastTotalCount = 0

    const init = async (): Promise<void> => {
      const snapshot = await loadMemoryIndex(tauriCommands)
      if (snapshot) {
        lastTotalCount = snapshot.total_entries
      }
      ready = true
    }

    void init()

    // Poll for memory index changes every 30s
    const interval = setInterval(async () => {
      if (disposed || !ready) return
      try {
        const snapshot = await loadMemoryIndex(tauriCommands)
        if (snapshot.total_entries !== lastTotalCount) {
          lastTotalCount = snapshot.total_entries
          const taskId = useChatStore.getState().activeTaskId
          if (taskId) {
            upsertGlobalMemoryReminder(taskId, snapshot)
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 30_000)

    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [])

  // Sync i18n language with settings store
  const language = useSettingsStore((s) => s.language)
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language)
    }
  }, [language])

  // Initialize plugin system
  useEffect(() => {
    let disposed = false

    async function initPlugins(): Promise<void> {
      try {
        if (!disposed) {
          await usePluginStore.getState().initialize()
        }
      } catch (error) {
        log.error('Failed to initialize plugin system:', error)
      }
    }

    initPlugins()

    return () => {
      disposed = true
    }
  }, [])

  // Global unhandled promise rejection handler
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent): void => {
      log.error('Unhandled rejection:', e.reason)
      toast.error(t('app.errors.unhandledTitle'), {
        description: e.reason?.message || String(e.reason)
      })
    }
    window.addEventListener('unhandledrejection', handler)
    return () => window.removeEventListener('unhandledrejection', handler)
  }, [t])

  // Fade out and remove the static pre-React splash when the app is ready
  useEffect(() => {
    if (!appReady) return
    const el = document.getElementById('pre-react-splash')
    if (!el) return
    el.style.opacity = '0'
    const timer = setTimeout(() => el.remove(), 350)
    return () => clearTimeout(timer)
  }, [appReady])

  return (
    <>
      {appReady && (
        <ErrorBoundary>
          <Layout />
          <Toaster position="bottom-left" theme="system" richColors />
          <ConfirmDialogProvider />
        </ErrorBoundary>
      )}
    </>
  )
}

export default App
