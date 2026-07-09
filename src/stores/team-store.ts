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
import { createLogger } from '@/lib/logger'

const log = createLogger('TeamStore')

/**
 * Team state model — per-task architecture.
 *
 * Teams are task-scoped entities. Multiple tasks can each have their own
 * running team concurrently. Each non-ended team lives in `activeTeams`
 * keyed by its owning task's ID.
 *
 * The on-disk team runtime (~/.flint/teams/<name>/messages.json) is a
 * separate concern: an append-only inbox that brokers lead↔worker messages.
 * It is NEVER read back to reconstruct member/task state — that was the root
 * cause of the divergence bugs (phantom ID-named agents, members/tasks
 * vanishing on snapshot). Persistence across restarts is handled by zustand
 * `persist`, not by a disk manifest.
 */
export interface ActiveTeam {
  name: string
  taskId: string
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
  /** Per-task active (non-ended) teams. Keyed by task ID. */
  activeTeams: Record<string, ActiveTeam>
  /** Historical teams — moved here on team_end. Flat chronological log. */
  teamHistory: ActiveTeam[]

  /** Get the active team for a specific task, or null. */
  getTeam: (taskId: string) => ActiveTeam | null

  /** Unified event handler. taskId is resolved from event field or parameter. */
  handleTeamEvent: (event: TeamEvent, taskId?: string) => void
  /** Update metadata (permission mode, allowed paths) for a task's team. */
  updateTeamMeta: (taskId: string, patch: Partial<Pick<ActiveTeam, 'permissionMode' | 'teamAllowedPaths'>>) => void

  /** Remove all team data (active + history) that belongs to the given task. */
  clearTaskTeam: (taskId: string) => void
}

function resolveEventTaskId(event: TeamEvent, fallbackTaskId?: string): string | null {
  const fromEvent =
    'taskId' in event ? (event as TeamEvent & { taskId?: string }).taskId : undefined
  const resolved = fallbackTaskId ?? fromEvent ?? null
  if (!resolved) {
    log.error('Team event without resolvable taskId', { type: event.type, fallbackTaskId })
  }
  return resolved
}

export const useTeamStore = create<TeamStore>()(
  persist(
    immer((set, get) => ({
      activeTeams: {},
      teamHistory: [],

      getTeam: (taskId) => get().activeTeams[taskId] ?? null,

      handleTeamEvent: (event, taskId) => {
        const resolvedTaskId = resolveEventTaskId(event, taskId)
        if (!resolvedTaskId) return

        const eventWithTask =
          resolvedTaskId && !(event as TeamEvent & { taskId?: string }).taskId
            ? { ...event, taskId: resolvedTaskId }
            : event

        set((state) => {
          const team = state.activeTeams[resolvedTaskId]

          switch (eventWithTask.type) {
            case 'team_start':
              // Overwrite any existing active team for this task.
              state.activeTeams[resolvedTaskId] = {
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
              if (team) {
                const dup = team.members.some(
                  (m) =>
                    m.id === eventWithTask.member.id || m.name === eventWithTask.member.name
                )
                if (!dup) team.members.push(eventWithTask.member)
              }
              break

            case 'team_member_update':
              if (team) {
                const member = team.members.find(
                  (m) => m.id === eventWithTask.memberId
                )
                if (member) Object.assign(member, eventWithTask.patch)
              }
              break

            case 'team_member_remove':
              if (team) {
                const idx = team.members.findIndex(
                  (m) => m.id === eventWithTask.memberId
                )
                if (idx !== -1) team.members.splice(idx, 1)
              }
              break

            case 'team_task_add':
              if (team) {
                const dupTask = team.tasks.some(
                  (t) => t.id === eventWithTask.task.id
                )
                if (!dupTask) team.tasks.push(eventWithTask.task)
              }
              break

            case 'team_task_update':
              if (team) {
                const task = team.tasks.find((t) => t.id === eventWithTask.taskId)
                if (task) {
                  if (
                    task.status === 'completed' &&
                    eventWithTask.patch.status &&
                    eventWithTask.patch.status !== 'completed'
                  ) {
                    break
                  }
                  Object.assign(task, eventWithTask.patch)
                }
              }
              break

            case 'team_message':
              if (team) {
                if (!Array.isArray(team.messages)) {
                  team.messages = []
                }
                team.messages.push(eventWithTask.message)
              }
              break

            case 'team_end':
              if (team) {
                state.teamHistory.push({ ...team })
              }
              delete state.activeTeams[resolvedTaskId]
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

      updateTeamMeta: (taskId, patch) => {
        set((state) => {
          const team = state.activeTeams[taskId]
          if (!team) return
          Object.assign(team, patch)
        })
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'team_meta', taskId, patch })
        }
      },

      clearTaskTeam: (taskId) => {
        let staleTeamName: string | null = null
        set((state) => {
          const team = state.activeTeams[taskId]
          if (team) {
            staleTeamName = team.name
            delete state.activeTeams[taskId]
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
        activeTeams: state.activeTeams,
        teamHistory: state.teamHistory
      })
    }
  )
)
