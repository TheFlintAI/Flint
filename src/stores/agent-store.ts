import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { RequestRetryState, ToolCallState } from '../lib/agent/types'
import { commandStorage } from '@/services/tauri-api/command-storage'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { emitAgentRuntimeSync, isAgentRuntimeSyncSuppressed } from '@/lib/agent/runtime-sync'
import { useTeamStore } from './team-store'
import { createChangeTrackingSlice, type ChangeTrackingState } from './agent/change-tracking'

// Re-export types for consumers that still import from agent-store
export { type FileSnapshot, type FileChange, type ChangeSet, type FileOp } from './agent/change-tracking'

import type { BackgroundProcessState } from './agent/background-process'
import {
  initBackgroundProcessTracking,
  createRegisterBackgroundProcess,
  createStopBackgroundProcess,
  createSendBackgroundProcessInput,
  createRemoveBackgroundProcess,
  createRegisterForegroundShellExec,
  createClearForegroundShellExec,
  createAbortForegroundShellExec
} from './agent/background-process'

import { approvalResolvers } from './agent/approval-flow'
import {
  createRequestApproval,
  createRegisterApprovalSource,
  createResolveApproval,
  createClearPendingApprovals,
  createAddApprovedTool
} from './agent/approval-flow'

import {
  createSwitchToolCallTask,
  createResetLiveTaskExecution,
  createAddToolCall,
  createUpdateToolCall,
  createClearToolCalls
} from './agent/tool-call-cache'

const AGENT_STORE_STORAGE_KEY = 'flint-agent'

export { BackgroundProcessState }

type TaskExecutionStatus = 'running' | 'retrying' | 'completed'

interface AgentStore extends ChangeTrackingState {
  isRunning: boolean
  currentLoopId: string | null
  liveTaskId: string | null
  pendingToolCalls: ToolCallState[]
  executedToolCalls: ToolCallState[]
  taskBackgroundProcessSummaries: Record<string, BackgroundProcessState[]>

  /** Per-task agent running state for sidebar indicators */
  runningTasks: Record<string, TaskExecutionStatus>
  taskRequestRetryState: Record<string, RequestRetryState>

  /** Per-task tool-call cache — stores tool calls when switching away from a task */
  taskToolCallsCache: Record<string, { pending: ToolCallState[]; executed: ToolCallState[] }>

  /** Tool names approved by user during this task — auto-approve on repeat */
  approvedToolNames: string[]
  addApprovedTool: (name: string) => void

  /** Background command tasks (spawned by Bash with run_in_background=true) */
  backgroundProcesses: Record<string, BackgroundProcessState>
  /** Foreground shell exec mapping (toolUseId -> execId), used for in-card stop actions */
  foregroundShellExecByToolUseId: Record<string, string>
  initBackgroundProcessTracking: () => Promise<void>
  registerForegroundShellExec: (toolUseId: string, execId: string) => void
  clearForegroundShellExec: (toolUseId: string) => void
  abortForegroundShellExec: (toolUseId: string) => Promise<void>
  registerBackgroundProcess: (process: {
    id: string
    command: string
    cwd?: string
    taskId?: string
    toolUseId?: string
    description?: string
    source?: string
    terminalId?: string
  }) => void
  stopBackgroundProcess: (id: string) => Promise<void>
  sendBackgroundProcessInput: (id: string, input: string, appendNewline?: boolean) => Promise<void>
  removeBackgroundProcess: (id: string) => void

  setRunning: (running: boolean) => void
  setCurrentLoopId: (id: string | null) => void
  /** Update per-task status. 'completed' auto-clears after ~3 s. null removes entry. */
  setTaskStatus: (taskId: string, status: TaskExecutionStatus | null) => void
  setTaskRequestRetryState: (taskId: string, state: RequestRetryState | null) => void
  isTaskLive: (taskId: string | null | undefined) => boolean
  /** Switch active tool-call context: save current tool calls for prevTask, restore for nextTask */
  switchToolCallTask: (prevTaskId: string | null, nextTaskId: string | null) => void
  resetLiveTaskExecution: (taskId: string) => void
  addToolCall: (tc: ToolCallState, taskId?: string | null) => void
  updateToolCall: (id: string, patch: Partial<ToolCallState>, taskId?: string | null) => void
  clearToolCalls: () => void
  abort: () => void

  /** Remove all data bound to the given task */
  purgeTaskData: (taskId: string) => void
  trimDormantTaskData: (residentTaskIds: string[]) => void

  // Approval flow
  requestApproval: (toolCallId: string) => Promise<boolean>
  registerApprovalSource: (
    toolCallId: string,
    meta: { requestId: string; replyTo: string; source?: 'teammate' | 'teammate-plan' }
  ) => void
  resolveApproval: (toolCallId: string, approved: boolean) => void
  /** Resolve all pending approvals as denied and clear pendingToolCalls (e.g. on team delete) */
  clearPendingApprovals: () => void
}

export const useAgentStore = create<AgentStore>()(
  persist(
    immer((_set, _get) => {
      const set = _set as (
        recipe: (state: AgentStore) => void
      ) => void
      const get = _get as () => AgentStore

      // ---- Background process ----
      const _initBackgroundProcessTracking = initBackgroundProcessTracking(
        set as Parameters<typeof initBackgroundProcessTracking>[0],
        get as Parameters<typeof initBackgroundProcessTracking>[1]
      )
      const _registerForegroundShellExec = createRegisterForegroundShellExec(
        set as Parameters<typeof createRegisterForegroundShellExec>[0],
        get as Parameters<typeof createRegisterForegroundShellExec>[1]
      )
      const _clearForegroundShellExec = createClearForegroundShellExec(
        set as Parameters<typeof createClearForegroundShellExec>[0],
        get as Parameters<typeof createClearForegroundShellExec>[1]
      )
      const _abortForegroundShellExec = createAbortForegroundShellExec(
        set as Parameters<typeof createAbortForegroundShellExec>[0],
        get as Parameters<typeof createAbortForegroundShellExec>[1]
      )
      const _registerBackgroundProcess = createRegisterBackgroundProcess(
        set as Parameters<typeof createRegisterBackgroundProcess>[0],
        get as Parameters<typeof createRegisterBackgroundProcess>[1]
      )
      const _stopBackgroundProcess = createStopBackgroundProcess(
        set as Parameters<typeof createStopBackgroundProcess>[0],
        get as Parameters<typeof createStopBackgroundProcess>[1]
      )
      const _sendBackgroundProcessInput = createSendBackgroundProcessInput(
        set as Parameters<typeof createSendBackgroundProcessInput>[0],
        get as Parameters<typeof createSendBackgroundProcessInput>[1]
      )
      const _removeBackgroundProcess = createRemoveBackgroundProcess(
        set as Parameters<typeof createRemoveBackgroundProcess>[0],
        get as Parameters<typeof createRemoveBackgroundProcess>[1]
      )

      // ---- Approval flow ----
      const _requestApproval = createRequestApproval(
        set as Parameters<typeof createRequestApproval>[0],
        get as Parameters<typeof createRequestApproval>[1]
      )
      const _registerApprovalSource = createRegisterApprovalSource(
        set as Parameters<typeof createRegisterApprovalSource>[0],
        get as Parameters<typeof createRegisterApprovalSource>[1]
      )
      const _resolveApproval = createResolveApproval(
        set as Parameters<typeof createResolveApproval>[0],
        get as Parameters<typeof createResolveApproval>[1]
      )
      const _clearPendingApprovals = createClearPendingApprovals(
        set as Parameters<typeof createClearPendingApprovals>[0],
        get as Parameters<typeof createClearPendingApprovals>[1]
      )
      const _addApprovedTool = createAddApprovedTool(
        set as Parameters<typeof createAddApprovedTool>[0],
        get as Parameters<typeof createAddApprovedTool>[1]
      )

      // ---- Tool call cache ----
      const _switchToolCallTask = createSwitchToolCallTask(
        set as Parameters<typeof createSwitchToolCallTask>[0],
        get as Parameters<typeof createSwitchToolCallTask>[1]
      )
      const _resetLiveTaskExecution = createResetLiveTaskExecution(
        set as Parameters<typeof createResetLiveTaskExecution>[0],
        get as Parameters<typeof createResetLiveTaskExecution>[1]
      )
      const _addToolCall = createAddToolCall(
        set as Parameters<typeof createAddToolCall>[0],
        get as Parameters<typeof createAddToolCall>[1]
      )
      const _updateToolCall = createUpdateToolCall(
        set as Parameters<typeof createUpdateToolCall>[0],
        get as Parameters<typeof createUpdateToolCall>[1]
      )
      const _clearToolCalls = createClearToolCalls(
        set as Parameters<typeof createClearToolCalls>[0],
        get as Parameters<typeof createClearToolCalls>[1]
      )

      return {
        isRunning: false,
        currentLoopId: null,
        liveTaskId: null,
        pendingToolCalls: [],
        executedToolCalls: [],
        runningTasks: {},
        taskRequestRetryState: {},
        taskToolCallsCache: {},
        approvedToolNames: [],
        taskBackgroundProcessSummaries: {},
        backgroundProcesses: {},
        foregroundShellExecByToolUseId: {},

        setRunning: (running) => {
          set((state) => {
            state.isRunning = running
          })
          if (!isAgentRuntimeSyncSuppressed()) {
            emitAgentRuntimeSync({ kind: 'set_running', running })
          }
        },

        setCurrentLoopId: (id) =>
          set((state) => {
            state.currentLoopId = id
          }),

        setTaskStatus: (taskId, status) => {
          set((state) => {
            if (status) {
              state.runningTasks[taskId] = status
            } else {
              delete state.runningTasks[taskId]
              delete state.taskRequestRetryState[taskId]
            }
          })
          if (!isAgentRuntimeSyncSuppressed()) {
            emitAgentRuntimeSync({ kind: 'set_session_status', taskId, status })
          }
          // Auto-clear 'completed' after 3 seconds
          if (status === 'completed') {
            setTimeout(() => {
              set((state) => {
                if (state.runningTasks[taskId] === 'completed') {
                  delete state.runningTasks[taskId]
                  delete state.taskRequestRetryState[taskId]
                }
              })
            }, 3000)
          }
        },

        setTaskRequestRetryState: (taskId, requestRetryState) => {
          const previousStatus = get().runningTasks[taskId]
          set((state) => {
            if (requestRetryState) {
              state.taskRequestRetryState[taskId] = requestRetryState
              state.runningTasks[taskId] = 'retrying'
            } else {
              delete state.taskRequestRetryState[taskId]
              if (state.runningTasks[taskId] === 'retrying') {
                state.runningTasks[taskId] = 'running'
              }
            }
          })
          const nextStatus = get().runningTasks[taskId] ?? null
          if (!isAgentRuntimeSyncSuppressed() && previousStatus !== nextStatus) {
            emitAgentRuntimeSync({ kind: 'set_session_status', taskId, status: nextStatus })
          }
        },

        isTaskLive: (taskId) => {
          if (!taskId) return false
          const state = get()
          if (
            state.runningTasks[taskId] === 'running' ||
            state.runningTasks[taskId] === 'retrying'
          ) {
            return true
          }
          if (
            Object.values(state.backgroundProcesses).some(
              (process) => process.taskId === taskId && process.status === 'running'
            )
          ) {
            return true
          }
          if (useTeamStore.getState().activeTeams[taskId] !== undefined) return true
          return false
        },

        // Background process
        initBackgroundProcessTracking: _initBackgroundProcessTracking,
        registerForegroundShellExec: _registerForegroundShellExec,
        clearForegroundShellExec: _clearForegroundShellExec,
        abortForegroundShellExec: _abortForegroundShellExec,
        registerBackgroundProcess: _registerBackgroundProcess,
        stopBackgroundProcess: _stopBackgroundProcess,
        sendBackgroundProcessInput: _sendBackgroundProcessInput,
        removeBackgroundProcess: _removeBackgroundProcess,

        // Tool call cache
        switchToolCallTask: _switchToolCallTask,
        resetLiveTaskExecution: _resetLiveTaskExecution,
        addToolCall: _addToolCall,
        updateToolCall: _updateToolCall,
        clearToolCalls: _clearToolCalls,

        // Approval flow
        addApprovedTool: _addApprovedTool,
        requestApproval: _requestApproval,
        registerApprovalSource: _registerApprovalSource,
        resolveApproval: _resolveApproval,
        clearPendingApprovals: _clearPendingApprovals,

        // Change tracking slice
        ...createChangeTrackingSlice(set as (recipe: (state: ChangeTrackingState) => void) => void),

        abort: () => {
          set((state) => {
            state.isRunning = false
            state.currentLoopId = null
          })
          for (const [, resolve] of approvalResolvers) {
            resolve(false)
          }
          approvalResolvers.clear()
        },

        purgeTaskData: (taskId) => {
          const processIdsToKill: string[] = []
          set((state) => {
            // Remove cached tool calls for this task
            delete state.taskToolCallsCache[taskId]

            if (state.liveTaskId === taskId) {
              state.pendingToolCalls = []
              state.executedToolCalls = []
            }

            for (const [runId, cs] of Object.entries(state.changeSets)) {
              if (cs.taskId === taskId || cs.changes.some((c) => c.taskId === taskId)) {
                delete state.changeSets[runId]
              }
            }

            // Remove background processes bound to this task
            for (const [key, process] of Object.entries(state.backgroundProcesses)) {
              if (process.taskId === taskId) {
                processIdsToKill.push(key)
                delete state.backgroundProcesses[key]
              }
            }
            delete state.taskBackgroundProcessSummaries[taskId]
          })
          for (const id of processIdsToKill) {
            tauriCommands.invoke(TAURI_COMMANDS.PROCESS_KILL, { id }).catch(() => {})
          }
        },

        trimDormantTaskData: (residentTaskIds) => {
          const residentSet = new Set(residentTaskIds)
          set((state) => {
            const targetTaskIds = new Set<string>([
              ...Object.keys(state.taskToolCallsCache),
              ...Object.keys(state.taskBackgroundProcessSummaries)
            ])

            for (const taskId of targetTaskIds) {
              if (residentSet.has(taskId)) continue

              delete state.taskToolCallsCache[taskId]

              const processes = state.taskBackgroundProcessSummaries[taskId]
              if (processes && processes.length > 0) {
                state.taskBackgroundProcessSummaries[taskId] = processes.map(
                  (p) => ({ ...p, output: '' })
                )
              }
            }
          })
        }
      }
    }),
    {
      name: AGENT_STORE_STORAGE_KEY,
      storage: createJSONStorage(() => commandStorage),
      partialize: (state) => ({
        approvedToolNames: state.approvedToolNames
      })
    }
  )
)
