// Promise-based tool approval gate.
// Tool execution pauses on `requestApproval()` and resumes when the UI calls
// `resolveApproval()` with the user's decision.

interface PendingApproval {
  resolve: (approved: boolean) => void
}

const pendingApprovals = new Map<string, PendingApproval>()

export function requestApproval(toolCallId: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    pendingApprovals.set(toolCallId, { resolve })

    const abortHandler = (): void => {
      const pending = pendingApprovals.get(toolCallId)
      if (pending) {
        pendingApprovals.delete(toolCallId)
        reject(new Error('Approval request aborted'))
      }
    }

    if (signal?.aborted) {
      pendingApprovals.delete(toolCallId)
      reject(new Error('Approval request aborted'))
      return
    }

    signal?.addEventListener('abort', abortHandler, { once: true })

    const originalResolve = resolve
    const wrappedResolve = (approved: boolean): void => {
      signal?.removeEventListener('abort', abortHandler)
      originalResolve(approved)
    }
    pendingApprovals.set(toolCallId, { resolve: wrappedResolve })
  })
}

export function resolveApproval(toolCallId: string, approved: boolean): void {
  const pending = pendingApprovals.get(toolCallId)
  if (!pending) return
  pendingApprovals.delete(toolCallId)
  pending.resolve(approved)
}

export function cancelAllApprovals(): void {
  for (const [id, pending] of pendingApprovals) {
    pending.resolve(false)
    pendingApprovals.delete(id)
  }
}

export function hasPendingApproval(toolCallId: string): boolean {
  return pendingApprovals.has(toolCallId)
}
