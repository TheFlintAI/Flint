import type { AgentStoreInternals } from './types'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { createLogger } from '@/lib/logger'

const log = createLogger('AgentStore:BackgroundProcess')

export interface BackgroundProcessState {
  id: string
  command: string
  cwd?: string
  taskId?: string
  toolUseId?: string
  description?: string
  source?: string
  terminalId?: string
  status: 'running' | 'exited' | 'stopped' | 'error'
  output: string
  port?: number
  exitCode?: number | null
  createdAt: number
  updatedAt: number
}

interface ProcessListItem {
  id: string
  command: string
  cwd?: string
  port?: number
  createdAt?: number
  running?: boolean
  exitCode?: number | null
  metadata?: {
    source?: string
    taskId?: string
    toolUseId?: string
    description?: string
    terminalId?: string
  }
}

interface ProcessOutputEvent {
  id: string
  data?: string
  port?: number
  exited?: boolean
  exitCode?: number | null
  metadata?: {
    source?: string
    taskId?: string
    toolUseId?: string
    description?: string
    terminalId?: string
  }
}

interface BufferedProcessOutputEvent {
  id: string
  data: string
  port?: number
  exited?: boolean
  exitCode?: number | null
  metadata?: {
    source?: string
    taskId?: string
    toolUseId?: string
    description?: string
    terminalId?: string
  }
}

const MAX_BACKGROUND_PROCESS_OUTPUT_CHARS = 12_000
const MAX_BACKGROUND_PROCESS_ENTRIES = 60
const BACKGROUND_PROCESS_OUTPUT_FLUSH_MS = 80

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n... [truncated, ${value.length} chars total]`
}

function appendBackgroundOutput(existing: string, chunk: string): string {
  const next = `${existing}${chunk}`
  if (next.length <= MAX_BACKGROUND_PROCESS_OUTPUT_CHARS) return next
  return truncateText(next, MAX_BACKGROUND_PROCESS_OUTPUT_CHARS)
}

function trimBackgroundProcessMap(map: Record<string, BackgroundProcessState>): void {
  const entries = Object.entries(map).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  if (entries.length <= MAX_BACKGROUND_PROCESS_ENTRIES) return
  const removeCount = entries.length - MAX_BACKGROUND_PROCESS_ENTRIES
  for (let i = 0; i < removeCount; i++) {
    delete map[entries[i][0]]
  }
}

export function buildBackgroundProcessSummary(process: BackgroundProcessState): BackgroundProcessState {
  return {
    ...process,
    output: ''
  }
}

function applyProcessOutputEvent(
  existing: BackgroundProcessState | undefined,
  payload: BufferedProcessOutputEvent,
  now: number
): BackgroundProcessState {
  const next: BackgroundProcessState = existing
    ? { ...existing }
    : {
        id: payload.id,
        command: '',
        cwd: undefined,
        taskId: payload.metadata?.taskId,
        toolUseId: payload.metadata?.toolUseId,
        description: payload.metadata?.description,
        source: payload.metadata?.source,
        terminalId: payload.metadata?.terminalId,
        status: payload.exited ? 'exited' : 'running',
        output: '',
        port: payload.port,
        exitCode: payload.exitCode,
        createdAt: now,
        updatedAt: now
      }

  if (payload.data) {
    next.output = appendBackgroundOutput(next.output, payload.data)
  }
  if (payload.port) next.port = payload.port
  if (payload.metadata) {
    next.taskId = payload.metadata.taskId ?? next.taskId
    next.toolUseId = payload.metadata.toolUseId ?? next.toolUseId
    next.description = payload.metadata.description ?? next.description
    next.source = payload.metadata.source ?? next.source
    next.terminalId = payload.metadata.terminalId ?? next.terminalId
  }
  if (payload.exited) {
    next.status = next.status === 'stopped' ? 'stopped' : 'exited'
    next.exitCode = payload.exitCode
  }
  next.updatedAt = now

  return next
}

let processTrackingInitialized = false

export function initBackgroundProcessTracking(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
): () => Promise<void> {
  return async () => {
    if (processTrackingInitialized) return
    processTrackingInitialized = true

    try {
      const list = (await tauriCommands.invoke(
        TAURI_COMMANDS.PROCESS_LIST
      )) as ProcessListItem[]
      set((state) => {
        for (const item of list) {
          const existing = state.backgroundProcesses[item.id]
          const nextProcess = {
            id: item.id,
            command: item.command ?? existing?.command ?? '',
            cwd: item.cwd ?? existing?.cwd,
            taskId: item.metadata?.taskId ?? existing?.taskId,
            toolUseId: item.metadata?.toolUseId ?? existing?.toolUseId,
            description: item.metadata?.description ?? existing?.description,
            source: item.metadata?.source ?? existing?.source,
            terminalId: item.metadata?.terminalId ?? existing?.terminalId,
            status: item.running === false ? 'exited' : 'running',
            output: existing?.output ?? '',
            port: item.port ?? existing?.port,
            exitCode: item.exitCode ?? existing?.exitCode,
            createdAt: item.createdAt ?? existing?.createdAt ?? Date.now(),
            updatedAt: Date.now()
          } satisfies BackgroundProcessState
          state.backgroundProcesses[item.id] = nextProcess
          if (nextProcess.taskId) {
            const previous =
              state.taskBackgroundProcessSummaries[nextProcess.taskId] ?? []
            state.taskBackgroundProcessSummaries[nextProcess.taskId] = [
              buildBackgroundProcessSummary(nextProcess),
              ...previous.filter((process) => process.id !== nextProcess.id)
            ].slice(0, MAX_BACKGROUND_PROCESS_ENTRIES)
          }
        }
        trimBackgroundProcessMap(state.backgroundProcesses)
      })
    } catch (err) {
      log.error('Failed to load process list:', err)
    }

    const bufferedProcessOutputs = new Map<string, BufferedProcessOutputEvent>()
    let bufferedProcessOutputTimer: ReturnType<typeof setTimeout> | null = null

    const flushBufferedProcessOutputs = (): void => {
      if (bufferedProcessOutputTimer) {
        clearTimeout(bufferedProcessOutputTimer)
        bufferedProcessOutputTimer = null
      }
      if (bufferedProcessOutputs.size === 0) return

      const pending = Array.from(bufferedProcessOutputs.values())
      bufferedProcessOutputs.clear()
      set((state) => {
        const now = Date.now()
        for (const payload of pending) {
          const nextProcess = applyProcessOutputEvent(
            state.backgroundProcesses[payload.id],
            payload,
            now
          )
          state.backgroundProcesses[payload.id] = nextProcess
          if (nextProcess.taskId) {
            const previous =
              state.taskBackgroundProcessSummaries[nextProcess.taskId] ?? []
            state.taskBackgroundProcessSummaries[nextProcess.taskId] = [
              buildBackgroundProcessSummary(nextProcess),
              ...previous.filter((process) => process.id !== nextProcess.id)
            ].slice(0, MAX_BACKGROUND_PROCESS_ENTRIES)
          }
        }
        trimBackgroundProcessMap(state.backgroundProcesses)
      })
    }

    const scheduleBufferedProcessOutputFlush = (): void => {
      if (bufferedProcessOutputTimer) return
      bufferedProcessOutputTimer = setTimeout(() => {
        flushBufferedProcessOutputs()
      }, BACKGROUND_PROCESS_OUTPUT_FLUSH_MS)
    }

    tauriCommands.on(TAURI_COMMANDS.PROCESS_OUTPUT, (...args: unknown[]) => {
      const payload = args[0] as ProcessOutputEvent | undefined
      if (!payload?.id) return

      const existing = bufferedProcessOutputs.get(payload.id)
      bufferedProcessOutputs.set(payload.id, {
        id: payload.id,
        data: `${existing?.data ?? ''}${payload.data ?? ''}`,
        port: payload.port ?? existing?.port,
        exited: payload.exited ?? existing?.exited,
        exitCode: payload.exitCode ?? existing?.exitCode,
        metadata: payload.metadata
          ? { ...(existing?.metadata ?? {}), ...payload.metadata }
          : existing?.metadata
      })

      if (payload.exited) {
        flushBufferedProcessOutputs()
        return
      }

      scheduleBufferedProcessOutputFlush()
    })
  }
}

export function createRegisterBackgroundProcess(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (process: {
    id: string
    command: string
    cwd?: string
    taskId?: string
    toolUseId?: string
    description?: string
    source?: string
    terminalId?: string
  }) => {
    set((state) => {
      const now = Date.now()
      const nextProcess = {
        id: process.id,
        command: process.command,
        cwd: process.cwd,
        taskId: process.taskId,
        toolUseId: process.toolUseId,
        description: process.description,
        source: process.source,
        terminalId: process.terminalId,
        status: 'running',
        output: state.backgroundProcesses[process.id]?.output ?? '',
        port: state.backgroundProcesses[process.id]?.port,
        exitCode: undefined,
        createdAt: state.backgroundProcesses[process.id]?.createdAt ?? now,
        updatedAt: now
      } satisfies BackgroundProcessState
      state.backgroundProcesses[process.id] = nextProcess
      if (nextProcess.taskId) {
        const previous = state.taskBackgroundProcessSummaries[nextProcess.taskId] ?? []
        state.taskBackgroundProcessSummaries[nextProcess.taskId] = [
          buildBackgroundProcessSummary(nextProcess),
          ...previous.filter((item) => item.id !== nextProcess.id)
        ].slice(0, MAX_BACKGROUND_PROCESS_ENTRIES)
      }
      trimBackgroundProcessMap(state.backgroundProcesses)
    })
  }
}

export function createStopBackgroundProcess(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return async (id: string) => {
    set((state) => {
      const process = state.backgroundProcesses[id]
      if (!process) return
      process.updatedAt = Date.now()
      process.status = 'stopped'
      process.output = appendBackgroundOutput(process.output, '\n[Stopping process...]\n')
    })

    const result = (await tauriCommands.invoke(TAURI_COMMANDS.PROCESS_KILL, { id })) as {
      success?: boolean
      error?: string
    }

    set((state) => {
      const process = state.backgroundProcesses[id]
      if (!process) return
      process.updatedAt = Date.now()
      if (result?.success) {
        process.output = appendBackgroundOutput(process.output, '[Stopped by user]\n')
        return
      }
      if (result?.error && result.error.includes('Process not found')) {
        process.output = appendBackgroundOutput(process.output, '[Process already exited]\n')
        return
      }
      process.status = 'error'
      process.output = appendBackgroundOutput(
        process.output,
        `[Stop failed: ${result?.error ?? 'Unknown error'}]\n`
      )
    })
  }
}

export function createSendBackgroundProcessInput(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return async (id: string, input: string, appendNewline = true) => {
    const result = (await tauriCommands.invoke(TAURI_COMMANDS.PROCESS_WRITE, {
      id,
      input,
      appendNewline
    })) as { success?: boolean; error?: string }
    set((state) => {
      const process = state.backgroundProcesses[id]
      if (!process) return
      process.updatedAt = Date.now()
      if (result?.success) {
        const displayInput = input === '' ? '^C' : input
        process.output = appendBackgroundOutput(process.output, `\n$ ${displayInput}\n`)
        return
      }
      process.status = 'error'
      process.output = appendBackgroundOutput(
        process.output,
        `\n[Input failed: ${result?.error ?? 'Unknown error'}]\n`
      )
    })
  }
}

export function createRemoveBackgroundProcess(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (id: string) => {
    set((state) => {
      delete state.backgroundProcesses[id]
    })
  }
}

export function createRegisterForegroundShellExec(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (toolUseId: string, execId: string) => {
    set((state) => {
      state.foregroundShellExecByToolUseId[toolUseId] = execId
    })
  }
}

export function createClearForegroundShellExec(
  set: AgentStoreInternals['set'],
  _get: AgentStoreInternals['get']
) {
  return (toolUseId: string) => {
    set((state) => {
      delete state.foregroundShellExecByToolUseId[toolUseId]
    })
  }
}

export function createAbortForegroundShellExec(
  set: AgentStoreInternals['set'],
  get: AgentStoreInternals['get']
) {
  return async (toolUseId: string) => {
    const state = get()
    const execId = state.foregroundShellExecByToolUseId[toolUseId]
    if (!execId) return
    set((state) => {
      delete state.foregroundShellExecByToolUseId[toolUseId]
    })
  }
}
