import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import type { TauriCommandClient } from './tool-types'
import type { FileSnapshot } from '@/stores/agent/change-tracking'
import { deriveOp } from '@/stores/agent/change-tracking'
import { useAgentStore } from '@/stores/agent-store'
import { lineCount as lineCountOf } from '@/lib/chat/diff-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('FsInterceptor')

const INLINE_TEXT_MAX_BYTES = 1_000_000

const MUTATING_FS_CHANNELS = new Set<string>([
  TAURI_COMMANDS.FS_WRITE_FILE,
  TAURI_COMMANDS.FS_WRITE_FILE_BINARY,
  TAURI_COMMANDS.FS_DELETE,
  TAURI_COMMANDS.FS_MKDIR,
  TAURI_COMMANDS.FS_MOVE
])

export interface InterceptorContext {
  runId: string
  taskId?: string
  toolUseId?: string
  toolName?: string
}

interface CapturedSnapshot {
  snapshot: FileSnapshot
  fullText?: string
}

function isErrorResult(value: unknown): value is { error: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

async function captureFileSnapshot(
  base: TauriCommandClient,
  path: string
): Promise<CapturedSnapshot> {
  const statResult = await base.invoke<unknown>(TAURI_COMMANDS.FS_STAT_PATH, { path })
  if (isErrorResult(statResult)) {
    return { snapshot: { exists: false, hash: null, size: 0 } }
  }
  const statObj = statResult as Record<string, unknown> | undefined
  const stat = (statObj?.stat ?? statObj) as Record<string, unknown> | undefined
  if (!stat || stat.exists !== true) {
    return { snapshot: { exists: false, hash: null, size: 0 } }
  }

  const type = (stat.type as string | undefined) ?? null
  const size = typeof stat.size === 'number' ? stat.size : 0
  const mtimeMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : null

  if (type !== 'file' || size > INLINE_TEXT_MAX_BYTES) {
    return {
      snapshot: {
        exists: true,
        size,
        mtimeMs,
        hash: null,
        textOmitted: type === 'file'
      }
    }
  }

  const readResult = await base.invoke<unknown>(TAURI_COMMANDS.FS_READ_FILE, { path })
  if (isErrorResult(readResult)) {
    return {
      snapshot: {
        exists: true,
        size,
        mtimeMs,
        hash: null,
        textOmitted: true
      }
    }
  }
  const readObj = readResult as Record<string, unknown> | undefined
  const content = typeof readObj?.content === 'string' ? readObj.content : ''
  return {
    snapshot: {
      exists: true,
      size,
      mtimeMs,
      hash: null,
      text: content,
      lineCount: lineCountOf(content)
    },
    fullText: content
  }
}

function extractTargetPath(channel: string, args: unknown[]): string | null {
  const first = args[0]
  if (!first || typeof first !== 'object') return null
  const obj = first as Record<string, unknown>
  if (channel === TAURI_COMMANDS.FS_MOVE) {
    return typeof obj.to === 'string' ? obj.to : null
  }
  return typeof obj.path === 'string' ? obj.path : null
}

/**
 * Wraps a TauriCommandClient intercepting FS-mutating commands to capture
 * before/after snapshots and record changes via the change tracking store.
 */
export function interceptFsCommands(
  base: TauriCommandClient,
  ctx: InterceptorContext
): TauriCommandClient {
  const record = async (path: string, before: CapturedSnapshot, after: CapturedSnapshot): Promise<void> => {
    const op = deriveOp(before.snapshot, after.snapshot)
    if (!op) return
    await useAgentStore.getState().recordFileChange({
      runId: ctx.runId,
      taskId: ctx.taskId,
      toolUseId: ctx.toolUseId,
      toolName: ctx.toolName,
      filePath: path,
      op,
      before: before.snapshot,
      after: after.snapshot,
      fullTextBefore: before.fullText,
      fullTextAfter: after.fullText
    }).catch((err) => {
      log.error('Failed to record file change:', err, {
        filePath: path,
        op,
        runId: ctx.runId,
        taskId: ctx.taskId
      })
    })
  }

  return {
    invoke: async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
      if (!MUTATING_FS_CHANNELS.has(channel)) {
        return base.invoke<T>(channel, ...args)
      }
      const path = extractTargetPath(channel, args)
      if (!path) {
        return base.invoke<T>(channel, ...args)
      }
      const before = await captureFileSnapshot(base, path)
      const result = await base.invoke<T>(channel, ...args)
      const after = await captureFileSnapshot(base, path)
      record(path, before, after).catch(() => {})
      return result
    },
    send: (channel: string, ...args: unknown[]): void => base.send(channel, ...args),
    on: base.on.bind(base) as TauriCommandClient['on'],
    removeListener: base.removeListener?.bind(base) as TauriCommandClient['removeListener'],
    removeAllListeners: base.removeAllListeners?.bind(base) as TauriCommandClient['removeAllListeners'],
    once: base.once?.bind(base) as TauriCommandClient['once']
  }
}
