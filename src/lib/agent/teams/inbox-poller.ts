import type {
  TeamRuntimeMessageRecord,
  TeamRuntimePermissionUpdatePayload
} from '@/protocols/team-runtime-types'
import { useTeamStore } from '@/stores/team-store'
import { consumeTeamRuntimeMessages } from '@/services/tauri-api/team-runtime'
import { createLogger } from '@/lib/logger'
import { toonDecode } from '@/lib/tools/tool-result-format'

const log = createLogger('TeamRuntime')

let pollerTimer: ReturnType<typeof setInterval> | null = null
let lastLeadMessageTimestamp = 0
const seenMessageIds = new Set<string>()

function parsePermissionUpdate(content: string): TeamRuntimePermissionUpdatePayload | null {
  try {
    const parsed = toonDecode(content) as TeamRuntimePermissionUpdatePayload
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

async function handleLeadMessage(
  message: TeamRuntimeMessageRecord,
  teamTaskId: string
): Promise<void> {
  if (seenMessageIds.has(message.id)) return
  seenMessageIds.add(message.id)
  lastLeadMessageTimestamp = Math.max(lastLeadMessageTimestamp, message.timestamp)

  if (message.type === 'team_permission_update' || message.type === 'mode_set_request') {
    const payload = parsePermissionUpdate(message.content)
    if (!payload) return

    useTeamStore.getState().updateTeamMeta(teamTaskId, {
      ...(payload.permissionMode ? { permissionMode: payload.permissionMode } : {}),
      ...(payload.teamAllowedPaths ? { teamAllowedPaths: payload.teamAllowedPaths } : {})
    })
    return
  }
}

/** Poll all active teams' inboxes for lead messages. */
export function startTeamInboxPoller(): void {
  if (pollerTimer) return

  pollerTimer = setInterval(() => {
    const { activeTeams } = useTeamStore.getState()
    const entries = Object.entries(activeTeams)
    if (entries.length === 0) return

    for (const [taskId, team] of entries) {
      if (!team.name) continue

      void consumeTeamRuntimeMessages({
        teamName: team.name,
        afterTimestamp: lastLeadMessageTimestamp,
        recipient: 'lead',
        includeBroadcast: true,
        limit: 20
      })
        .then(async (messages) => {
          for (const message of messages) {
            await handleLeadMessage({
              id: message.id,
              from: message.from,
              to: message.to,
              type: message.type,
              content: message.content,
              summary: message.summary,
              timestamp: message.timestamp
            }, taskId)
          }
        })
        .catch((error) => {
          log.error('Lead inbox poll failed:', error)
        })
    }
  }, 1000)
}
