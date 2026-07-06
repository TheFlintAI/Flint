import { nanoid } from 'nanoid'
import * as React from 'react'
import type { ToolHandler, ToolContext } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import type { AgentDefinition } from '../types'
import type { ToolResultContent } from '@/lib/api/types'
import { encodeStructuredToolResult, encodeToolError, decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { ConcurrencyLimiter } from '@/lib/agent/concurrency-limiter'
import { teamEvents } from '../events'
import { useTeamStore } from '@/stores/team-store'
import { runTeammate, findNextClaimableTask } from '../teammate-runner'
import type { TeamMember } from '../types'
import { agentRegistry } from '../agent-registry'
import { DEFAULT_AGENT_MAX_TURNS } from '../agent-limits'
import { getEffectiveAgentDisallowedTools } from '../agent-tools'
import { createLogger } from '@/lib/logger'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, isToolLive } from '@/components/chat/tool-panel/parts'
import { firstStringInput } from '@/components/chat/tool-panel/utils'

const log = createLogger('TeamRuntime')

// ── Team context ──

interface TeamContext {
  limiter: ConcurrencyLimiter
  workingFolder?: string
  sshConnectionId?: string
}

const teamContexts = new Map<string, TeamContext>()

function getTeamContext(teamName: string): TeamContext {
  let ctx = teamContexts.get(teamName)
  if (!ctx) {
    ctx = { limiter: new ConcurrencyLimiter(2) }
    teamContexts.set(teamName, ctx)
  }
  return ctx
}

export function removeTeamLimiter(teamName: string): void {
  teamContexts.delete(teamName)
}

// ── Runtime helpers ──

function getTeamTaskDetails(
  description: string | null | undefined,
  subject: string
): string | null {
  const trimmed = typeof description === 'string' ? description.trim() : ''
  if (!trimmed || trimmed === subject.trim()) return null
  return trimmed
}

function buildTeamTaskPrompt(task: { subject: string; description?: string | null }): string {
  const lines = ['Work on the following task:', `**Title:** ${task.subject}`]
  const details = getTeamTaskDetails(task.description, task.subject)
  if (details) {
    lines.push(`**Details:** ${details}`)
  }
  return lines.join('\n')
}

function scheduleNextTask(teamName: string): void {
  const team = useTeamStore.getState().activeTeam
  if (!team || team.name !== teamName) return

  const ctx = teamContexts.get(teamName)
  if (!ctx) return
  const limiter = ctx.limiter
  if (limiter.activeCount >= 2) return

  const nextTask = findNextClaimableTask()
  if (!nextTask) return

  const memberName = `worker-${nanoid(4)}`
  log.debug('scheduling auto-teammate', { teamName, memberName, taskId: nextTask.id, taskSubject: nextTask.subject })
  const member: TeamMember = {
    id: nanoid(),
    name: memberName,
    model: 'default',
    role: 'worker',
    status: 'idle',
    currentTaskId: nextTask.id,
    iteration: 0,
    toolCalls: [],
    streamingText: '',
    toolCursors: {},
    startedAt: Date.now(),
    completedAt: null
  }

  teamEvents.emit({ type: 'team_member_add', taskId: team.taskId, member })
  teamEvents.emit({
    type: 'team_task_update',
    chatTaskId: team.taskId,
    taskId: nextTask.id,
    patch: { status: 'in_progress', owner: memberName }
  })

  limiter
    .acquire()
    .then(() => {
      return runTeammate({
        memberId: member.id,
        memberName,
        prompt: buildTeamTaskPrompt(nextTask),
        taskId: nextTask.id,
        model: null,
        agentName: null,
        workingFolder: ctx.workingFolder,
        sshConnectionId: ctx.sshConnectionId
      }).finally(() => {
        limiter.release()
        scheduleNextTask(teamName)
      })
    })
    .catch((err) => {
      log.error(`Failed to start auto-teammate "${memberName}":`, err)
    })
}

// ── Description builder ──

export const CUSTOM_AGENT_TYPE = 'custom'

function formatAgentToolScope(agent: AgentDefinition): string {
  const tools = agent.tools ?? []
  if (tools.length === 0) return 'Read, Glob, Grep, LS, Skill'
  const denied = getEffectiveAgentDisallowedTools(agent.disallowedTools ?? [])
  if (tools.includes('*')) {
    return denied.length > 0 ? `All tools except ${denied.join(', ')}` : '*'
  }
  return tools.filter((tool) => !denied.includes(tool)).join(', ')
}

function buildTaskDescription(agents: AgentDefinition[]): string {
  const agentLines = agents
    .map((a) => `- ${a.name}: ${a.description} (Tools: ${formatAgentToolScope(a)})`)
    .join('\n')

  return `Launch a new agent to handle complex, multi-step tasks autonomously.

The SpawnAgent tool launches specialized agents that run as async teammates. All spawned agents run in parallel immediately — use the **Wait** tool to pause until specific agents complete and collect their results.

Available agent types and the tools they have access to:
${agentLines}
- ${CUSTOM_AGENT_TYPE}: General-purpose agent with a built-in default system prompt and broad tool access except SpawnAgent and AskUserQuestion. Use this when none of the specialized agents above are a clean fit. (Tools: All tools except SpawnAgent, AskUserQuestion)

When using the SpawnAgent tool, you MUST specify an "agentName" parameter to select which agent type to use. Use "${CUSTOM_AGENT_TYPE}" for general-purpose tasks.

When NOT to use the SpawnAgent tool:
- If you want to read a specific file path, use the Read or Glob tool instead.
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead.
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead.
- For tasks that are not related to any of the agent descriptions above and cannot be expressed as a focused prompt, do the work yourself.

Usage notes:
- Launch multiple agents concurrently whenever possible — send a single assistant message containing multiple SpawnAgent tool_use blocks. All spawned agents run in parallel.
- Each agent invocation is stateless: it does not see the current conversation history — write self-contained prompts.
- Clearly tell the agent whether you expect it to write code or just do research.
- After spawning agents, call **Wait** to block until they complete and get their results. If you need results before continuing, always use Wait.
- If you don't need results immediately, skip Wait and continue working — results will be available later via TaskList.
`
}

// ── Core executor ──

const CUSTOM_DEFINITION: AgentDefinition = {
  name: CUSTOM_AGENT_TYPE,
  description: 'General-purpose agent with broad tool access',
  systemPrompt: '', // filled at spawn time
  tools: ['*'],
  disallowedTools: ['SpawnAgent', 'AskUserQuestion'],
  maxTurns: DEFAULT_AGENT_MAX_TURNS
}

async function executeSpawn(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  const team = useTeamStore.getState().activeTeam
  if (!team) {
    return encodeToolError('No active team. Call TeamCreate first.')
  }

  const requestedTeamName = input.team_name ? String(input.team_name) : null
  if (requestedTeamName && requestedTeamName !== team.name) {
    return encodeToolError(
      `Active team is "${team.name}", but received team_name="${requestedTeamName}".`
    )
  }

  const agentName = input.agentName ? String(input.agentName) : null
  const isCustom = !agentName || agentName === CUSTOM_AGENT_TYPE

  let agentDefinition: AgentDefinition
  if (isCustom) {
    // The worker system prompt is built by the runner (buildWorkerSystemPrompt)
    // so every worker shares one prompt source of truth.
    agentDefinition = CUSTOM_DEFINITION
  } else {
    const def = agentRegistry.get(agentName)
    if (!def) return encodeToolError(`Unknown agentName "${agentName}".`)
    agentDefinition = def
  }

  const memberName = String(input.name || `agent-${nanoid(4)}`)

  const teamName = team.name
  const teamCtx = getTeamContext(teamName)
  teamCtx.workingFolder = ctx.workingFolder
  teamCtx.sshConnectionId = ctx.sshConnectionId
  const limiter = teamCtx.limiter
  const willQueue = limiter.activeCount >= 2

  const assignedTaskId = input.task_id ? String(input.task_id) : null
  if (assignedTaskId) {
    const task = team.tasks.find((t) => t.id === assignedTaskId)
    if (task?.status === 'completed') {
      return encodeToolError(
        `Task "${assignedTaskId ?? undefined}" is already completed and cannot be re-assigned.`
      )
    }
  }

  const member: TeamMember = {
    id: nanoid(),
    name: memberName,
    model: String(input.model ?? 'default'),
    role: 'worker',
    agentName: agentDefinition.name,
    status: willQueue ? 'waiting' : 'idle',
    currentTaskId: assignedTaskId,
    iteration: 0,
    toolCalls: [],
    streamingText: '',
    toolCursors: {},
    startedAt: Date.now(),
    completedAt: null
  }

  teamEvents.emit({ type: 'team_member_add', taskId: team.taskId, member })

  if (assignedTaskId) {
    teamEvents.emit({
      type: 'team_task_update',
      chatTaskId: team.taskId,
      taskId: assignedTaskId,
      patch: { status: 'in_progress', owner: memberName }
    })
  }

  limiter
    .acquire()
    .then(() => {
      teamEvents.emit({
        type: 'team_member_update',
        taskId: team.taskId,
        memberId: member.id,
        patch: { status: 'working' }
      })

      return runTeammate({
        memberId: member.id,
        memberName,
        prompt: String(input.prompt ?? ''),
        taskId: assignedTaskId ?? undefined,
        model: input.model ? String(input.model) : null,
        agentName: agentDefinition.name,
        workingFolder: ctx.workingFolder,
        sshConnectionId: ctx.sshConnectionId
      }).finally(() => {
        limiter.release()
        scheduleNextTask(teamName)
      })
    })
    .catch((err) => {
      log.error(`Failed to start agent "${memberName}":`, err)
    })

  return encodeStructuredToolResult({
    success: true,
    member_id: member.id,
    name: memberName,
    agent_name: agentDefinition.name,
    team_name: teamName,
    message: `Agent "${memberName}" (${agentDefinition.name}) spawned. All spawned agents run in parallel. Use the Wait tool to block until this agent completes and collect its results.`,
    instruction:
      'Spawn more agents now if needed (all will run in parallel), then call Wait to collect results. If you do not need results immediately, continue working and check results later via TaskList.'
  })
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

// ── SpawnAgent render ──

function spawnAgentHeader(ctx: ToolPanelContext): React.ReactNode {
  const isLive = isToolLive(ctx.status)
  const parsed = parseTeamOutput(ctx.outputText)
  const memberName = parsed.kind === 'object' ? readString(parsed.data, 'name') : ''
  const agentName = parsed.kind === 'object' ? readString(parsed.data, 'agent_name') : ''
  const inputName = firstStringInput(ctx.input, ['name'])
  const inputDesc = firstStringInput(ctx.input, ['description'])
  const titleName = memberName || inputName || inputDesc
  const badgeAgent = agentName || firstStringInput(ctx.input, ['agentName']) || 'custom'
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={titleName ? ctx.t('toolPanel.title.SpawnAgent', { name: titleName }) : ctx.displayName}
      subtitle={inputDesc || undefined}
      badges={
        isLive ? null : (
          <Badge tone="green">{ctx.t('teamPanel.spawned')}</Badge>
        )
      }
      titleAttr={`${titleName}\n${badgeAgent}`}
    />
  )
}

function spawnAgentBody(ctx: ToolPanelContext): React.ReactNode {
  const parsed = parseTeamOutput(ctx.outputText)
  if (parsed.kind === 'error') return errorPre(parsed.error, ctx)
  const data = parsed.kind === 'object' ? parsed.data : {}
  const isLive = isToolLive(ctx.status)

  const memberName = readString(data, 'name') || firstStringInput(ctx.input, ['name'])
  const agentName =
    readString(data, 'agent_name') || firstStringInput(ctx.input, ['agentName']) || 'custom'
  const memberId = readString(data, 'member_id')
  const teamName = readString(data, 'team_name')
  const model = firstStringInput(ctx.input, ['model'])
  const taskId = firstStringInput(ctx.input, ['task_id'])
  const description = firstStringInput(ctx.input, ['description'])
  const instruction = readString(data, 'instruction')

  return (
    <div className="space-y-1.5">
      {description ? (
        <FieldRow label={ctx.t('teamPanel.description')} value={description} />
      ) : null}
      {memberName ? (
        <FieldRow label={ctx.t('teamPanel.memberName')} value={memberName} mono />
      ) : null}
      {agentName ? (
        <FieldRow label={ctx.t('teamPanel.agentType')} value={agentName} mono />
      ) : null}
      {taskId ? <FieldRow label={ctx.t('teamPanel.taskId')} value={taskId} mono /> : null}
      {model ? <FieldRow label={ctx.t('teamPanel.model')} value={model} mono /> : null}
      {teamName ? <FieldRow label={ctx.t('teamPanel.teamName')} value={teamName} mono /> : null}
      {memberId ? (
        <FieldRow label={ctx.t('teamPanel.memberId')} value={memberId} mono />
      ) : null}
      {instruction ? (
        <p className="mt-1 rounded-md bg-muted/20 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {instruction}
        </p>
      ) : null}
      {isLive && parsed.kind === 'empty' && !description ? (
        <span className="text-[11px] text-muted-foreground">{ctx.t('teamPanel.spawning')}</span>
      ) : null}
    </div>
  )
}

// ── Tool registration ──

export const SPAWN_AGENT_TOOL_NAME = 'SpawnAgent'

export function createSpawnAgentTool(): ToolHandler {
  const agents = agentRegistry.getAll()
  const agentNameEnum = [...agents.map((a) => a.name), CUSTOM_AGENT_TYPE]

  return {
    definition: {
      name: SPAWN_AGENT_TOOL_NAME,
      description: buildTaskDescription(agents),
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A short (3-5 word) description of the task'
          },
          prompt: {
            type: 'string',
            description:
              'The task for the agent to perform. Write a self-contained brief — the agent does not see the current conversation history.'
          },
          agentName: {
            type: 'string',
            enum: agentNameEnum,
            description: `The type of agent to use. Use "${CUSTOM_AGENT_TYPE}" for general-purpose tasks.`
          },
          name: {
            type: 'string',
            description: 'Display name for the spawned agent. Auto-generated if not provided.'
          },
          team_name: {
            type: 'string',
            description: 'Optional team name. Uses current active team if omitted.'
          },
          model: {
            type: 'string',
            description: 'Optional model override.'
          },
          task_id: {
            type: 'string',
            description: 'Optional task ID to assign immediately.'
          }
        },
        required: ['description', 'prompt']
      }
    },
    execute: async (input, ctx) => {
      return executeSpawn(input, ctx)
    },
    render: {
      kind: 'native-panel',
      renderHeader: spawnAgentHeader,
      renderBody: spawnAgentBody
    },
    formatApprovalSummary: (input) => `[${input.agentName ?? '?'}] ${input.description ?? ''}`,
  }
}
