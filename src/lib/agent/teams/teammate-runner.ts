import { nanoid } from 'nanoid'
import { toolRegistry } from '../tool-registry'
import { teamEvents } from './events'
import { useTeamStore } from '@/stores/team-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'
import { useAgentStore } from '@/stores/agent-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { buildWorkerSystemPrompt, resolveEnvironmentContext } from '../system-prompt'
import { MessageQueue } from '../types'
import type { AgentLoopConfig } from '../types'
import type { UnifiedMessage, ProviderConfig, TokenUsage } from '@/lib/api/types'
import type { MemoryIndexSnapshot } from '@/protocols/memory-types'
import type { TeamRuntimeMessageRecord } from '@/protocols/team-runtime-types'
import type { TeamTask, TeamMemberStatus } from './types'
import { buildRuntimeCompression } from '../context-compression-runtime'
import { LEAD_ONLY_TOOLS, MANDATORY_AGENT_DISALLOWED_TOOLS } from './agent-tools'
import { requestFallbackReport, runSharedAgentRuntime } from '../shared-runtime'
import { appendTeamRuntimeMessage } from '@/services/tauri-api/team-runtime'
import { requestTeammatePermission, stopWorkerPermissionPoller } from './permission-client'
import { requestPlanApproval, stopWorkerPlanApprovalPoller } from './plan-approval-client'
import { startWorkerInboxPoller, stopWorkerInboxPoller } from './worker-inbox'
import { DEFAULT_AGENT_MAX_TURNS, resolveAgentMaxTurns, resolveAgentTemperature } from './agent-limits'
import { resolveProjectMemoryTextFileForTarget } from '../project-memory'
import { loadMemoryIndex } from '../memory-files'
import { COMPLETE_WORK_TOOL_NAME } from './tools/complete-work'
import { refreshSkillTools } from '@/lib/tools/skill-tool'
import { createLogger } from '@/lib/logger'

const log = createLogger('Teammate')

const teammateAbortControllers = new Map<string, AbortController>()
const teammateShutdownRequested = new Set<string>()
const DEFAULT_TEAMMATE_MAX_ITERATIONS = DEFAULT_AGENT_MAX_TURNS
const MAX_REPORT_LENGTH = 4000
const WORKER_KICKOFF_MESSAGE =
  'Begin your assigned task now. Your instructions and assigned task are in your system prompt. Call CompleteWork with a structured report when finished.'

function getTaskDetails(description: string | null | undefined, subject: string): string | null {
  const trimmed = typeof description === 'string' ? description.trim() : ''
  if (!trimmed || trimmed === subject.trim()) return null
  return trimmed
}

function buildTeamTaskPrompt(task: Pick<TeamTask, 'subject' | 'description'>): string {
  const lines = ['Work on the following task:', `**Title:** ${task.subject}`]
  const details = getTaskDetails(task.description, task.subject)
  if (details) {
    lines.push(`**Details:** ${details}`)
  }
  return lines.join('\n')
}

export function requestTeammateShutdown(memberId: string): void {
  teammateShutdownRequested.add(memberId)
}

export function abortTeammate(memberId: string): boolean {
  const ac = teammateAbortControllers.get(memberId)
  if (ac) {
    ac.abort()
    teammateAbortControllers.delete(memberId)
    teammateShutdownRequested.delete(memberId)
    return true
  }
  return false
}

export function abortAllTeammates(): void {
  for (const [id, ac] of teammateAbortControllers) {
    ac.abort()
    teammateAbortControllers.delete(id)
  }
  teammateShutdownRequested.clear()
}

export function isTeammateRunning(memberId: string): boolean {
  return teammateAbortControllers.has(memberId)
}

// Map a run's end reason to the member status shown in the card: success →
// completed (green), error → failed (red), abort/shutdown → stopped (gray).
function endReasonToStatus(
  reason: 'completed' | 'aborted' | 'error' | 'shutdown'
): TeamMemberStatus {
  if (reason === 'completed') return 'completed'
  if (reason === 'error') return 'failed'
  return 'stopped'
}

interface RunTeammateOptions {
  memberId: string
  memberName: string
  prompt: string
  taskId: string | undefined
  model: string | null
  workingFolder?: string
  sshConnectionId?: string
}

interface SingleTaskResult {
  iterations: number
  toolCalls: number
  lastStreamingText: string
  fullOutput: string
  reason: 'completed' | 'max_iterations' | 'aborted' | 'shutdown' | 'error'
  usage: TokenUsage
}

export async function runTeammate(options: RunTeammateOptions): Promise<void> {
  const { memberId, memberName, model, workingFolder, sshConnectionId } = options
  let { prompt } = options
  const chatTaskId: string | undefined = options.taskId

  const team = useTeamStore.getState().activeTeam
  let taskId = team?.taskId
  const abortController = new AbortController()
  teammateAbortControllers.set(memberId, abortController)

  log.debug('teammate starting', { memberName, taskId, model, workingFolder })

  await refreshSkillTools()

  const disallowedSet = new Set(MANDATORY_AGENT_DISALLOWED_TOOLS)
  const baseToolDefs = toolRegistry.getDefinitions().filter(
    (tool) => !LEAD_ONLY_TOOLS.has(tool.name) && !disallowedSet.has(tool.name)
  )
  const toolDefs = baseToolDefs

  const messageQueue = new MessageQueue()

  const unsubMessages = teamEvents.on((event) => {
    if (event.type !== 'team_message') return
    const msg = event.message
    const isForMe = msg.to === memberName || msg.to === 'all'
    if (!isForMe || msg.from === memberName) return

    if (msg.type === 'shutdown_request') {
      teammateShutdownRequested.add(memberId)
      return
    }

    if (msg.type !== 'permission_response' && msg.type !== 'plan_approval_response') {
      messageQueue.push({
        id: nanoid(),
        role: 'user',
        content: `[Team message from ${msg.from}]: ${msg.content}`,
        createdAt: msg.timestamp
      })
    }
  })

  startWorkerInboxPoller({
    memberId,
    memberName,
    onMessage: (content, createdAt) => {
      messageQueue.push({
        id: nanoid(),
        role: 'user',
        content,
        createdAt
      })
    }
  })

  let lastStreamingText = ''
  let fullOutput = ''
  let endReason: 'completed' | 'aborted' | 'error' | 'shutdown' = 'completed'

  try {
    if (!taskId) {
      const initialTask = findNextClaimableTask()
      if (initialTask) {
        taskId = initialTask.id
        prompt = buildTeamTaskPrompt(initialTask)
        teamEvents.emit({
          type: 'team_task_update',
          chatTaskId,
          taskId: initialTask.id,
          patch: { status: 'in_progress', owner: memberName }
        })
        teamEvents.emit({
          type: 'team_member_update',
          taskId,
          memberId,
          patch: { currentTaskId: initialTask.id }
        })
      }
    }

    const result = await runSingleTaskLoop({
      memberId,
      memberName,
      prompt,
      taskId,
      chatTaskId,
      model,
      workingFolder,
      sshConnectionId,
      abortController,
      toolDefs,
      messageQueue
    })

    lastStreamingText = result.lastStreamingText
    fullOutput = result.fullOutput
    if (result.reason === 'aborted') endReason = 'aborted'
    else if (result.reason === 'shutdown') endReason = 'shutdown'
    else if (result.reason === 'error') endReason = 'error'

    const completedAt = Date.now()
    log.debug('teammate task finished', { memberName, reason: result.reason, iterations: result.iterations, toolCalls: result.toolCalls })
    teamEvents.emit({
      type: 'team_member_update',
      taskId,
      memberId,
      patch: { status: endReasonToStatus(endReason), completedAt }
    })
  } catch (error) {
    endReason = abortController.signal.aborted ? 'aborted' : 'error'
    if (!abortController.signal.aborted) {
      log.error(`${memberName} error:`, error)
    }
    const completedAt = Date.now()
    teamEvents.emit({
      type: 'team_member_update',
      taskId,
      memberId,
      patch: { status: endReasonToStatus(endReason), completedAt }
    })
  } finally {
    teammateAbortControllers.delete(memberId)
    teammateShutdownRequested.delete(memberId)
    unsubMessages()
    stopWorkerPermissionPoller(memberName)
    stopWorkerPlanApprovalPoller(memberName)
    stopWorkerInboxPoller(memberId)

    if (endReason !== 'aborted') {
      emitCompletionMessage(memberName, endReason, {
        lastStreamingText,
        fullOutput,
        taskId
      })
    }
  }
}

async function runSingleTaskLoop(opts: {
  memberId: string
  memberName: string
  prompt: string
  taskId: string | undefined
  chatTaskId?: string
  model: string | null
  workingFolder?: string
  sshConnectionId?: string
  abortController: AbortController
  toolDefs: ReturnType<typeof toolRegistry.getDefinitions>
  messageQueue?: MessageQueue
}): Promise<SingleTaskResult> {
  const {
    memberId,
    memberName,
    prompt,
    taskId,
    chatTaskId,
    model,
    workingFolder,
    sshConnectionId,
    abortController,
    toolDefs,
    messageQueue
  } = opts

  const settings = useSettingsStore.getState()
  const providerState = useProviderStore.getState()

  // Resolve model tier: 'aux' uses auxiliary model, otherwise uses main model
  const activeConfig = model === 'aux'
    ? providerState.getAuxProviderConfig()
    : providerState.getActiveProviderConfig()
  const effectiveModel =
    model && model !== 'default' && model !== 'aux' && model !== 'main'
      ? model
      : (activeConfig?.model ?? settings.model)
  const effectiveMaxTokens = useProviderStore
    .getState()
    .getActiveModelMaxOutputTokens(effectiveModel)
  const agentTemperature = resolveAgentTemperature(undefined)
  const providerConfig: ProviderConfig = activeConfig
    ? {
        ...activeConfig,
        model: effectiveModel,
        maxTokens: effectiveMaxTokens,
        temperature: agentTemperature
      }
    : {
        type: settings.provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || undefined,
        model: effectiveModel,
        maxTokens: effectiveMaxTokens,
        temperature: agentTemperature
      }

  if (toolDefs.length === 0) {
    throw new Error('No tools available for teammate.')
  }

  const team = useTeamStore.getState().activeTeam
  const teamTaskId = team?.taskId
  const taskInfo = teamTaskId && team ? team.tasks.find((task) => task.id === teamTaskId) : null

  const environmentContext = resolveEnvironmentContext({ workingFolder, sshConnectionId })

  // Propagate project rules (AGENTS.md) + memory index to the stateless worker
  // so it operates under the same governing context as the main agent.
  let workerRules = ''
  if (workingFolder) {
    try {
      const agentsFile = await resolveProjectMemoryTextFileForTarget(
        tauriCommands,
        workingFolder,
        'AGENTS.md'
      )
      if (agentsFile.content) workerRules = agentsFile.content
    } catch (error) {
      log.error('Failed to load AGENTS.md for worker:', error)
    }
  }
  let memorySnapshot: MemoryIndexSnapshot | null = null
  try {
    memorySnapshot = await loadMemoryIndex(tauriCommands)
  } catch (error) {
    log.error('Failed to load memory index for worker:', error)
  }

  const workerTask = taskInfo
    ? { id: taskInfo.id, subject: taskInfo.subject, description: taskInfo.description }
    : null
  const systemPrompt = await buildWorkerSystemPrompt({
    workingFolder,
    language: settings.language,
    environmentContext,
    userRules: workerRules || undefined,
    memorySnapshot,
    toolDefs,
    workerTask,
    workerInstructions: prompt,
    teamName: team?.name,
    memberName,
    permissionMode: team?.permissionMode
  })
  providerConfig.systemPrompt = systemPrompt

  let capturedFinal: UnifiedMessage[] = []
  const compression = buildRuntimeCompression(providerConfig, abortController.signal)
  const loopConfig: AgentLoopConfig = {
    maxIterations: resolveAgentMaxTurns(DEFAULT_TEAMMATE_MAX_ITERATIONS),
    provider: providerConfig,
    tools: toolDefs,
    systemPrompt,
    workingFolder,
    signal: abortController.signal,
    messageQueue,
    captureFinalMessages: (msgs) => {
      capturedFinal = msgs
    },
    ...(compression ? { contextCompression: compression } : {})
  }

  const initialMessages: UnifiedMessage[] = []

  if (team?.permissionMode === 'plan') {
    const planPrompt = buildPlanRequestText(taskInfo ?? null, effectivePrompt)
    const planRuntime = await runSharedAgentRuntime({
      initialMessages: [
        {
          id: nanoid(),
          role: 'user',
          content: planPrompt,
          createdAt: Date.now()
        }
      ],
      loopConfig: {
        ...loopConfig,
        maxIterations: 1
      },
      toolContext: {
        workingFolder,
        sshConnectionId,
        signal: abortController.signal,
        commands: tauriCommands,
        callerAgent: 'teammate'
      },
    })

    const planText = planRuntime.finalOutput.trim()
    const approval = await requestPlanApproval({
      memberName,
      plan: planText,
      taskId
    })

    if (!approval.approved) {
      const rejectedOutput = approval.feedback
        ? `${planText}\n\nLead feedback: ${approval.feedback}`
        : planText
      return {
        iterations: planRuntime.iterations,
        toolCalls: planRuntime.toolCallCount,
        lastStreamingText: rejectedOutput,
        fullOutput: rejectedOutput,
        reason: 'shutdown',
        usage: planRuntime.usage
      }
    }

    initialMessages.push({
      id: nanoid(),
      role: 'user',
      content: `Lead approved your plan. Proceed with execution. ${approval.feedback ?? ''}`.trim(),
      createdAt: Date.now()
    })
  } else {
    initialMessages.push({
      id: nanoid(),
      role: 'user',
      content: WORKER_KICKOFF_MESSAGE,
      createdAt: Date.now()
    })
  }

  teamEvents.emit({
    type: 'team_member_update',
    taskId,
    memberId,
    patch: { status: 'working', iteration: 0, streamingText: '' }
  })

  let streamingText = ''
  // Per-tool cursor into streamingText (its length when the tool started), so
  // the renderer can interleave tool calls into the text/stage/think timeline
  // in true arrival order instead of stacking all text above all tools.
  const toolCursors: Record<string, number> = {}
  const streamThrottleMs = 50 // 20 updates/sec for fluid real-time streaming
  let streamDirty = false
  let streamTimer: ReturnType<typeof setTimeout> | null = null

  const flushStreamingText = (): void => {
    if (streamTimer) {
      clearTimeout(streamTimer)
      streamTimer = null
    }
    if (!streamDirty) return
    streamDirty = false
    teamEvents.emit({
      type: 'team_member_update',
      taskId,
      memberId,
      patch: { streamingText }
    })
  }

  const workerSharedState: NonNullable<ToolContext['sharedState']> = {}

  const runtime = await runSharedAgentRuntime({
    initialMessages,
    loopConfig,
    toolContext: {
      taskId,
      runId: taskId,
      workingFolder,
      sshConnectionId,
      signal: abortController.signal,
      commands: tauriCommands,
      callerAgent: 'teammate',
      sharedState: workerSharedState
    },
    onApprovalNeeded: async (toolCall) => {
      const autoApprove = useSettingsStore.getState().autoApprove
      if (autoApprove) return true
      const approved = useAgentStore.getState().approvedToolNames
      if (approved.includes(toolCall.name)) return true
      const result = await requestTeammatePermission({
        memberName,
        toolCall: {
          ...toolCall,
          status: 'pending_approval',
          permission: 'ask'
        }
      })
      if (result) useAgentStore.getState().addApprovedTool(toolCall.name)
      return result
    },
    hooks: {
      beforeHandleEvent: ({ event }) => {
        if (event.type !== 'iteration_start') return
        if (teammateShutdownRequested.has(memberId)) {
          return { stop: true, reason: 'shutdown' }
        }
        return undefined
      },
      afterHandleEvent: async ({ event, state }) => {
        switch (event.type) {
          case 'iteration_start':
            flushStreamingText()
            teamEvents.emit({
              type: 'team_member_update',
              taskId,
              memberId,
              patch: { iteration: state.iteration, status: 'working' }
            })
            break

          case 'text_delta':
            streamingText += event.text
            streamDirty = true
            if (!streamTimer) {
              streamTimer = setTimeout(flushStreamingText, streamThrottleMs)
            }
            break

          case 'tool_call_start':
            flushStreamingText()
            // Record where in the text stream this tool call occurred so the
            // card can place it between the text units that preceded/followed.
            toolCursors[event.toolCall.id] = streamingText.length
            teamEvents.emit({
              type: 'team_member_update',
              taskId,
              memberId,
              patch: { toolCalls: [...state.toolCalls], toolCursors: { ...toolCursors } }
            })
            break

          case 'tool_call_result':
            flushStreamingText()
            teamEvents.emit({
              type: 'team_member_update',
              taskId,
              memberId,
              patch: { toolCalls: [...state.toolCalls] }
            })
            // CompleteWork is the hard completion signal — terminate immediately.
            if (event.toolCall.name === COMPLETE_WORK_TOOL_NAME) {
              return { stop: true, reason: 'completed' }
            }
            break

          case 'message_end':
            flushStreamingText()
            teamEvents.emit({
              type: 'team_member_update',
              taskId,
              memberId,
              patch: { usage: { ...state.usage }, streamingText }
            })
            break

          case 'loop_end':
            flushStreamingText()
            if ((event.reason === 'completed' || event.reason === 'max_iterations') && taskId) {
              teamEvents.emit({
                type: 'team_task_update',
                chatTaskId,
                taskId,
                patch: { status: 'completed' }
              })
            }
            break
        }
      }
    }
  })

  if (streamTimer) {
    clearTimeout(streamTimer)
    streamTimer = null
  }
  flushStreamingText()

  const submittedReport = workerSharedState.completeWork ?? null

  // CompleteWork terminated the loop before loop_end fired — mark completion here.
  if (submittedReport && taskId) {
    teamEvents.emit({
      type: 'team_task_update',
      chatTaskId,
      taskId,
      patch: { status: 'completed' }
    })
  }

  let resolvedOutput = submittedReport ?? runtime.finalOutput
  if (
    !submittedReport &&
    !resolvedOutput.trim() &&
    capturedFinal.length > 0 &&
    !abortController.signal.aborted
  ) {
    const fallback = await requestFallbackReport({
      capturedMessages: capturedFinal,
      loopConfig,
      toolContext: {
        workingFolder,
        sshConnectionId,
        signal: abortController.signal,
        commands: tauriCommands,
        callerAgent: 'teammate'
      }
    })
    if (fallback) {
      resolvedOutput = fallback
    }
  }

  if (taskId && resolvedOutput) {
    const currentTask = useTeamStore.getState().activeTeam?.tasks.find((task) => task.id === taskId)
    if (!currentTask?.report?.trim()) {
      teamEvents.emit({
        type: 'team_task_update',
        chatTaskId,
        taskId,
        patch: { report: resolvedOutput }
      })
    }
  }

  return {
    iterations: runtime.iterations,
    toolCalls: runtime.toolCallCount,
    lastStreamingText: streamingText,
    fullOutput: resolvedOutput,
    reason: runtime.reason,
    usage: runtime.usage
  }
}

export function findNextClaimableTask(): TeamTask | null {
  const team = useTeamStore.getState().activeTeam
  if (!team) return null

  const completedTaskIds = new Set(
    team.tasks.filter((task) => task.status === 'completed').map((task) => task.id)
  )

  for (const task of team.tasks) {
    if (task.status !== 'pending') continue
    if (task.owner) continue
    const allDepsCompleted = task.dependsOn.every((depId) => completedTaskIds.has(depId))
    if (!allDepsCompleted) continue
    return task
  }

  return null
}

function emitCompletionMessage(
  memberName: string,
  endReason: string,
  stats: {
    lastStreamingText: string
    fullOutput: string
    taskId: string | undefined
  }
): void {
  const team = useTeamStore.getState().activeTeam
  if (!team) return

  const header = `**${memberName}** finished (${endReason}).`

  const task = stats.taskId ? team.tasks.find((item) => item.id === stats.taskId) : null
  const reportText = task?.report || stats.fullOutput || stats.lastStreamingText
  let report = ''
  if (reportText) {
    if (reportText.length <= MAX_REPORT_LENGTH) {
      report = `\n\n## Report\n\n${reportText}`
    } else {
      report = `\n\n## Report\n\n${reportText.slice(-MAX_REPORT_LENGTH)}\n\n*(report truncated, showing last ${MAX_REPORT_LENGTH} chars of ${reportText.length} total)*`
    }
  }

  const content = header + report
  const message: TeamRuntimeMessageRecord = {
    id: nanoid(8),
    from: memberName,
    to: 'lead',
    type: 'message',
    content,
    summary: `${memberName} finished (${endReason})`,
    timestamp: Date.now()
  }

  void appendTeamRuntimeMessage({
    teamName: team.name,
    message
  }).catch((error) => {
    log.error('Failed to append completion message:', error)
  })

  teamEvents.emit({ type: 'team_message', taskId: team.taskId, message })
}

function buildPlanRequestText(task: TeamTask | null, prompt: string): string {
  const title = task?.subject ?? 'Assigned Task'
  const details = task ? getTaskDetails(task.description, title) : null
  return [
    'Create a short execution plan for the task below.',
    `Task Title: ${title}`,
    details || prompt ? `Task Details: ${details ?? prompt}` : null,
    '',
    'Requirements:',
    '- Keep it concise and implementation-focused.',
    '- Mention key files or subsystems you expect to touch.',
    '- Mention verification approach.',
    '- End with a single sentence stating you are waiting for lead approval.'
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}
