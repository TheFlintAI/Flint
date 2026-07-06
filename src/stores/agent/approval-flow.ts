import type { AgentStoreInternals } from './types'
import { normalizeToolCall, trimToolCallArray } from './tool-call-cache'
import { sendApprovalResponse } from '@/lib/agent/teams/inbox-poller'
import { sendPlanApprovalResponse } from '@/lib/agent/teams/plan-approval-client'
import { isAgentRuntimeSyncSuppressed, emitAgentRuntimeSync } from '@/lib/agent/runtime-sync'
import { createLogger } from '@/lib/logger'

const log = createLogger('AgentStore:ApprovalFlow')

// Approval resolvers live outside the store — they hold non-serializable
// callbacks and don't need to trigger React re-renders.
export const approvalResolvers = new Map<string, (approved: boolean) => void>()
export const approvalMetadata = new Map<
  string,
  { requestId: string; replyTo: string; source: 'teammate' | 'teammate-plan' }
>()

export function createRequestApproval(
  _set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (toolCallId: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        if (approvalResolvers.delete(toolCallId)) {
          resolve(false)
        }
      }, 300_000)
      const wrappedResolve = (approved: boolean) => {
        clearTimeout(timeout)
        resolve(approved)
      }
      approvalResolvers.set(toolCallId, wrappedResolve)
    })
  }
}

export function createRegisterApprovalSource(
  _set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (
    toolCallId: string,
    meta: { requestId: string; replyTo: string; source?: 'teammate' | 'teammate-plan' }
  ) => {
    approvalMetadata.set(toolCallId, {
      requestId: meta.requestId,
      replyTo: meta.replyTo,
      source: meta.source ?? 'teammate'
    })
  }
}

export function createResolveApproval(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (toolCallId: string, approved: boolean) => {
    const resolve = approvalResolvers.get(toolCallId)
    if (resolve) {
      resolve(approved)
      approvalResolvers.delete(toolCallId)
    }

    const meta = approvalMetadata.get(toolCallId)
    if (meta?.source === 'teammate') {
      void sendApprovalResponse({
        requestId: meta.requestId,
        approved,
        to: meta.replyTo,
        summary: approved ? 'Leader approved tool use' : 'Leader denied tool use'
      }).catch((error) => {
        log.error('Failed to send approval response:', error)
      })
      approvalMetadata.delete(toolCallId)
    } else if (meta?.source === 'teammate-plan') {
      void sendPlanApprovalResponse({
        requestId: meta.requestId,
        approved,
        to: meta.replyTo,
        feedback: approved ? 'Leader approved plan' : 'Leader rejected plan'
      }).catch((error) => {
        log.error('Failed to send plan approval response:', error)
      })
      approvalMetadata.delete(toolCallId)
    }

    // Move tool call from pending to executed so the dialog advances
    // to the next pending item. Without this, teammate tool calls
    // stay in pendingToolCalls and block subsequent approvals.
    set((state) => {
      const idx = state.pendingToolCalls.findIndex((t) => t.id === toolCallId)
      if (idx !== -1) {
        const [moved] = state.pendingToolCalls.splice(idx, 1)
        moved.status = approved ? 'running' : 'error'
        if (!approved) moved.error = 'User denied permission'
        state.executedToolCalls.push(normalizeToolCall(moved))
        trimToolCallArray(state.executedToolCalls)
      }
    })
    if (!isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({ kind: 'resolve_approval', toolCallId, approved })
    }
  }
}

export function createClearPendingApprovals(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return () => {
    // Resolve all pending approval promises as denied
    for (const [, resolve] of approvalResolvers) {
      resolve(false)
    }
    approvalResolvers.clear()
    approvalMetadata.clear()
    // Move all pending tool calls to executed
    set((state) => {
      for (const tc of state.pendingToolCalls) {
        tc.status = 'error'
        tc.error = 'Aborted (team deleted)'
        state.executedToolCalls.push(normalizeToolCall(tc))
      }
      state.pendingToolCalls = []
      trimToolCallArray(state.executedToolCalls)
    })
    if (!isAgentRuntimeSyncSuppressed()) {
      emitAgentRuntimeSync({ kind: 'clear_pending_approvals' })
    }
  }
}

export function createAddApprovedTool(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (name: string) => {
    set((state) => {
      if (!state.approvedToolNames.includes(name)) {
        state.approvedToolNames.push(name)
      }
    })
  }
}
