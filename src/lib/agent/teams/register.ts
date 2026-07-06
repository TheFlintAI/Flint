import { toolRegistry } from '../tool-registry'
import { teamEvents } from './events'
import { useTeamStore } from '@/stores/team-store'
import { useChatStore } from '@/stores/chat-store'
import { teamCreateTool } from './tools/team-create'
import { sendMessageTool } from './tools/send-message'
import { teamDeleteTool } from './tools/team-delete'
import { teamStatusTool } from './tools/team-status'
import { waitTool } from './tools/wait-tool'
import { completeWorkTool } from './tools/complete-work'
import { startTeamInboxPoller } from './inbox-poller'

const TEAM_TOOLS = [teamCreateTool, sendMessageTool, teamStatusTool, teamDeleteTool, waitTool, completeWorkTool]

export const TEAM_TOOL_NAMES = new Set(TEAM_TOOLS.map((t) => t.definition.name))

let _teamToolsRegistered = false

export function registerTeamTools(): void {
  if (_teamToolsRegistered) return
  _teamToolsRegistered = true

  for (const tool of TEAM_TOOLS) {
    toolRegistry.add(tool)
  }

  // The in-memory store is the single source of truth for team state. Every
  // member/task/message change flows through teamEvents → handleTeamEvent.
  // There is no on-disk manifest to hydrate from on startup; the persisted
  // store (zustand persist) already restores activeTeam, and the message
  // inbox is owned by the pollers, not by a snapshot fetch.
  teamEvents.on((event) => {
    const taskId = event.taskId ?? useChatStore.getState().activeTaskId ?? undefined
    useTeamStore.getState().handleTeamEvent(event, taskId)
  })

  startTeamInboxPoller()
}

export const teamToolsModule: import('@/lib/tools/tool-module').ToolModule = { register: registerTeamTools }
