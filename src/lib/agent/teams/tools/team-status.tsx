import * as React from 'react'
import type { ToolHandler } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import { encodeStructuredToolResult, encodeToolError, decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { useTeamStore } from '@/stores/team-store'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint } from '@/components/chat/tool-panel/parts'
import { enumLabel } from '@/components/chat/tool-panel/utils'

/**
 * TeamStatus — non-blocking snapshot of the current team state.
 * Returns members, tasks, and recent messages without waiting.
 * Use this to check progress without waiting.
 */
export const teamStatusTool: ToolHandler = {
  definition: {
    name: 'TeamStatus',
    description:
      'Get a snapshot of the current team state: all members with their status, all tasks, and recent messages. Non-blocking — returns immediately. Use this to check progress without waiting.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  execute: async (_input, ctx) => {
    const team = useTeamStore.getState().activeTeams[ctx.taskId!] ?? null
    if (!team) {
      return encodeToolError('No active team')
    }

    const completedTasks = team.tasks.filter((t) => t.status === 'completed').length
    const workingMembers = team.members.filter((m) => m.status === 'working').length

    return encodeStructuredToolResult({
      team_name: team.name,
      runtime_path: team.runtimePath,
      lead_agent_id: team.leadAgentId,
      permission_mode: team.permissionMode,
      team_allowed_paths: team.teamAllowedPaths ?? [],
      summary: `${team.members.length} members (${workingMembers} working), ${completedTasks}/${team.tasks.length} tasks completed`,
      members: team.members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        status: m.status,
        model: m.model,
        current_task_id: m.currentTaskId,
        iteration: m.iteration,
        tool_calls_count: m.toolCalls.length,
        started_at: m.startedAt,
        completed_at: m.completedAt
      })),
      tasks: team.tasks.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        depends_on: t.dependsOn
      })),
      recent_messages: team.messages.slice(-10).map((msg) => ({
        from: msg.from,
        to: msg.to,
        type: msg.type,
        content: msg.content,
        summary: msg.summary
      }))
    })
  },
  groups: ['team-management'],
  render: {
    kind: 'native-panel',
    renderHeader: teamStatusHeader,
    renderBadges: teamStatusBadges,
    renderBody: teamStatusBody,
    expandWhileActive: false
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

function readArray<T = unknown>(data: Record<string, unknown>, key: string): T[] {
  const v = data[key]
  return Array.isArray(v) ? (v as T[]) : []
}

// ── Member status tone ──

const MEMBER_STATUS_TONE: Record<string, 'blue' | 'amber' | 'green' | 'red' | 'default'> = {
  working: 'blue',
  idle: 'default',
  waiting: 'amber',
  completed: 'green',
  stopped: 'red',
  failed: 'red',
  removed: 'default',
  timed_out: 'red',
  unknown: 'default'
}

function memberStatusTone(status: string): 'blue' | 'amber' | 'green' | 'red' | 'default' {
  return MEMBER_STATUS_TONE[status] ?? 'default'
}

function taskStatusTone(status: string): 'blue' | 'amber' | 'green' | 'default' {
  if (status === 'completed') return 'green'
  if (status === 'in_progress') return 'amber'
  if (status === 'pending') return 'blue'
  return 'default'
}

// ── Shared bits ──

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-[9px] uppercase tracking-wide text-muted-foreground/55">{children}</div>
  )
}

function streamingLead(
  ctx: ToolPanelContext,
  title: string,
  titleAttr?: string
): React.ReactNode {
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={title || ctx.displayName}
      titleAttr={titleAttr || title || ctx.displayName}
    />
  )
}

function errorLead(ctx: ToolPanelContext, error: string): React.ReactNode {
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={ctx.displayName}
      subtitle={error}
      titleAttr={error || ctx.displayName}
    />
  )
}

function errorPre(error: string, ctx: ToolPanelContext): React.ReactNode {
  return <ErrorBlock text={error || ctx.error || ''} />
}

// ── Extractors ──

interface MemberSnapshot {
  name: string
  role: string
  status: string
  model: string
}
interface TaskSnapshot {
  id: string
  subject: string
  status: string
  owner: string | null
}
interface MessageSnapshot {
  from: string
  to: string
  type: string
  content: string
  summary: string
}

function extractMember(raw: unknown): MemberSnapshot {
  const m = (raw ?? {}) as Record<string, unknown>
  return {
    name: typeof m.name === 'string' ? m.name : '',
    role: typeof m.role === 'string' ? m.role : '',
    status: typeof m.status === 'string' ? m.status : 'unknown',
    model: typeof m.model === 'string' ? m.model : ''
  }
}

function extractTask(raw: unknown): TaskSnapshot {
  const t = (raw ?? {}) as Record<string, unknown>
  return {
    id: typeof t.id === 'string' ? t.id : '',
    subject: typeof t.subject === 'string' ? t.subject : '',
    status: typeof t.status === 'string' ? t.status : 'pending',
    owner: typeof t.owner === 'string' ? t.owner : null
  }
}

function extractMessage(raw: unknown): MessageSnapshot {
  const m = (raw ?? {}) as Record<string, unknown>
  return {
    from: typeof m.from === 'string' ? m.from : '',
    to: typeof m.to === 'string' ? m.to : '',
    type: typeof m.type === 'string' ? m.type : '',
    content: typeof m.content === 'string' ? m.content : '',
    summary: typeof m.summary === 'string' ? m.summary : ''
  }
}

// ── TeamStatus render ──

function teamStatusHeader(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorLead(ctx, parsed.error)
  if (parsed.kind === 'empty') return streamingLead(ctx, ctx.displayName)
  const data = parsed.data
  const teamName = readString(data, 'team_name')
  const summary = readString(data, 'summary')
  const members = readArray(data, 'members')
  const tasks = readArray(data, 'tasks')
  const completedTasks = tasks.filter(
    (t) => (t as Record<string, unknown>).status === 'completed'
  ).length
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={teamName || ctx.displayName}
      subtitle={summary || undefined}
      titleAttr={teamName || ctx.displayName}
    />
  )
}

function teamStatusBadges(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind !== 'object') return null
  const data = parsed.data
  const members = readArray(data, 'members')
  const tasks = readArray(data, 'tasks')
  const completedTasks = tasks.filter(
    (t) => (t as Record<string, unknown>).status === 'completed'
  ).length
  return (
    <>
      <Badge tone="blue">{ctx.t('teamPanel.memberCount', { count: members.length })}</Badge>
      <Badge tone={completedTasks === tasks.length && tasks.length > 0 ? 'green' : 'default'}>
        {ctx.t('teamPanel.taskProgress', { done: completedTasks, total: tasks.length })}
      </Badge>
    </>
  )
}

function teamStatusBody(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorPre(parsed.error, ctx)
  if (parsed.kind === 'empty') {
    return <EmptyHint ctx={ctx} />
  }
  const data = parsed.data
  const members = readArray<unknown>(data, 'members').map(extractMember)
  const tasks = readArray<unknown>(data, 'tasks').map(extractTask)
  const messages = readArray<unknown>(data, 'recent_messages').map(extractMessage)
  const permissionMode = readString(data, 'permission_mode')
  const allowedPaths = readArray<unknown>(data, 'team_allowed_paths').map(String)

  return (
    <div className="space-y-3">
      {permissionMode || allowedPaths.length > 0 ? (
        <div className="space-y-0.5">
          {permissionMode ? (
            <FieldRow label={ctx.t('teamPanel.permissionMode')} value={permissionMode} mono />
          ) : null}
          {allowedPaths.length > 0 ? (
            <FieldRow
              label={ctx.t('teamPanel.allowedPaths')}
              value={allowedPaths.join(', ')}
              mono
            />
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <SectionLabel>{ctx.t('teamPanel.members')}</SectionLabel>
        {members.length === 0 ? (
          <span className="text-[11px] text-muted-foreground/70">{ctx.t('teamPanel.noMembers')}</span>
        ) : (
          members.map((m, i) => (
            <div
              key={`${m.name}-${i}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/40"
            >
              <Badge tone={memberStatusTone(m.status)}>
                {enumLabel(ctx.t, 'teamPanel.memberStatus', m.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">
                {m.name || `#${i}`}
              </span>
              {m.role ? (
                <span className="shrink-0 text-[10px] text-muted-foreground/60">{m.role}</span>
              ) : null}
              {m.model ? (
                <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/50 sm:inline">
                  {m.model}
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="space-y-1">
        <SectionLabel>{ctx.t('teamPanel.tasks')}</SectionLabel>
        {tasks.length === 0 ? (
          <span className="text-[11px] text-muted-foreground/70">{ctx.t('teamPanel.noTasks')}</span>
        ) : (
          tasks.map((t, i) => (
            <div
              key={t.id || i}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/40"
            >
              <Badge tone={taskStatusTone(t.status)}>
                {enumLabel(ctx.t, 'taskPanel.status', t.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t.subject || t.id}
              </span>
              {t.owner ? (
                <span className="shrink-0 text-[10px] text-muted-foreground/60">{t.owner}</span>
              ) : null}
            </div>
          ))
        )}
      </div>

      {messages.length > 0 ? (
        <div className="space-y-1">
          <SectionLabel>{ctx.t('teamPanel.recentMessages')}</SectionLabel>
          {messages.map((m, i) => (
            <div
              key={i}
              className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[11px]"
            >
              <div className="mb-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
                <span className="truncate">{m.from}</span>
                <span>→</span>
                <span className="truncate">{m.to}</span>
              </div>
              <p className="truncate text-foreground/75">{m.summary || m.content}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
