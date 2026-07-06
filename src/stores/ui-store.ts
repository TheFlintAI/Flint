import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  WORKING_FOLDER_PANEL_DEFAULT_WIDTH,
  clampLeftSidebarWidth,
  clampRightPanelWidth,
  clampWorkingFolderPanelWidth
} from '@/components/layout/panel-constants'
import { commandStorage } from '@/services/tauri-api/command-storage'
import { parseChatRoute, replaceChatRoute } from '@/lib/chat-route'
import { useChatStore } from '@/stores/chat-store'
import { createLogger } from '@/lib/logger'

const log = createLogger('UIStore')

// Right panel per-task state

interface RightPanelPerTaskState {
  open: boolean
}

const DEFAULT_RIGHT_PANEL_PER_TASK_STATE: RightPanelPerTaskState = {
  open: false,
}

function snapshotRightPanelPerTaskState(
  state: { rightPanelOpen: boolean },
): RightPanelPerTaskState {
  return {
    open: state.rightPanelOpen,
  }
}

function applyRightPanelPerTaskState(
  perTaskState: RightPanelPerTaskState,
): { rightPanelOpen: boolean } {
  return {
    rightPanelOpen: perTaskState.open,
  }
}

// Re-export public types for consumers

export type NavItem = 'workspace' | 'tools'

export type ChatView = 'task'

export interface MessageListViewState {
  scrollOffset: number
  messageCount: number
  loadedRangeStart: number
  loadedRangeEnd: number
}

export type SettingsTab =
  | 'general'
  | 'memory'
  | 'provider'
  | 'plugin'
  | 'skill'

function normalizeScopeId(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function resolveTaskScope(
  state: Pick<UIStore, 'activeScopedTaskId'>,
  taskId?: string | null
): string | null {
  return normalizeScopeId(
    taskId !== undefined
      ? taskId
      : (state.activeScopedTaskId ?? useChatStore.getState().activeTaskId ?? null)
  )
}

const CHAT_SURFACE_NAV_RESET = {
  settingsPageOpen: false
} as const

interface UIStore {
  activeNavItem: NavItem
  setActiveNavItem: (item: NavItem) => void
  leftSidebarOpen: boolean
  leftSidebarWidth: number
  toggleLeftSidebar: () => void
  setLeftSidebarOpen: (open: boolean) => void
  setLeftSidebarWidth: (width: number) => void
  rightPanelOpen: boolean
  toggleRightPanel: () => void
  setRightPanelOpen: (open: boolean) => void
  openRightPanel: (taskId?: string | null) => void
  workingFolderSheetOpen: boolean
  toggleWorkingFolderSheet: () => void
  setWorkingFolderSheetOpen: (open: boolean) => void
  workingFolderPanelWidth: number
  setWorkingFolderPanelWidth: (width: number) => void
  // Dashboard card state
  rightPanelStateByTask: Record<string, RightPanelPerTaskState | undefined>
  rightPanelWidth: number
  setRightPanelWidth: (width: number) => void
  settingsPageOpen: boolean
  settingsTab: SettingsTab
  openSettingsPage: (tab?: SettingsTab) => void
  closeSettingsPage: () => void
  setSettingsTab: (tab: SettingsTab) => void
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  pendingInsertText: string | null
  setPendingInsertText: (text: string | null) => void
  activeScopedTaskId: string | null
  syncTaskScopedState: (taskId: string | null) => void
  messageListViewStatesByTask: Record<string, MessageListViewState | undefined>
  setMessageListViewState: (taskId: string, state: MessageListViewState | null) => void
  getMessageListViewState: (taskId?: string | null) => MessageListViewState | null
  releaseDormantTaskUiState: (taskId?: string | null) => void
  selectedFiles: string[]
  setSelectedFiles: (files: string[]) => void
  toggleFileSelection: (filePath: string) => void
  clearSelectedFiles: () => void
  chatView: ChatView
  navigateToHome: () => void
  navigateToTask: (taskId?: string | null) => void
  applyChatRouteFromLocation: () => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      activeNavItem: 'workspace',
      setActiveNavItem: (item) =>
        set({ activeNavItem: item, leftSidebarOpen: true, rightPanelOpen: false }),
      leftSidebarOpen: true,
      leftSidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
      toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
      setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
      setLeftSidebarWidth: (width) => set({ leftSidebarWidth: clampLeftSidebarWidth(width) }),
      rightPanelOpen: false,
      toggleRightPanel: () =>
        set((state) => {
          log.info('toggleRightPanel', { from: state.rightPanelOpen, to: !state.rightPanelOpen })
          return { rightPanelOpen: !state.rightPanelOpen }
        }),
      setRightPanelOpen: (open) => {
        if (get().rightPanelOpen !== open) {
          log.info('setRightPanelOpen', { from: get().rightPanelOpen, to: open, stack: new Error().stack })
        }
        set({ rightPanelOpen: open })
      },
      openRightPanel: (taskId) => {
        if (!taskId?.trim()) {
          log.warn('openRightPanel: no taskId provided, cannot auto-open panel')
          return
        }
        const chatStore = useChatStore.getState()
        if (chatStore.activeTaskId === taskId) {
          log.info('openRightPanel: opening panel', { taskId, prevOpen: get().rightPanelOpen })
          set({ rightPanelOpen: true })
        } else {
          log.info('openRightPanel: taskId mismatch, skipping', {
            callTaskId: taskId,
            activeTaskId: chatStore.activeTaskId
          })
        }
      },
      workingFolderSheetOpen: false,
      toggleWorkingFolderSheet: () =>
        set((state) => ({ workingFolderSheetOpen: !state.workingFolderSheetOpen })),
      setWorkingFolderSheetOpen: (open) => set({ workingFolderSheetOpen: open }),
      workingFolderPanelWidth: WORKING_FOLDER_PANEL_DEFAULT_WIDTH,
      setWorkingFolderPanelWidth: (width) =>
        set({ workingFolderPanelWidth: clampWorkingFolderPanelWidth(width) }),
      rightPanelStateByTask: {},
      rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
      setRightPanelWidth: (width) => set({ rightPanelWidth: clampRightPanelWidth(width) }),
      settingsPageOpen: false,
      settingsTab: 'general',
      openSettingsPage: (tab) =>
        set({
          settingsPageOpen: true,
          settingsTab: tab ?? 'general'
        }),
      closeSettingsPage: () => set({ settingsPageOpen: false }),
      setSettingsTab: (tab) => set({ settingsTab: tab }),
      shortcutsOpen: false,
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      pendingInsertText: null,
      setPendingInsertText: (text) => set({ pendingInsertText: text }),
      activeScopedTaskId: null,
      syncTaskScopedState: (taskId) =>
        set((state) => {
          const resolvedTaskId = resolveTaskScope(state, taskId)
          const scopeChanged = state.activeScopedTaskId !== resolvedTaskId

          let rightPanelStatePatch: Partial<UIStore> = {}
          if (scopeChanged) {
            const oldTaskId = state.activeScopedTaskId
            const currentSnapshot = snapshotRightPanelPerTaskState(state)
            const rightPanelStateByTask = { ...state.rightPanelStateByTask }
            if (oldTaskId) {
              rightPanelStateByTask[oldTaskId] = currentSnapshot
            }
            const restored = resolvedTaskId
              ? (rightPanelStateByTask[resolvedTaskId] ?? DEFAULT_RIGHT_PANEL_PER_TASK_STATE)
              : DEFAULT_RIGHT_PANEL_PER_TASK_STATE
            rightPanelStatePatch = {
              rightPanelStateByTask,
              ...applyRightPanelPerTaskState(restored),
            }
            log.info('syncTaskScopedState: scope changed', {
              oldTaskId,
              newTaskId: resolvedTaskId,
              restoredOpen: restored.open,
              prevOpen: state.rightPanelOpen
            })
          }
          return {
            activeScopedTaskId: resolvedTaskId,
            ...rightPanelStatePatch,
          }
        }),
      messageListViewStatesByTask: {},
      setMessageListViewState: (taskId, state) =>
        set((current) => ({
          messageListViewStatesByTask: state
            ? { ...current.messageListViewStatesByTask, [taskId]: state }
            : Object.fromEntries(
                Object.entries(current.messageListViewStatesByTask).filter(
                  ([key]) => key !== taskId
                )
              )
        })),
      getMessageListViewState: (taskId) =>
        taskId ? (get().messageListViewStatesByTask[taskId] ?? null) : null,
      releaseDormantTaskUiState: (keepTaskId) =>
        set((state) => {
          const keep = (key: string): boolean => key === keepTaskId
          const messageListViewStatesByTask = state.messageListViewStatesByTask ?? {}
          const rightPanelStateByTask = state.rightPanelStateByTask ?? {}
          return {
            messageListViewStatesByTask: Object.fromEntries(
              Object.entries(messageListViewStatesByTask).filter(([k]) => keep(k))
            ),
            rightPanelStateByTask: Object.fromEntries(
              Object.entries(rightPanelStateByTask).filter(([k]) => keep(k))
            ),
          }
        }),
      selectedFiles: [],
      setSelectedFiles: (files) => set({ selectedFiles: files }),
      toggleFileSelection: (filePath) =>
        set((state) => ({
          selectedFiles: state.selectedFiles.includes(filePath)
            ? state.selectedFiles.filter((file) => file !== filePath)
            : [...state.selectedFiles, filePath]
        })),
      clearSelectedFiles: () => set({ selectedFiles: [] }),
      chatView: 'task',
      navigateToHome: () => {
        const chatStore = useChatStore.getState()
        let taskId = chatStore.activeTaskId
        if (!taskId) {
          taskId = chatStore.createTask()
        }
        set({ activeNavItem: 'workspace', chatView: 'task', ...CHAT_SURFACE_NAV_RESET })
        replaceChatRoute({ taskId })
      },
      navigateToTask: (taskId) => {
        const store = useChatStore.getState()
        const resolvedTaskId = taskId ?? store.activeTaskId ?? null
        set({ activeNavItem: 'workspace', chatView: 'task', ...CHAT_SURFACE_NAV_RESET })
        replaceChatRoute({ taskId: resolvedTaskId })
      },
      applyChatRouteFromLocation: () => {
        const route = parseChatRoute(window.location.hash)
        const chatStore = useChatStore.getState()

        if (route.taskId) {
          const taskItem = chatStore.tasks.find((item) => item.id === route.taskId)
          if (taskItem) {
            chatStore.setActiveTask(taskItem.id)
            set({ activeNavItem: 'workspace', chatView: 'task' })
            replaceChatRoute({ taskId: taskItem.id })
            return
          }
        }

        // No valid route task: reopen the most recent task if any,
        // otherwise spin up a fresh one.
        const mostRecentId = chatStore.tasks[0]?.id
        const targetTaskId = mostRecentId ?? chatStore.createTask()
        chatStore.setActiveTask(targetTaskId)
        set({ activeNavItem: 'workspace', chatView: 'task' })
        replaceChatRoute({ taskId: targetTaskId })
      }
    }),
    {
      name: 'flint-ui-state',
      storage: createJSONStorage(() => commandStorage),
      partialize: (state) => ({
        leftSidebarOpen: state.leftSidebarOpen,
        leftSidebarWidth: clampLeftSidebarWidth(state.leftSidebarWidth),
        rightPanelWidth: clampRightPanelWidth(state.rightPanelWidth),
        workingFolderSheetOpen: state.workingFolderSheetOpen,
        workingFolderPanelWidth: clampWorkingFolderPanelWidth(state.workingFolderPanelWidth)
      })
    }
  )
)
