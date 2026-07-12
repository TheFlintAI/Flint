import type {
  ContentBlock,
  ToolResultContent
} from '../../api/types'
import { toolRegistry } from '../tool-registry'
import type { AgentEvent, AgentLoopConfig, ToolCallState } from '../types'
import type { ToolContext } from '../../tools/tool-types'
import { summarizeToolInputForHistory } from '../../tools/tool-input-sanitizer'
import { createLogger } from '@/lib/logger'
import { decodeStructuredToolResult, encodeToolError } from '../../tools/tool-result-format'
import { ConcurrencyLimiter } from '../concurrency-limiter'
import { compactBashToolResultContent } from '../../tools/bash-output'
import { classifyBashCommand } from '../../tools/bash-tool'
import { interceptFsCommands } from '../../tools/fs-interceptor'
import { agentEvents } from '../events/event-bus'
import { requestApproval } from '../tool-approval-resolver'

// Wraps the tool context's command client so filesystem mutations within this
// tool call are journaled onto the run's change set.
function withJournaling(toolCtx: ToolContext, tc: ToolCallState): ToolContext {
  if (!toolCtx.runId) return { ...toolCtx, currentToolUseId: tc.id }
  return {
    ...toolCtx,
    currentToolUseId: tc.id,
    commands: interceptFsCommands(toolCtx.commands, {
      runId: toolCtx.runId,
      taskId: toolCtx.taskId,
      toolUseId: tc.id,
      toolName: tc.name
    })
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  toolCtx: ToolContext
): Promise<ToolResultContent> {
  return toolRegistry.execute(name, input, toolCtx)
}

export function buildToolCallResult(params: {
  tc: ToolCallState
  index: number
  output: ToolResultContent
  toolError?: string
  startedAt: number
  completedAt: number
}): {
  resultEvent: ToolCallState
  resultBlock: ContentBlock
} {
  const { tc, index: _index, toolError, startedAt, completedAt } = params
  const output =
    tc.name === 'Bash' ? compactBashToolResultContent(params.output) : params.output
  const sanitizedInput = summarizeToolInputForHistory(tc.name, tc.input)
  const resultError = toolError ?? extractStructuredToolError(output)
  const resultEvent: ToolCallState = {
    ...tc,
    input: sanitizedInput,
    status: resultError ? 'error' : 'completed',
    output,
    ...(resultError ? { error: resultError } : {}),
    startedAt,
    completedAt
  }

  const resultBlock: ContentBlock = {
    type: 'tool_result',
    toolUseId: tc.id,
    content: output,
    ...(resultError ? { isError: true } : {})
  }
  return { resultEvent, resultBlock }
}

function isAwaitingUserReviewToolResult(output: ToolResultContent): boolean {
  if (typeof output !== 'string') return false
  const parsed = decodeStructuredToolResult(output)
  return (
    !!parsed &&
    !Array.isArray(parsed) &&
    parsed.awaiting_user_review === true &&
    parsed.status === 'awaiting_review'
  )
}

function extractStructuredToolError(output: ToolResultContent): string | undefined {
  if (typeof output !== 'string') return undefined
  const parsed = decodeStructuredToolResult(output)
  if (!parsed || Array.isArray(parsed)) return undefined

  const hasErrorOnlyShape = Object.keys(parsed).length === 1
  if (typeof parsed.error === 'string' && (parsed.success === false || hasErrorOnlyShape)) {
    return parsed.error
  }

  return undefined
}

export async function* executeToolCalls(
  toolCalls: ToolCallState[],
  config: AgentLoopConfig,
  toolCtx: ToolContext,
  buildLoopEndEvent: (reason: 'completed' | 'max_iterations' | 'aborted' | 'error') => AgentEvent
): AsyncGenerator<AgentEvent, { shouldStopForUserReview: boolean; toolResults: Array<ContentBlock | undefined> }> {
  const toolResults: Array<ContentBlock | undefined> = new Array(toolCalls.length)
  let shouldStopForUserReview = false
  const runnableToolCalls: Array<{ tc: ToolCallState; index: number }> = []
  const startedAtByToolId = new Map<string, number>()

  for (const [index, tc] of toolCalls.entries()) {
    if (config.signal.aborted) {
      yield buildLoopEndEvent('aborted')
      return { shouldStopForUserReview: true, toolResults }
    }

    // Resolve permission: Bash uses classifier, other tools auto-allow
    const permission = tc.name === 'Bash' ? classifyBashCommand(tc.input, toolCtx) : 'allow'

    if (permission === 'deny') {
      const deniedAt = Date.now()
      const deniedResult = buildToolCallResult({
        tc,
        index,
        output: 'Command denied by security policy',
        toolError: 'Command denied by security policy',
        startedAt: deniedAt,
        completedAt: deniedAt
      })
      toolResults[index] = deniedResult.resultBlock
      yield {
        type: 'tool_call_result',
        toolCall: deniedResult.resultEvent
      }
      continue
    }

    if (permission === 'ask') {
      // Emit start with awaiting_approval status
      const startedAt = Date.now()
      startedAtByToolId.set(tc.id, startedAt)
      yield {
        type: 'tool_call_start',
        toolCall: {
          ...tc,
          input: summarizeToolInputForHistory(tc.name, tc.input),
          status: 'awaiting_approval',
          startedAt
        }
      }
      // Emit approval-needed event (UI uses this to show the approval card)
      yield {
        type: 'tool_call_approval_needed',
        toolCall: {
          ...tc,
          input: summarizeToolInputForHistory(tc.name, tc.input),
          status: 'awaiting_approval',
          startedAt
        }
      }

      // Block until user decides
      let approved: boolean
      try {
        approved = await requestApproval(tc.id, config.signal)
      } catch {
        // AbortSignal fired
        yield buildLoopEndEvent('aborted')
        return { shouldStopForUserReview: true, toolResults }
      }

      if (!approved) {
        const deniedAt = Date.now()
        const deniedResult = buildToolCallResult({
          tc,
          index,
          output: 'User denied the command',
          toolError: 'User denied the command',
          startedAt,
          completedAt: deniedAt
        })
        toolResults[index] = deniedResult.resultBlock
        yield {
          type: 'tool_call_result',
          toolCall: deniedResult.resultEvent
        }
        continue
      }
      // Approved: transition to running
      logTool.debug('tool call approved by user', { name: tc.name, id: tc.id })
      yield {
        type: 'tool_call_start',
        toolCall: {
          ...tc,
          input: summarizeToolInputForHistory(tc.name, tc.input),
          status: 'running',
          startedAt
        }
      }
      runnableToolCalls.push({ tc, index })
      continue
    }

    // permission === 'allow'
    const startedAt = Date.now()
    startedAtByToolId.set(tc.id, startedAt)
    logTool.debug('tool call started', { name: tc.name, id: tc.id })
    yield {
      type: 'tool_call_start',
      toolCall: {
        ...tc,
        input: summarizeToolInputForHistory(tc.name, tc.input),
        status: 'running',
        startedAt
      }
    }
    runnableToolCalls.push({ tc, index })
  }

  const enableParallelToolExecution =
    (config.enableParallelToolExecution ?? true) && runnableToolCalls.length > 1
  const maxParallelTools = Math.max(
    1,
    Math.floor(config.maxParallelTools ?? DEFAULT_MAX_PARALLEL_TOOLS)
  )

  if (enableParallelToolExecution) {
    yield* executeToolsInParallel(
      runnableToolCalls,
      maxParallelTools,
      config,
      toolCtx,
      startedAtByToolId,
      toolResults,
      buildLoopEndEvent
    )
    shouldStopForUserReview = toolResults.some(
      (block) => block && isAwaitingUserReviewToolResult((block as Extract<ContentBlock, { type: 'tool_result' }>).content)
    )
  } else {
    for (const { tc, index } of runnableToolCalls) {
      let output: ToolResultContent
      let toolError: string | undefined
      try {
        output = await executeTool(tc.name, tc.input, {
          ...withJournaling(toolCtx, tc),
          readFileHistory: toolCtx.readFileHistory
        })
      } catch (toolErr) {
        if (config.signal.aborted) {
          yield buildLoopEndEvent('aborted')
          return { shouldStopForUserReview: true, toolResults }
        }
        const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr)
        toolError = errMsg
        output = encodeToolError(errMsg)
      }

      const completedAt = Date.now()
      if (config.signal.aborted) {
        yield buildLoopEndEvent('aborted')
        return { shouldStopForUserReview: true, toolResults }
      }

      const completedResult = buildToolCallResult({
        tc,
        index,
        output,
        toolError,
        startedAt: startedAtByToolId.get(tc.id) ?? completedAt,
        completedAt
      })
      toolResults[index] = completedResult.resultBlock
      shouldStopForUserReview ||= isAwaitingUserReviewToolResult(output)
      yield {
        type: 'tool_call_result',
        toolCall: completedResult.resultEvent
      }
      agentEvents.dispatch({
        type: 'tool:complete',
        taskId: toolCtx.taskId ?? '',
        toolName: tc.name,
        toolCallId: tc.id,
        duration: completedAt - (startedAtByToolId.get(tc.id) ?? completedAt),
        isError: !!toolError,
        timestamp: completedAt
      })
    }
  }

  return { shouldStopForUserReview, toolResults }
}

const DEFAULT_MAX_PARALLEL_TOOLS = 8
const logTool = createLogger('AgentLoop')

async function* executeToolsInParallel(
  runnableToolCalls: Array<{ tc: ToolCallState; index: number }>,
  maxParallelTools: number,
  config: AgentLoopConfig,
  toolCtx: ToolContext,
  startedAtByToolId: Map<string, number>,
  toolResults: Array<ContentBlock | undefined>,
  buildLoopEndEvent: (reason: 'completed' | 'max_iterations' | 'aborted' | 'error') => AgentEvent
): AsyncGenerator<AgentEvent> {
  const limiter = new ConcurrencyLimiter(maxParallelTools)
  const completedExecutions: Array<{
    tc: ToolCallState
    index: number
    output: ToolResultContent
    toolError?: string
    startedAt: number
    completedAt: number
  }> = []
  let wakeExecutions: (() => void) | null = null
  const wake = (): void => {
    if (!wakeExecutions) return
    const notify = wakeExecutions
    wakeExecutions = null
    notify()
  }

  const executionTasks = runnableToolCalls.map(({ tc, index }) =>
    (async () => {
      let output: ToolResultContent
      let toolError: string | undefined
      try {
        await limiter.run(async () => {
          output = await executeTool(tc.name, tc.input, {
            ...withJournaling(toolCtx, tc),
            readFileHistory: toolCtx.readFileHistory
          })
        }, config.signal)
      } catch (toolErr) {
        const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr)
        toolError = errMsg
        output = encodeToolError(errMsg)
      }
      completedExecutions.push({
        tc,
        index,
        output: output!,
        toolError,
        startedAt: startedAtByToolId.get(tc.id) ?? Date.now(),
        completedAt: Date.now()
      })
      wake()
    })()
  )

  let completedCount = 0
  while (completedCount < executionTasks.length) {
    if (completedExecutions.length === 0) {
      await new Promise<void>((resolve) => {
        wakeExecutions = resolve
        if (completedExecutions.length > 0) {
          wake()
        }
      })
      continue
    }

    while (completedExecutions.length > 0) {
      const execution = completedExecutions.shift()
      if (!execution) break
      completedCount += 1
      if (config.signal.aborted) {
        yield buildLoopEndEvent('aborted')
        return
      }
      const completedResult = buildToolCallResult(execution)
      toolResults[execution.index] = completedResult.resultBlock
      yield {
        type: 'tool_call_result',
        toolCall: completedResult.resultEvent
      }
      agentEvents.dispatch({
        type: 'tool:complete',
        taskId: toolCtx.taskId ?? '',
        toolName: execution.tc.name,
        toolCallId: execution.tc.id,
        duration: execution.completedAt - execution.startedAt,
        isError: !!execution.toolError,
        timestamp: execution.completedAt
      })
    }
  }

  await Promise.all(executionTasks)
}
