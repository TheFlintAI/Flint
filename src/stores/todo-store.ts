import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { emitAgentRuntimeSync, isAgentRuntimeSyncSuppressed } from '@/lib/agent/runtime-sync'
import { useChatStore } from './chat-store'
import { useUIStore } from './ui-store'
import { createLogger } from '@/lib/logger'

const log = createLogger('TodoStore')

export interface TodoItem {
  id: string
  taskId?: string
  planId?: string
  subject: string
  description: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string | null
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

// --- DB persistence helpers (fire-and-forget) ---

function dbCreateTodoItem(task: TodoItem, sortOrder: number): void {
  if (!task.taskId) return
  tauriCommands
    .invoke('db:tasks:create', {
      id: task.id,
      taskId: task.taskId,
      planId: task.planId,
      subject: task.subject,
      description: task.description,
      activeForm: task.activeForm,
      status: task.status,
      owner: task.owner,
      blocks: task.blocks,
      blockedBy: task.blockedBy,
      metadata: task.metadata,
      sortOrder,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    })
    .catch(() => {})
}

function dbUpdateTodoItem(id: string, patch: Record<string, unknown>): void {
  tauriCommands.invoke('db:tasks:update', { id, patch }).catch(() => {})
}

function dbDeletePlanItem(id: string): void {
  tauriCommands.invoke('db:tasks:delete', id).catch(() => {})
}

function dbDeletePlanItemsByTask(taskId: string): void {
  tauriCommands.invoke('db:tasks:delete-by-task', taskId).catch(() => {})
}

interface PlanItemRow {
  id: string
  task_id: string
  plan_id: string | null
  subject: string
  description: string
  active_form: string | null
  status: string
  owner: string | null
  blocks: string
  blocked_by: string
  metadata: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

function rowToPlanItem(row: PlanItemRow): TodoItem {
  return {
    id: row.id,
    taskId: row.task_id,
    planId: row.plan_id ?? undefined,
    subject: row.subject,
    description: row.description,
    activeForm: row.active_form ?? undefined,
    status: row.status as TodoItem['status'],
    owner: row.owner,
    blocks: JSON.parse(row.blocks || '[]'),
    blockedBy: JSON.parse(row.blocked_by || '[]'),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function buildDbPatch(
  patch: Partial<Omit<TodoItem, 'id' | 'createdAt'>>,
  now: number
): Record<string, unknown> {
  const dbPatch: Record<string, unknown> = { updatedAt: now }
  if (patch.subject !== undefined) dbPatch.subject = patch.subject
  if (patch.description !== undefined) dbPatch.description = patch.description
  if (patch.activeForm !== undefined) dbPatch.activeForm = patch.activeForm
  if (patch.status !== undefined) dbPatch.status = patch.status
  if (patch.owner !== undefined) dbPatch.owner = patch.owner
  if (patch.blocks !== undefined) dbPatch.blocks = patch.blocks
  if (patch.blockedBy !== undefined) dbPatch.blockedBy = patch.blockedBy
  if (patch.metadata !== undefined) dbPatch.metadata = patch.metadata
  return dbPatch
}

interface TodoStore {
  tasks: TodoItem[]
  /** Plan-scoped cache for background/concurrent plan item updates */
  tasksByTask: Record<string, TodoItem[]>
  /** The taskItem ID tasks are currently loaded for */
  currentTaskId: string | null

  /** Load tasks for a task from DB */
  loadPlanItemsForTask: (taskId: string) => Promise<void>
  /** Add a single task (returns the added task) */
  addPlanItem: (task: TodoItem) => TodoItem
  /** Get a task by ID */
  getPlanItem: (id: string) => TodoItem | undefined
  /** Update a task by ID (partial patch). Returns updated task or undefined if not found. */
  updatePlanItem: (
    id: string,
    patch: Partial<Omit<TodoItem, 'id' | 'createdAt'>>
  ) => TodoItem | undefined
  /** Delete a task by ID */
  deletePlanItem: (id: string) => boolean
  /** Get all tasks */
  getPlanItems: () => TodoItem[]
  /** Get tasks for a specific taskItem */
  getPlanItemsByTask: (taskId: string) => TodoItem[]
  /** Get the currently in_progress task */
  getActivePlanItem: () => TodoItem | undefined
  /** Get progress stats */
  getProgress: () => { total: number; completed: number; percentage: number }
  /** Clear all tasks in memory (does not touch DB) */
  clearPlanItems: () => void
  releaseDormantPlanItems: (residentTaskIds: string[]) => void
  /** Delete all tasks for a task from DB and memory */
  deletePlanItemTasks: (taskId: string) => void
  applySyncedPlanItemAdd: (task: TodoItem) => void
  applySyncedPlanItemUpdate: (id: string, patch: Partial<Omit<TodoItem, 'id' | 'createdAt'>>) => void
  applySyncedPlanItemDelete: (id: string) => void
  applySyncedDeletePlanItemTasks: (taskId: string) => void
}

export const useTodoStore = create<TodoStore>()(
  immer((set, get) => ({
    tasks: [],
    tasksByTask: {},
    currentTaskId: null,

    loadPlanItemsForTask: async (taskId) => {
      // Show cached tasks immediately to avoid stale UI while DB is loading.
      set((state) => {
        const cached = state.tasksByTask[taskId] ?? []
        state.currentTaskId = taskId
        state.tasks = cached
      })

      try {
        const rows = (await tauriCommands.invoke('db:tasks:list-by-task', taskId)) as PlanItemRow[]
        const tasks = rows.map(rowToPlanItem)
        set((state) => {
          state.tasksByTask[taskId] = tasks
          // If user switched again before this async request resolved,
          // only refresh the cache and keep current visible list intact.
          if (state.currentTaskId !== taskId) return
          state.tasks = tasks
        })
      } catch (err) {
        log.error('Failed to load tasks for task:', err)
      }
    },

    addPlanItem: (task) => {
      const now = Date.now()
      const newTask: TodoItem = {
        ...task,
        blocks: task.blocks ?? [],
        blockedBy: task.blockedBy ?? [],
        createdAt: task.createdAt ?? now,
        updatedAt: now
      }
      let sortOrder = 0
      set((state) => {
        const taskId = newTask.taskId
        if (!taskId) {
          sortOrder = state.tasks.length
          state.tasks.push(newTask)
          return
        }

        const taskJobs =
          state.tasksByTask[taskId] ?? (state.currentTaskId === taskId ? state.tasks : [])
        sortOrder = taskJobs.length
        const nextTaskTasks = [...taskJobs, newTask]
        state.tasksByTask[taskId] = nextTaskTasks

        if (
          state.currentTaskId === taskId ||
          (!state.currentTaskId && state.tasks.length === 0)
        ) {
          state.currentTaskId = state.currentTaskId ?? taskId
          state.tasks = nextTaskTasks
        }
      })
      useUIStore.getState().openRightPanel(newTask.taskId)
      dbCreateTodoItem(newTask, sortOrder)
      if (newTask.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(newTask.taskId)
      }
      if (!isAgentRuntimeSyncSuppressed()) {
        emitAgentRuntimeSync({ kind: 'task_add', task: newTask })
      }
      return newTask
    },

    getPlanItem: (id) => {
      const state = get()
      const current = state.tasks.find((t) => t.id === id)
      if (current) return current

      for (const taskJobs of Object.values(state.tasksByTask)) {
        const found = taskJobs.find((t) => t.id === id)
        if (found) return found
      }

      return undefined
    },

    updatePlanItem: (id, patch) => {
      const now = Date.now()
      let updatedTask: TodoItem | undefined

      set((state) => {
        // Build a deduplicated entry list including current tasks if not cached
        const taskEntries = Object.entries(state.tasksByTask)
        if (state.currentTaskId && !state.tasksByTask[state.currentTaskId]) {
          taskEntries.push([state.currentTaskId, state.tasks])
        }

        for (const [taskId, taskJobs] of taskEntries) {
          const idx = taskJobs.findIndex((t) => t.id === id)
          if (idx === -1) continue

          const updated = { ...taskJobs[idx], ...patch, updatedAt: now }
          const nextTaskTasks = [...taskJobs]
          nextTaskTasks[idx] = updated
          state.tasksByTask[taskId] = nextTaskTasks
          updatedTask = updated

          if (state.currentTaskId === taskId) {
            state.tasks = nextTaskTasks
          }
          return
        }
      })

      if (updatedTask) {
        dbUpdateTodoItem(id, buildDbPatch(patch, now))
        if (updatedTask.taskId) {
          useChatStore.getState().clearTaskPromptSnapshot(updatedTask.taskId)
        }
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'task_update', id, patch })
        }
      }
      return updatedTask
    },

    deletePlanItem: (id) => {
      const existingTask = get().getPlanItem(id)
      let deleted = false

      set((state) => {
        const taskEntries = Object.entries(state.tasksByTask)
        if (state.currentTaskId && !state.tasksByTask[state.currentTaskId]) {
          taskEntries.push([state.currentTaskId, state.tasks])
        }

        for (const [taskId, taskJobs] of taskEntries) {
          const hasTarget = taskJobs.some((t) => t.id === id)
          if (!hasTarget) continue

          const cleaned = taskJobs
            .filter((t) => t.id !== id)
            .map((t) => ({
              ...t,
              blocks: t.blocks.filter((b) => b !== id),
              blockedBy: t.blockedBy.filter((b) => b !== id)
            }))
          state.tasksByTask[taskId] = cleaned
          deleted = true

          if (state.currentTaskId === taskId) {
            state.tasks = cleaned
          }
          return
        }
      })

      if (!deleted) return false
      dbDeletePlanItem(id)
      if (existingTask?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(existingTask.taskId)
      }
      if (!isAgentRuntimeSyncSuppressed()) {
        emitAgentRuntimeSync({ kind: 'task_delete', id })
      }
      return true
    },

    getPlanItems: () => get().tasks,

    getPlanItemsByTask: (taskId) => {
      const state = get()
      if (state.currentTaskId === taskId) return state.tasks
      return state.tasksByTask[taskId] ?? []
    },

    getActivePlanItem: () => get().tasks.find((t) => t.status === 'in_progress'),

    getProgress: () => {
      const { tasks } = get()
      const total = tasks.length
      const completed = tasks.filter((t) => t.status === 'completed').length
      return {
        total,
        completed,
        percentage: total === 0 ? 0 : Math.round((completed / total) * 100)
      }
    },

    clearPlanItems: () => set({ tasks: [], currentTaskId: null }),

    releaseDormantPlanItems: (residentTaskIds) => {
      const residentSet = new Set(residentTaskIds)
      set((state) => {
        for (const taskId of Object.keys(state.tasksByTask)) {
          if (!residentSet.has(taskId)) {
            delete state.tasksByTask[taskId]
          }
        }

        if (state.currentTaskId && !residentSet.has(state.currentTaskId)) {
          state.tasks = []
          state.currentTaskId = null
        }
      })
    },

    deletePlanItemTasks: (taskId) => {
      set((state) => {
        delete state.tasksByTask[taskId]

        if (state.currentTaskId === taskId) {
          state.tasks = []
          state.currentTaskId = null
        }
      })
      dbDeletePlanItemsByTask(taskId)
      useChatStore.getState().clearTaskPromptSnapshot(taskId)
      if (!isAgentRuntimeSyncSuppressed()) {
        emitAgentRuntimeSync({ kind: 'task_delete_session', taskId })
      }
    },

    applySyncedPlanItemAdd: (task) => {
      const syncedTask: TodoItem = {
        ...task,
        blocks: task.blocks ?? [],
        blockedBy: task.blockedBy ?? []
      }

      set((state) => {
        const taskId = syncedTask.taskId
        if (!taskId) {
          const idx = state.tasks.findIndex((item) => item.id === syncedTask.id)
          if (idx !== -1) {
            state.tasks[idx] = syncedTask
          } else {
            state.tasks.push(syncedTask)
          }
          return
        }

        const taskJobs =
          state.tasksByTask[taskId] ?? (state.currentTaskId === taskId ? state.tasks : [])
        const existingIndex = taskJobs.findIndex((item) => item.id === syncedTask.id)
        const nextTaskTasks = [...taskJobs]
        if (existingIndex !== -1) {
          nextTaskTasks[existingIndex] = syncedTask
        } else {
          nextTaskTasks.push(syncedTask)
        }

        state.tasksByTask[taskId] = nextTaskTasks
        if (state.currentTaskId === taskId) {
          state.tasks = nextTaskTasks
        }
      })
    },

    applySyncedPlanItemUpdate: (id, patch) => {
      set((state) => {
        const taskEntries = Object.entries(state.tasksByTask)
        if (state.currentTaskId && !state.tasksByTask[state.currentTaskId]) {
          taskEntries.push([state.currentTaskId, state.tasks])
        }

        for (const [taskId, taskJobs] of taskEntries) {
          const idx = taskJobs.findIndex((task) => task.id === id)
          if (idx === -1) continue

          const nextTaskTasks = [...taskJobs]
          nextTaskTasks[idx] = { ...nextTaskTasks[idx], ...patch }
          state.tasksByTask[taskId] = nextTaskTasks

          if (state.currentTaskId === taskId) {
            state.tasks = nextTaskTasks
          }
          return
        }

        const taskIndex = state.tasks.findIndex((task) => task.id === id)
        if (taskIndex !== -1) {
          state.tasks[taskIndex] = { ...state.tasks[taskIndex], ...patch }
        }
      })
    },

    applySyncedPlanItemDelete: (id) => {
      set((state) => {
        const taskEntries = Object.entries(state.tasksByTask)
        if (state.currentTaskId && !state.tasksByTask[state.currentTaskId]) {
          taskEntries.push([state.currentTaskId, state.tasks])
        }

        for (const [taskId, taskJobs] of taskEntries) {
          const hasTarget = taskJobs.some((task) => task.id === id)
          if (!hasTarget) continue

          const cleaned = taskJobs
            .filter((task) => task.id !== id)
            .map((task) => ({
              ...task,
              blocks: task.blocks.filter((item) => item !== id),
              blockedBy: task.blockedBy.filter((item) => item !== id)
            }))
          state.tasksByTask[taskId] = cleaned

          if (state.currentTaskId === taskId) {
            state.tasks = cleaned
          }
          return
        }

        const hasCurrent = state.tasks.some((task) => task.id === id)
        if (hasCurrent) {
          state.tasks = state.tasks.filter((task) => task.id !== id)
        }
      })
    },

    applySyncedDeletePlanItemTasks: (taskId) => {
      set((state) => {
        delete state.tasksByTask[taskId]

        if (state.currentTaskId === taskId) {
          state.tasks = []
          state.currentTaskId = null
        }
      })
    }
  }))
)
