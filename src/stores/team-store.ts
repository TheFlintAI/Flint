import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TeamMember, TeamTask, TeamEvent } from '../lib/agent/teams/types'
import { emitAgentRuntimeSync, isAgentRuntimeSyncSuppressed } from '@/lib/agent/runtime-sync'
import type {
  TeamRuntimeMessageRecord,
  TeamRuntimePermissionMode
} from '@/protocols/team-runtime-types'
import { commandStorage } from '@/services/tauri-api/command-storage'
import { deleteTeamRuntime } from '@/services/tauri-api/team-runtime'
import { useUIStore } from './ui-store'

/**
 * Team state model.
 *
 * The in-memory store is the SINGLE source of truth for team lifecycle,
 * members, tasks, meta, and the UI message log. State changes enter only
 * through `teamEvents` (handled by `handleTeamEvent`) and `updateTeamMeta`.
 *
 * The on-disk team runtime (`~/.flint/teams/<name>/messages.json`) is a
 * separate concern: an append-only inbox that brokers lead↔worker messages.
 * It is NEVER read back to reconstruct member/task state — that was the root
 * cause of the divergence bugs (phantom ID-named agents, members/tasks
 * vanishing on snapshot). Persistence across restarts is handled by zustand
 * `persist`, not by a disk manifest.
 */
export interface ActiveTeam {
  name: string
  taskId?: string
  runtimePath?: string
  leadAgentId?: string
  permissionMode?: TeamRuntimePermissionMode
  teamAllowedPaths?: string[]
  members: TeamMember[]
  tasks: TeamTask[]
  messages: TeamRuntimeMessageRecord[]
  createdAt: number
}

interface TeamStore {
  activeTeam: ActiveTeam | null
  /** Historical teams - persisted after team_end */
  teamHistory: ActiveTeam[]

  /** Unified event handler - called from use-chat-actions subscription */
  handleTeamEvent: (event: TeamEvent, taskId?: string) => void
  updateTeamMeta: (patch: Partial<Pick<ActiveTeam, 'permissionMode' | 'teamAllowedPaths'>>) => void

  /** Remove all team data that belongs to the given taskItem */
  clearTaskTeam: (taskId: string) => void
}

export const useTeamStore = create<TeamStore>()(
  persist(
    immer((set) => ({
      activeTeam: null,
      teamHistory: [],

      handleTeamEvent: (event, taskId) => {
        const resolvedTaskId = taskId ?? event.taskId
        const eventWithTask =
          resolvedTaskId && !event.taskId ? { ...event, taskId: resolvedTaskId } : event
        set((state) => {
          switch (eventWithTask.type) {
            case 'team_start':
              state.activeTeam = {
                name: eventWithTask.teamName,
                taskId: resolvedTaskId,
                runtimePath: eventWithTask.runtimePath,
                leadAgentId: eventWithTask.leadAgentId,
                permissionMode: eventWithTask.permissionMode,
                teamAllowedPaths: eventWithTask.teamAllowedPaths ?? [],
                members: [],
                tasks: [],
                messages: [],
                createdAt: eventWithTask.createdAt ?? Date.now()
              }
              break
            case 'team_member_add':
              if (state.activeTeam) {
                // Guard: skip if a member with the same id or name already exists
                const dup = state.activeTeam.members.some(
                  (m) =>
                    m.id === eventWithTask.member.id || m.name === eventWithTask.member.name
                )
                if (!dup) state.activeTeam.members.push(eventWithTask.member)
              }
              break
            case 'team_member_update': {
              if (!state.activeTeam) break
              const member = state.activeTeam.members.find(
                (m) => m.id === eventWithTask.memberId
              )
              if (member) Object.assign(member, eventWithTask.patch)
              break
            }
            case 'team_member_remove': {
              if (!state.activeTeam) break
              const idx = state.activeTeam.members.findIndex(
                (m) => m.id === eventWithTask.memberId
              )
              if (idx !== -1) state.activeTeam.members.splice(idx, 1)
              break
            }
            case 'team_task_add':
              if (state.activeTeam) {
                // Guard: skip if a task with the same id already exists
                const dupTask = state.activeTeam.tasks.some(
                  (t) => t.id === eventWithTask.task.id
                )
                if (!dupTask) state.activeTeam.tasks.push(eventWithTask.task)
              }
              break
            case 'team_task_update': {
              if (!state.activeTeam) break
              const task = state.activeTeam.tasks.find((t) => t.id === eventWithTask.taskId)
              if (task) {
                // Guard: never roll back a completed task to a non-completed status
                if (
                  task.status === 'completed' &&
                  eventWithTask.patch.status &&
                  eventWithTask.patch.status !== 'completed'
                ) {
                  break
                }
                Object.assign(task, eventWithTask.patch)
              }
              break
            }
            case 'team_message':
              if (state.activeTeam) {
                if (!Array.isArray(state.activeTeam.messages)) {
                  state.activeTeam.messages = []
                }
                state.activeTeam.messages.push(eventWithTask.message)
              }
              break
            case 'team_end':
              if (state.activeTeam) {
                state.teamHistory.push({ ...state.activeTeam })
              }
              state.activeTeam = null
              break
          }
        })
        if (
          resolvedTaskId &&
          (eventWithTask.type === 'team_start' || eventWithTask.type === 'team_task_add')
        ) {
          useUIStore.getState().openRightPanel(resolvedTaskId)
        }
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({
            kind: 'team_event',
            event: eventWithTask,
            taskId: resolvedTaskId
          })
        }
      },
      updateTeamMeta: (patch) => {
        set((state) => {
          if (!state.activeTeam) return
          Object.assign(state.activeTeam, patch)
        })
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'team_meta', patch })
        }
      },
      clearTaskTeam: (taskId) => {
        // Tear down both the in-memory state and the on-disk message inbox.
        // History entries already had their inbox removed on team_end, so only
        // the active team can still have a live dir.
        let staleTeamName: string | null = null
        set((state) => {
          if (state.activeTeam?.taskId === taskId) {
            staleTeamName = state.activeTeam.name
            state.activeTeam = null
          }
          state.teamHistory = state.teamHistory.filter((t) => t.taskId !== taskId)
        })
        if (staleTeamName) {
          void deleteTeamRuntime({ teamName: staleTeamName }).catch(() => {
            /* best-effort: a leftover inbox dir is inert */
          })
        }
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'clear_session_team', taskId })
        }
      }
    })),
    {
      name: 'flint-team',
      storage: createJSONStorage(() => commandStorage),
      partialize: (state) => ({
        activeTeam: state.activeTeam,
        teamHistory: state.teamHistory
      })
    }
  )
)
