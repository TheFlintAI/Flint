import { nanoid } from 'nanoid'
import * as React from 'react'
import type { ToolHandler } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import { encodeStructuredToolResult, encodeToolError, toonEncode, toonDecode, decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { teamEvents } from '../events'
import { useTeamStore } from '@/stores/team-store'
import type {
  TeamRuntimeMessageRecord,
  TeamRuntimeMessageType,
  TeamRuntimePermissionMode,
  TeamRuntimePermissionUpdatePayload
} from '@/protocols/team-runtime-types'
import { appendTeamRuntimeMessage } from '@/services/tauri-api/team-runtime'
import { MONO_FONT } from '@/lib/utils/fonts'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint } from '@/components/chat/tool-panel/parts'
import { firstStringInput, enumLabel } from '@/components/chat/tool-panel/utils'

const VALID_TYPES: TeamRuntimeMessageType[] = [
  'message',
  'broadcast',
  'shutdown_request',
  'shutdown_response',
  'idle_notification',
  'permission_request',
  'permission_response',
  'plan_approval_request',
  'plan_approval_response',
  'team_permission_update',
  'mode_set_request'
]

export const sendMessageTool: ToolHandler = {
  definition: {
    name: 'SendMessage',
    description:
      'Send a message to a teammate, broadcast to all teammates, or send a shutdown request. Use this for inter-agent communication within the team.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'message',
            'broadcast',
            'shutdown_request',
            'shutdown_response',
            'idle_notification',
            'permission_request',
            'permission_response',
            'plan_approval_request',
            'plan_approval_response',
            'team_permission_update',
            'mode_set_request'
          ],
          description:
            'Structured team message type. Use "message" for direct messages, "broadcast" for team-wide messages, and approval/protocol types for team coordination flows.'
        },
        recipient: {
          type: 'string',
          description:
            'Name of the recipient teammate (required for "message" and "shutdown_request")'
        },
        content: {
          type: 'string',
          description: 'Message content'
        },
        sender: {
          type: 'string',
          description: 'Your name as the sender (defaults to "lead")'
        },
        summary: {
          type: 'string',
          description: 'Optional short summary of the message'
        }
      },
      required: ['type', 'content']
    }
  },
  execute: async (input) => {
    const team = useTeamStore.getState().activeTeam
    if (!team) {
      return encodeToolError('No active team')
    }

    const msgType = String(input.type) as TeamRuntimeMessageType
    if (!VALID_TYPES.includes(msgType)) {
      return encodeToolError(`Invalid message type: ${input.type}`)
    }

    let recipient = msgType === 'broadcast' ? 'all' : String(input.recipient ?? 'all')
    let content = String(input.content)

    if (msgType === 'mode_set_request' || msgType === 'team_permission_update') {
      recipient = 'all'
      const raw = typeof input.content === 'string' ? input.content : toonEncode(input.content)
      let payload: TeamRuntimePermissionUpdatePayload | null = null
      try {
        payload = toonDecode(raw) as TeamRuntimePermissionUpdatePayload
      } catch {
        if (msgType === 'mode_set_request') {
          const mode = raw.trim()
          if (mode === 'default' || mode === 'plan') {
            payload = { permissionMode: mode as TeamRuntimePermissionMode }
          }
        }
      }

      if (!payload) {
        return encodeToolError('Invalid permission update payload')
      }

      // Meta changes live in the in-memory store (single source of truth) and
      // are broadcast to workers via the message bus itself (the
      // team_permission_update message below). No disk manifest write.
      useTeamStore.getState().updateTeamMeta({
        ...(payload.permissionMode ? { permissionMode: payload.permissionMode } : {}),
        ...(payload.teamAllowedPaths ? { teamAllowedPaths: payload.teamAllowedPaths } : {})
      })
      content = toonEncode(payload)
    }

    const msg: TeamRuntimeMessageRecord = {
      id: nanoid(8),
      from: input.sender ? String(input.sender) : 'lead',
      to: recipient,
      type: msgType,
      content,
      summary: input.summary ? String(input.summary) : undefined,
      timestamp: Date.now()
    }

    try {
      await appendTeamRuntimeMessage({
        teamName: team.name,
        message: msg
      })
      teamEvents.emit({ type: 'team_message', taskId: team.taskId, message: msg })

      return encodeStructuredToolResult({
        success: true,
        message_id: msg.id,
        type: msgType,
        to: recipient
      })
    } catch (error) {
      return encodeToolError(error instanceof Error ? error.message : String(error))
    }
  },
  groups: ['team-management'],
  render: {
    kind: 'native-panel',
    renderHeader: sendMessageHeader,
    renderBody: sendMessageBody
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

// ── SendMessage render ──

const MESSAGE_TYPE_TONE: Record<string, 'blue' | 'amber' | 'green' | 'red' | 'default'> = {
  message: 'blue',
  broadcast: 'amber',
  shutdown_request: 'red',
  shutdown_response: 'default',
  permission_request: 'amber',
  permission_response: 'default',
  plan_approval_request: 'amber',
  plan_approval_response: 'default'
}

function sendMessageHeader(ctx: ToolPanelContext): React.ReactNode {
  const msgType = firstStringInput(ctx.input, ['type'])
  const recipient = firstStringInput(ctx.input, ['recipient'])
  const summary = firstStringInput(ctx.input, ['summary'])
  const title = summary || ctx.displayName
  const subtitle = recipient ? `→ ${recipient}` : undefined
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={title}
      subtitle={subtitle}
      badges={
        msgType ? (
          <Badge tone={MESSAGE_TYPE_TONE[msgType] ?? 'default'}>
            {enumLabel(ctx.t, 'teamPanel.messageType', msgType)}
          </Badge>
        ) : null
      }
      titleAttr={title}
    />
  )
}

function sendMessageBody(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorPre(parsed.error, ctx)
  const data = parsed.kind === 'object' ? parsed.data : {}
  const sender = firstStringInput(ctx.input, ['sender'])
  const recipient = firstStringInput(ctx.input, ['recipient'])
  const content = firstStringInput(ctx.input, ['content'])
  const messageId = readString(data, 'message_id')
  const to = readString(data, 'to')
  return (
    <div className="space-y-1.5">
      {(recipient || to) && (
        <FieldRow label={ctx.t('teamPanel.recipient')} value={to || recipient} mono />
      )}
      {sender && <FieldRow label={ctx.t('teamPanel.sender')} value={sender} mono />}
      {messageId && <FieldRow label={ctx.t('teamPanel.messageId')} value={messageId} mono />}
      {content ? (
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/25 px-2.5 py-2 text-[11px] leading-5 text-foreground/80"
          style={{ fontFamily: MONO_FONT }}
        >
          {content}
        </pre>
      ) : null}
      {parsed.kind === 'empty' && !content ? (
        <EmptyHint ctx={ctx} />
      ) : null}
    </div>
  )
}
