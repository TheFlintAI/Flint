import type { TeamRuntimePermissionUpdatePayload } from '@/protocols/team-runtime-types'
import { consumeTeamRuntimeMessages } from '@/services/tauri-api/team-runtime'
import { useTeamStore } from '@/stores/team-store'
import { requestTeammateShutdown } from './teammate-runner'
import { createLogger } from '@/lib/logger'
import { toonDecode } from '@/lib/tools/tool-result-format'

const log = createLogger('TeamRuntime')

const workerMessageCursor = new Map<string, number>()
const workerInboxPollers = new Map<string, ReturnType<typeof setInterval>>()
const seenWorkerMessageIds = new Set<string>()

function parsePermissionUpdate(content: string): TeamRuntimePermissionUpdatePayload | null {
  try {
    const parsed = toonDecode(content) as TeamRuntimePermissionUpdatePayload
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function startWorkerInboxPoller(params: {
  memberId: string
  memberName: string
  /** The team's runtime name (for message bus routing). */
  teamName: string
  /** The owning task ID (for store lookups). */
  taskId: string
  onMessage: (content: string, createdAt: number) => void
}): void {
  if (workerInboxPollers.has(params.memberId)) return

  const timer = setInterval(() => {
    const team = useTeamStore.getState().activeTeams[params.taskId] ?? null
    if (!team?.name) return

    const afterTimestamp = workerMessageCursor.get(params.memberId) ?? 0

    void consumeTeamRuntimeMessages({
      teamName: team.name,
      afterTimestamp,
      recipient: params.memberName,
      includeBroadcast: true,
      limit: 20
    })
      .then((messages) => {
        for (const message of messages) {
          if (seenWorkerMessageIds.has(message.id)) continue
          seenWorkerMessageIds.add(message.id)
          workerMessageCursor.set(
            params.memberId,
            Math.max(workerMessageCursor.get(params.memberId) ?? 0, message.timestamp)
          )

          if (message.type === 'permission_response' || message.type === 'plan_approval_response') {
            continue
          }

          if (message.type === 'shutdown_request') {
            requestTeammateShutdown(params.memberId)
            continue
          }

          if (message.type === 'team_permission_update' || message.type === 'mode_set_request') {
            const payload = parsePermissionUpdate(message.content)
            if (!payload) continue
            useTeamStore.getState().updateTeamMeta(params.taskId, {
              ...(payload.permissionMode ? { permissionMode: payload.permissionMode } : {}),
              ...(payload.teamAllowedPaths ? { teamAllowedPaths: payload.teamAllowedPaths } : {})
            })
            continue
          }

          params.onMessage(
            `[Team message from ${message.from}]: ${message.content}`,
            message.timestamp
          )
        }
      })
      .catch((error) => {
        log.error('Worker inbox poll failed:', error)
      })
  }, 1000)

  workerInboxPollers.set(params.memberId, timer)
}

export function stopWorkerInboxPoller(memberId: string): void {
  const timer = workerInboxPollers.get(memberId)
  if (timer) {
    clearInterval(timer)
    workerInboxPollers.delete(memberId)
  }
  workerMessageCursor.delete(memberId)
}
