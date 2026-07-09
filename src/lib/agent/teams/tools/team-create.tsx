import * as React from 'react'
import type { ToolHandler } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import { encodeStructuredToolResult, encodeToolError, decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { teamEvents } from '../events'
import { useTeamStore } from '@/stores/team-store'
import { createTeamRuntime } from '@/services/tauri-api/team-runtime'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint, isToolLive } from '@/components/chat/tool-panel/parts'
import { firstStringInput } from '@/components/chat/tool-panel/utils'

export const teamCreateTool: ToolHandler = {
  definition: {
    name: 'TeamCreate',
    description:
      'Create a new agent team for parallel collaboration. Use this when a task benefits from multiple agents working simultaneously on different aspects. team_name is required.',
    inputSchema: {
      type: 'object',
      properties: {
        team_name: {
          type: 'string',
          description: 'Short, descriptive name for the team (e.g. "pr-review", "bug-fix-squad"). Required.'
        }
      },
      required: ['team_name']
    }
  },
  execute: async (input, ctx) => {
    const teamName = String(input.team_name)

    // One active team at a time — enforced against the live in-memory store,
    // never against on-disk state. The store is the single source of truth for
    // team lifecycle; the on-disk runtime is just a transport.
    const existing = useTeamStore.getState().activeTeams[ctx.taskId] ?? null
    if (existing) {
      return encodeToolError(
        `Team "${existing.name}" is already active. Call TeamDelete before creating a new one.`
      )
    }

    try {
      const runtime = await createTeamRuntime({
        teamName,
        taskId: ctx.taskId,
        workingFolder: ctx.workingFolder
      })

      teamEvents.emit({
        type: 'team_start',
        taskId: ctx.taskId,
        teamName: runtime.teamName,
        runtimePath: runtime.runtimePath,
        leadAgentId: runtime.leadAgentId,
        permissionMode: runtime.permissionMode,
        teamAllowedPaths: runtime.teamAllowedPaths,
        createdAt: runtime.createdAt
      })

      return encodeStructuredToolResult({
        success: true,
        team_name: runtime.teamName,
        runtime_path: runtime.runtimePath,
        lead_agent_id: runtime.leadAgentId,
        message: `Team "${runtime.teamName}" created. Now create tasks with TaskCreate and spawn agents with SpawnAgent, then use Wait to collect their results.`
      })
    } catch (error) {
      return encodeToolError(error instanceof Error ? error.message : String(error))
    }
  },
  groups: ['team-management'],
  render: {
    kind: 'native-panel',
    renderHeader: teamCreateHeader,
    renderBody: teamCreateBody
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

function errorPre(error: string, ctx: ToolPanelContext): React.ReactNode {
  return <ErrorBlock text={error || ctx.error || ''} />
}

// ── TeamCreate render ──

function teamCreateHeader(ctx: ToolPanelContext): React.ReactNode {
  const isLive = isToolLive(ctx.status)
  const parsed = parseTeamOutput(ctx.outputText)
  const teamName =
    !isLive && parsed.kind === 'object'
      ? readString(parsed.data, 'team_name')
      : firstStringInput(ctx.input, ['team_name'])
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={teamName ? ctx.t('toolPanel.title.TeamCreate', { name: teamName }) : ctx.displayName}
      badges={
        !isLive && parsed.kind === 'object' ? (
          <Badge tone="green">{ctx.t('teamPanel.created')}</Badge>
        ) : null
      }
      titleAttr={teamName || ctx.displayName}
    />
  )
}

function teamCreateBody(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorPre(parsed.error, ctx)
  const data = parsed.kind === 'object' ? parsed.data : {}
  const runtimePath = readString(data, 'runtime_path')
  const leadAgent = readString(data, 'lead_agent_id')
  return (
    <div className="space-y-1.5">
      {runtimePath ? (
        <FieldRow label={ctx.t('teamPanel.runtimePath')} value={runtimePath} mono />
      ) : null}
      {leadAgent ? (
        <FieldRow label={ctx.t('teamPanel.leadAgent')} value={leadAgent} mono />
      ) : null}
      {parsed.kind === 'empty' ? <EmptyHint ctx={ctx} /> : null}
    </div>
  )
}
