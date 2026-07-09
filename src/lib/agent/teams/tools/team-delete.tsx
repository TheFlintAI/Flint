import * as React from 'react'
import type { ToolHandler } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import { encodeStructuredToolResult, encodeToolError, decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { teamEvents } from '../events'
import { useTeamStore } from '@/stores/team-store'
import { useAgentStore } from '@/stores/agent-store'
import { abortAllTeammates } from '../teammate-runner'
import { removeTeamLimiter } from './spawn-agent'
import { deleteTeamRuntime } from '@/services/tauri-api/team-runtime'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint, isToolLive } from '@/components/chat/tool-panel/parts'

export const teamDeleteTool: ToolHandler = {
  definition: {
    name: 'TeamDelete',
    description:
      'Delete the active team and clean up all resources. Use this when all tasks are completed and the team is no longer needed.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  execute: async (_input, ctx) => {
    const team = useTeamStore.getState().activeTeams[ctx.taskId] ?? null
    if (!team) {
      return encodeToolError('No active team to delete')
    }

    const teamName = team.name
    const memberCount = team.members.length
    const taskCount = team.tasks.length
    const completedCount = team.tasks.filter((t) => t.status === 'completed').length

    abortAllTeammates()
    useAgentStore.getState().clearPendingApprovals()
    removeTeamLimiter(teamName)

    try {
      await deleteTeamRuntime({ teamName })
      teamEvents.emit({ type: 'team_end', taskId: team.taskId })

      return encodeStructuredToolResult({
        success: true,
        team_name: teamName,
        members_removed: memberCount,
        tasks_total: taskCount,
        tasks_completed: completedCount
      })
    } catch (error) {
      return encodeToolError(error instanceof Error ? error.message : String(error))
    }
  },
  groups: ['team-management'],
  render: {
    kind: 'native-panel',
    renderHeader: teamDeleteHeader,
    renderBody: teamDeleteBody
  }
}

// ── Shared output parsing ──

type Parsed =
  | { kind: 'empty' }
  | { kind: 'error'; error: string }
  | { kind: 'object'; data: Record<string, unknown> }

function parseTeamOutput(outputText: string | undefined): Parsed {
  if (!outputText) return { kind: 'empty' }
  const parsed = decodeStructuredToolResult(outputText)
  if (!parsed || Array.isArray(parsed)) return { kind: 'empty' }
  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return { kind: 'error', error: parsed.error.trim() }
  }
  return { kind: 'object', data: parsed as Record<string, unknown> }
}

function readString(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const v = data[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function errorPre(error: string, ctx: ToolPanelContext): React.ReactNode {
  return <ErrorBlock text={error || ctx.error || ''} />
}

// ── TeamDelete render ──

function teamDeleteHeader(ctx: ToolPanelContext): React.ReactNode {
  const isLive = isToolLive(ctx.status)
  const parsed = parseTeamOutput(ctx.outputText)
  const teamName = parsed.kind === 'object' ? readString(parsed.data, 'team_name') : ''
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={teamName ? ctx.t('toolPanel.title.TeamDelete', { name: teamName }) : ctx.displayName}
      badges={!isLive && parsed.kind === 'object' ? <Badge tone="red">{ctx.t('teamPanel.deleted')}</Badge> : null}
      titleAttr={teamName || ctx.displayName}
    />
  )
}

function teamDeleteBody(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorPre(parsed.error, ctx)
  if (parsed.kind === 'empty') {
    return <EmptyHint ctx={ctx} />
  }
  const data = parsed.data
  const membersRemoved = readNumber(data, 'members_removed')
  const tasksTotal = readNumber(data, 'tasks_total')
  const tasksCompleted = readNumber(data, 'tasks_completed')
  return (
    <div className="space-y-0.5">
      {membersRemoved !== null ? (
        <FieldRow label={ctx.t('teamPanel.membersRemoved')} value={String(membersRemoved)} mono />
      ) : null}
      {tasksTotal !== null ? (
        <FieldRow
          label={ctx.t('teamPanel.tasksTotal')}
          value={tasksCompleted !== null ? `${tasksCompleted}/${tasksTotal}` : String(tasksTotal)}
          mono
        />
      ) : null}
    </div>
  )
}
