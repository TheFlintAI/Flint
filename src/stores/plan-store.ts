import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { useChatStore } from './chat-store'
import { createLogger } from '@/lib/logger'

const log = createLogger('PlanStore')

// --- Types ---

export type PlanStatus =
  | 'drafting'
  | 'awaiting_review'
  | 'approved'
  | 'implementing'
  | 'completed'
  | 'rejected'

export interface Plan {
  id: string
  taskId: string
  title: string
  status: PlanStatus
  filePath?: string
  content?: string
  specJson?: string
  createdAt: number
  updatedAt: number
}

// --- DB persistence helpers (fire-and-forget) ---

function dbCreatePlan(plan: Plan): void {
  tauriCommands
    .invoke('db:plans:create', {
      id: plan.id,
      taskId: plan.taskId,
      title: plan.title,
      status: plan.status,
      filePath: plan.filePath,
      content: plan.content ?? null,
      specJson: plan.specJson ?? null,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    })
    .catch(() => {})
}

function dbUpdatePlan(id: string, patch: Record<string, unknown>): void {
  tauriCommands.invoke('db:plans:update', { id, patch }).catch(() => {})
}

function dbDeletePlan(id: string): void {
  tauriCommands.invoke('db:plans:delete', id).catch(() => {})
}

// --- Row → Plan conversion ---

interface PlanRow {
  id: string
  task_id: string
  title: string
  status: string
  file_path: string | null
  content: string | null
  spec_json: string | null
  created_at: number
  updated_at: number
}

function rowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    status: row.status as PlanStatus,
    filePath: row.file_path ?? undefined,
    content: row.content ?? undefined,
    specJson: row.spec_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function stripPlanPayload(plan: Plan): Plan {
  return {
    ...plan,
    content: undefined,
    specJson: undefined
  }
}

function releaseDormantPlanMemory(
  state: Pick<PlanStore, 'plans' | 'plansByTask' | 'activePlanId'>,
  taskId?: string | null
): void {
  const residentTaskIds = new Set<string>()
  const activeChatTaskId = useChatStore.getState().activeTaskId
  if (activeChatTaskId) {
    residentTaskIds.add(activeChatTaskId)
  }
  if (taskId) {
    residentTaskIds.add(taskId)
  }

  const activePlanTaskId = state.activePlanId
    ? state.plans[state.activePlanId]?.taskId
    : undefined
  if (activePlanTaskId) {
    residentTaskIds.add(activePlanTaskId)
  }

  for (const [planId, plan] of Object.entries(state.plans)) {
    if (residentTaskIds.has(plan.taskId)) continue
    state.plans[planId] = stripPlanPayload(plan)
  }
}

// --- Store ---

interface PlanStore {
  plans: Record<string, Plan>
  plansByTask: Record<string, Plan>
  activePlanId: string | null
  _loaded: boolean

  // Initialization
  loadPlansFromDb: () => Promise<void>
  loadPlanForTask: (taskId: string, force?: boolean) => Promise<Plan | undefined>
  releaseDormantPlans: (taskId?: string | null) => void

  // CRUD
  createPlan: (
    taskId: string,
    title: string,
    options?: Partial<Pick<Plan, 'status' | 'filePath' | 'content' | 'specJson'>>
  ) => Plan
  updatePlan: (planId: string, patch: Partial<Omit<Plan, 'id' | 'taskId' | 'createdAt'>>) => void
  approvePlan: (planId: string) => void
  rejectPlan: (planId: string) => void
  beginImplementation: (planId: string) => void
  completePlan: (planId: string) => void
  deletePlan: (planId: string) => void

  // Queries
  getPlanByTask: (taskId: string) => Plan | undefined
  getPendingReviewPlan: (taskId: string) => Plan | undefined
  getActivePlan: () => Plan | undefined

  // Active plan
  setActivePlan: (planId: string | null) => void
}

export const usePlanStore = create<PlanStore>()(
  immer((set, get) => ({
    plans: {},
    plansByTask: {},
    activePlanId: null,
    _loaded: false,

    loadPlansFromDb: async () => {
      try {
        const rows = (await tauriCommands.invoke('db:plans:list')) as PlanRow[]
        const plansByTask: Record<string, Plan> = {}
        const plans: Record<string, Plan> = {}

        for (const row of rows) {
          const plan = rowToPlan(row)
          plansByTask[plan.taskId] = stripPlanPayload(plan)
        }

        const activeTaskId = useChatStore.getState().activeTaskId
        for (const planSummary of Object.values(plansByTask)) {
          plans[planSummary.id] = planSummary
        }
        if (activeTaskId) {
          const activePlanSummary = plansByTask[activeTaskId]
          if (activePlanSummary) {
            const activeRow = rows.find((row) => row.id === activePlanSummary.id)
            if (activeRow) {
              plans[activePlanSummary.id] = rowToPlan(activeRow)
            }
          }
        }

        set((state) => {
          state.plans = plans
          state.plansByTask = plansByTask
          state._loaded = true
          releaseDormantPlanMemory(state)
        })
      } catch (err) {
        log.error('Failed to load from DB:', err)
        set({ _loaded: true })
      }
    },

    loadPlanForTask: async (taskId, force = false) => {
      const cached = get().plansByTask[taskId]
      const activeCached = cached ? get().plans[cached.id] : undefined
      if (cached && !force) {
        return activeCached ?? cached
      }

      try {
        const row = (await tauriCommands.invoke(
          'db:plans:get-by-task',
          taskId
        )) as PlanRow | null
        if (!row) {
          set((state) => {
            const existing = state.plansByTask[taskId]
            if (existing) {
              delete state.plansByTask[taskId]
              delete state.plans[existing.id]
              if (state.activePlanId === existing.id) {
                state.activePlanId = null
              }
            }
            releaseDormantPlanMemory(state, taskId)
          })
          return undefined
        }

        const plan = rowToPlan(row)
        set((state) => {
          state.plansByTask[taskId] = stripPlanPayload(plan)
          state.plans[plan.id] = plan
          releaseDormantPlanMemory(state, taskId)
        })
        return plan
      } catch (err) {
        log.error('Failed to load plan for task:', err)
        return cached
      }
    },

    releaseDormantPlans: (taskId) => {
      set((state) => {
        releaseDormantPlanMemory(state, taskId)
      })
    },

    createPlan: (taskId, title, options = {}) => {
      const id = nanoid()
      const now = Date.now()
      const plan: Plan = {
        id,
        taskId,
        title,
        status: options.status ?? 'drafting',
        filePath: options.filePath,
        content: undefined,
        specJson: options.specJson,
        createdAt: now,
        updatedAt: now
      }
      set((state) => {
        state.plans[id] = plan
        state.plansByTask[taskId] = stripPlanPayload(plan)
        state.activePlanId = id
        releaseDormantPlanMemory(state, taskId)
      })
      dbCreatePlan(plan)
      useChatStore.getState().clearTaskPromptSnapshot(taskId)
      return plan
    },

    updatePlan: (planId, patch) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          Object.assign(plan, patch, { updatedAt: now })
          state.plansByTask[plan.taskId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.taskId)
        }
      })
      const dbPatch: Record<string, unknown> = { updatedAt: now }
      if (patch.title !== undefined) dbPatch.title = patch.title
      if (patch.status !== undefined) dbPatch.status = patch.status
      if (patch.filePath !== undefined) dbPatch.filePath = patch.filePath
      if (patch.specJson !== undefined) dbPatch.specJson = patch.specJson
      dbUpdatePlan(planId, dbPatch)
      const plan = get().plans[planId]
      if (plan?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(plan.taskId)
      }
    },

    approvePlan: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'approved'
          plan.updatedAt = now
          state.plansByTask[plan.taskId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.taskId)
        }
      })
      dbUpdatePlan(planId, { status: 'approved', updatedAt: now })
      const plan = get().plans[planId]
      if (plan?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(plan.taskId)
      }
    },

    rejectPlan: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'rejected'
          plan.updatedAt = now
          state.plansByTask[plan.taskId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.taskId)
        }
      })
      dbUpdatePlan(planId, { status: 'rejected', updatedAt: now })
      const plan = get().plans[planId]
      if (plan?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(plan.taskId)
      }
    },

    beginImplementation: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'implementing'
          plan.updatedAt = now
          state.plansByTask[plan.taskId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.taskId)
        }
      })
      dbUpdatePlan(planId, { status: 'implementing', updatedAt: now })
      const plan = get().plans[planId]
      if (plan?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(plan.taskId)
      }
    },

    completePlan: (planId) => {
      const now = Date.now()
      set((state) => {
        const plan = state.plans[planId]
        if (plan) {
          plan.status = 'completed'
          plan.updatedAt = now
          state.plansByTask[plan.taskId] = stripPlanPayload(plan)
          releaseDormantPlanMemory(state, plan.taskId)
        }
      })
      dbUpdatePlan(planId, { status: 'completed', updatedAt: now })
      const plan = get().plans[planId]
      if (plan?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(plan.taskId)
      }
    },

    deletePlan: (planId) => {
      const existingPlan = get().plans[planId]
      set((state) => {
        delete state.plans[planId]
        if (existingPlan?.taskId) {
          delete state.plansByTask[existingPlan.taskId]
        }
        if (state.activePlanId === planId) {
          state.activePlanId = null
        }
        releaseDormantPlanMemory(state)
      })
      dbDeletePlan(planId)
      if (existingPlan?.taskId) {
        useChatStore.getState().clearTaskPromptSnapshot(existingPlan.taskId)
      }
    },

    getPlanByTask: (taskId) => {
      const cached = get().plansByTask[taskId]
      if (!cached) return undefined
      return get().plans[cached.id] ?? cached
    },

    getPendingReviewPlan: (taskId) => {
      const plan = get().getPlanByTask(taskId)
      return plan?.status === 'awaiting_review' ? plan : undefined
    },

    getActivePlan: () => {
      const { plans, activePlanId } = get()
      return activePlanId ? plans[activePlanId] : undefined
    },

    setActivePlan: (planId) =>
      set((state) => {
        state.activePlanId = planId
        const taskId = planId ? state.plans[planId]?.taskId : undefined
        releaseDormantPlanMemory(state, taskId)
      })
  }))
)
