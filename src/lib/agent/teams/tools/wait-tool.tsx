import * as React from 'react'
import { teamEvents } from '../events'
import { useTeamStore } from '@/stores/team-store'
import { encodeStructuredToolResult, encodeToolError, decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import type { ToolHandler } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import type { TeamRuntimeMessageRecord } from '@/protocols/team-runtime-types'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint } from '@/components/chat/tool-panel/parts'
import { enumLabel } from '@/components/chat/tool-panel/utils'

interface MemberResult {
  memberId: string
  memberName: string
  status: string
}

type ReturnOn = 'all' | 'any' | 'first_message'

const DONE_STATUSES = new Set(['stopped', 'completed', 'failed', 'removed', 'timed_out'])

function resolveMemberResult(memberId: string): MemberResult {
  const team = useTeamStore.getState().activeTeam
  const member = team?.members.find((m) => m.id === memberId)
  return {
    memberId,
    memberName: member?.name ?? memberId,
    status: member?.status ?? 'unknown'
  }
}

export const waitTool: ToolHandler = {
  definition: {
    name: 'Wait',
    description:
      'Synchronize with teammates spawned via Task, with incremental returns. ' +
      '`return_on: "all"` waits for every target to finish (default); `"any"` returns as soon as the first target finishes; `"first_message"` returns as soon as a teammate message arrives. ' +
      'Call Wait repeatedly to collect partial results and re-plan without blocking indefinitely.',
    inputSchema: {
      type: 'object',
      properties: {
        for: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Member IDs of teammates to wait for. If empty or omitted, waits for all currently running teammates.'
        },
        return_on: {
          type: 'string',
          enum: ['all', 'any', 'first_message'],
          description: 'When to return. Default "all".'
        },
        timeout: {
          type: 'number',
          description:
            'Maximum wait time in milliseconds. If omitted, waits indefinitely (subject to return_on). On timeout, returns the current snapshot without forcing remaining targets to a terminal state.'
        }
      }
    }
  },

  execute: async (input, ctx) => {
    const team = useTeamStore.getState().activeTeam
    if (!team) return encodeToolError('No active team. Call TeamCreate first.')

    const memberIds: string[] =
      Array.isArray(input.for) && input.for.length > 0
        ? input.for.map(String)
        : team.members.filter((m) => m.status === 'working').map((m) => m.id)

    const returnOn: ReturnOn =
      input.return_on === 'any' || input.return_on === 'first_message'
        ? input.return_on
        : 'all'

    if (memberIds.length === 0) {
      return encodeStructuredToolResult({
        message: 'No teammates to wait for.',
        completed: [],
        still_running: [],
        messages: [],
        waited: 0,
        total: 0
      })
    }

    const timeoutMs =
      typeof input.timeout === 'number' && input.timeout > 0 ? input.timeout : undefined
    const targetSet = new Set(memberIds)
    const completed = new Map<string, MemberResult>()
    const receivedMessages: TeamRuntimeMessageRecord[] = []

    const snapshotCompleted = (): void => {
      for (const id of targetSet) {
        if (completed.has(id)) continue
        const member = team.members.find((m) => m.id === id)
        if (!member) {
          completed.set(id, { memberId: id, memberName: id, status: 'removed' })
        } else if (DONE_STATUSES.has(member.status)) {
          completed.set(id, resolveMemberResult(id))
        }
      }
    }

    // Pre-check: targets already done.
    snapshotCompleted()

    const isMessageForCaller = (msg: TeamRuntimeMessageRecord): boolean =>
      msg.to === 'lead' || msg.to === ctx.callerAgent

    const shouldReturn = (): boolean => {
      if (returnOn === 'first_message' && receivedMessages.length > 0) return true
      if (returnOn === 'any' && completed.size > 0) return true
      // 'all' (and 'any'/'first_message' also return once everything is done)
      return completed.size >= targetSet.size
    }

    const startWait = Date.now()
    if (!shouldReturn()) {
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined

        const cleanup = (): void => {
          unsub()
          if (timer) clearTimeout(timer)
        }

        const unsub = teamEvents.on((event) => {
          if (ctx.signal.aborted) {
            cleanup()
            resolve()
            return
          }

          if (event.type === 'team_member_update' && targetSet.has(event.memberId)) {
            const patch = event.patch
            if (patch.status && DONE_STATUSES.has(patch.status)) {
              completed.set(event.memberId, resolveMemberResult(event.memberId))
              if (shouldReturn()) {
                cleanup()
                resolve()
              }
            }
          }

          if (event.type === 'team_message') {
            const msg = event.message
            if (isMessageForCaller(msg)) {
              receivedMessages.push(msg)
              if (shouldReturn()) {
                cleanup()
                resolve()
              }
            }
          }
        })

        if (timeoutMs) {
          timer = setTimeout(() => {
            cleanup()
            resolve()
          }, timeoutMs)
        }
      })
    }

    snapshotCompleted()
    const elapsed = Date.now() - startWait

    const allResults = Array.from(targetSet).map((id) =>
      completed.get(id) ?? resolveMemberResult(id)
    )
    const done = allResults.filter((r) => DONE_STATUSES.has(r.status))
    const stillRunning = allResults.filter((r) => !DONE_STATUSES.has(r.status))

    return encodeStructuredToolResult({
      message:
        stillRunning.length === 0
          ? `All ${done.length} teammate(s) completed.`
          : `${done.length} completed, ${stillRunning.length} still running.`,
      completed: done,
      still_running: stillRunning,
      messages: receivedMessages,
      waited: elapsed,
      total: allResults.length
    })
  },

  groups: ['team-management'],
  render: {
    kind: 'native-panel',
    renderHeader: waitHeader,
    renderBody: waitBody
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

interface WaitMember {
  memberId: string
  memberName: string
  status: string
}

interface MsgSnapshot {
  from: string
  to: string
  type: string
  content: string
  summary: string
}

function extractWaitMember(raw: unknown): WaitMember {
  const m = (raw ?? {}) as Record<string, unknown>
  return {
    memberId: typeof m.memberId === 'string' ? m.memberId : '',
    memberName: typeof m.memberName === 'string' ? m.memberName : '',
    status: typeof m.status === 'string' ? m.status : 'unknown'
  }
}

function extractMessage(raw: unknown): MsgSnapshot {
  const m = (raw ?? {}) as Record<string, unknown>
  return {
    from: typeof m.from === 'string' ? m.from : '',
    to: typeof m.to === 'string' ? m.to : '',
    type: typeof m.type === 'string' ? m.type : '',
    content: typeof m.content === 'string' ? m.content : '',
    summary: typeof m.summary === 'string' ? m.summary : ''
  }
}

// ── Wait render ──

function waitHeader(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorLead(ctx, parsed.error)
  if (parsed.kind === 'empty') return streamingLead(ctx, ctx.displayName)
  const data = parsed.data
  const total = readNumber(data, 'total')
  const completed = readArray(data, 'completed')
  const stillRunning = readArray(data, 'still_running')
  const waited = readNumber(data, 'waited')
  const badges: React.ReactNode[] = []
  if (total !== null && completed.length + stillRunning.length > 0) {
    badges.push(
      <Badge key="done" tone={stillRunning.length === 0 ? 'green' : 'amber'}>
        {ctx.t('teamPanel.waitDone', { done: completed.length, total })}
      </Badge>
    )
  }
  if (waited !== null) {
    badges.push(
      <Badge key="waited" tone="default">
        {ctx.t('teamPanel.waited', { sec: (waited / 1000).toFixed(1) })}
      </Badge>
    )
  }
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={ctx.displayName}
      subtitle={readString(data, 'message') || undefined}
      badges={badges.length ? <>{badges}</> : null}
      titleAttr={ctx.displayName}
    />
  )
}

function waitBody(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorPre(parsed.error, ctx)
  if (parsed.kind === 'empty') {
    return <EmptyHint ctx={ctx} />
  }
  const data = parsed.data
  const completed = readArray<unknown>(data, 'completed').map(extractWaitMember)
  const stillRunning = readArray<unknown>(data, 'still_running').map(extractWaitMember)
  const messages = readArray<unknown>(data, 'messages').map(extractMessage)
  const inputTargets = Array.isArray(ctx.input.for) ? ctx.input.for.map(String) : []

  return (
    <div className="space-y-3">
      {inputTargets.length > 0 ? (
        <FieldRow label={ctx.t('teamPanel.waitingFor')} value={inputTargets.join(', ')} mono />
      ) : null}

      {completed.length > 0 ? (
        <div className="space-y-1">
          <SectionLabel>{ctx.t('teamPanel.completed')}</SectionLabel>
          {completed.map((m, i) => (
            <div
              key={m.memberId || i}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs"
            >
              <Badge tone={memberStatusTone(m.status)}>
                {enumLabel(ctx.t, 'teamPanel.memberStatus', m.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                {m.memberName || m.memberId}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {stillRunning.length > 0 ? (
        <div className="space-y-1">
          <SectionLabel>{ctx.t('teamPanel.stillRunning')}</SectionLabel>
          {stillRunning.map((m, i) => (
            <div
              key={m.memberId || i}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs"
            >
              <Badge tone="amber">
                <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
                {enumLabel(ctx.t, 'teamPanel.memberStatus', m.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                {m.memberName || m.memberId}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="space-y-1">
          <SectionLabel>{ctx.t('teamPanel.receivedMessages')}</SectionLabel>
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
