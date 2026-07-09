import type { ToolCallState } from '../types'
import type {
  TeamRuntimeMessageRecord,
  TeamRuntimePermissionUpdatePayload,
  TeamRuntimePlanApprovalRequestPayload
} from '@/protocols/team-runtime-types'
import { useAgentStore } from '@/stores/agent-store'
import { useTeamStore } from '@/stores/team-store'
import { appendTeamRuntimeMessage, consumeTeamRuntimeMessages } from '@/services/tauri-api/team-runtime'
import { createLogger } from '@/lib/logger'
import { toonDecode, toonEncode } from '@/lib/tools/tool-result-format'

const log = createLogger('TeamRuntime')

let pollerTimer: ReturnType<typeof setInterval> | null = null
let lastLeadMessageTimestamp = 0
const seenMessageIds = new Set<string>()
const approvalRequestToToolCallId = new Map<string, string>()

function parseToolCall(content: string): ToolCallState | null {
  try {
    const parsed = toonDecode(content) as ToolCallState
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null
    if (!parsed.input || typeof parsed.input !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function parsePermissionUpdate(content: string): TeamRuntimePermissionUpdatePayload | null {
  try {
    const parsed = toonDecode(content) as TeamRuntimePermissionUpdatePayload
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function parsePlanApprovalRequest(content: string): TeamRuntimePlanApprovalRequestPayload | null {
  try {
    const parsed = toonDecode(content) as TeamRuntimePlanApprovalRequestPayload
    if (!parsed || typeof parsed.requestId !== 'string' || typeof parsed.plan !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function registerPendingApproval(requestId: string, toolCallId: string, replyTo: string): void {
  approvalRequestToToolCallId.set(requestId, toolCallId)
  useAgentStore.getState().registerApprovalSource(toolCallId, { requestId, replyTo })
}

/** Find an active team by its runtime name. */
function findTeamByName(teamName: string): { team: import('@/stores/team-store').ActiveTeam; taskId: string } | null {
  const { activeTeams } = useTeamStore.getState()
  for (const [taskId, team] of Object.entries(activeTeams)) {
    if (team.name === teamName) return { team, taskId }
  }
  return null
}

export async function sendApprovalResponse(params: {
  requestId: string
  approved: boolean
  to: string
  summary?: string
}): Promise<void> {
  const found = findTeamByName('lead') // The lead's team — find by iteration
  // Fallback: try to find any active team (for single-team scenarios)
  const { activeTeams } = useTeamStore.getState()
  const entries = Object.entries(activeTeams)
  if (entries.length === 0) return
  // Use the first active team as the lead's team
  const [taskId, team] = entries[0]

  approvalRequestToToolCallId.delete(params.requestId)

  await appendTeamRuntimeMessage({
    teamName: team.name,
    message: {
      id: `perm-res-${params.requestId}-${Date.now()}`,
      from: 'lead',
      to: params.to,
      type: 'permission_response',
      content: toonEncode({ approved: params.approved, requestId: params.requestId }),
      summary: params.summary,
      timestamp: Date.now()
    }
  })
}

async function handleLeadMessage(
  message: TeamRuntimeMessageRecord,
  teamTaskId: string
): Promise<void> {
  if (seenMessageIds.has(message.id)) return
  seenMessageIds.add(message.id)
  lastLeadMessageTimestamp = Math.max(lastLeadMessageTimestamp, message.timestamp)

  if (message.type === 'permission_request') {
    const toolCall = parseToolCall(message.content)
    if (!toolCall) return

    useAgentStore.getState().addToolCall({
      ...toolCall,
      status: 'pending_approval',
      permission: 'ask'
    })

    registerPendingApproval(message.id, toolCall.id, message.from)
    return
  }

  if (message.type === 'team_permission_update' || message.type === 'mode_set_request') {
    const payload = parsePermissionUpdate(message.content)
    if (!payload) return

    useTeamStore.getState().updateTeamMeta(teamTaskId, {
      ...(payload.permissionMode ? { permissionMode: payload.permissionMode } : {}),
      ...(payload.teamAllowedPaths ? { teamAllowedPaths: payload.teamAllowedPaths } : {})
    })
    return
  }

  if (message.type === 'plan_approval_request') {
    const payload = parsePlanApprovalRequest(message.content)
    if (!payload) return

    const syntheticToolCall: ToolCallState = {
      id: `plan-${payload.requestId}`,
      name: 'PlanApproval',
      input: {
        task_id: payload.taskId ?? null,
        plan: payload.plan,
        from: message.from
      },
      status: 'pending_approval',
      permission: 'ask'
    }

    useAgentStore.getState().addToolCall(syntheticToolCall)
    useAgentStore.getState().registerApprovalSource(syntheticToolCall.id, {
      requestId: payload.requestId,
      replyTo: message.from,
      source: 'teammate-plan'
    })
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
