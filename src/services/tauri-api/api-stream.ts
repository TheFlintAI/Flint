import { nanoid } from 'nanoid'
import { invoke as invokeTauriCommand } from '@tauri-apps/api/core'
import type { SSEEvent } from '@/lib/api/sse-parser'
import { tauriCommands } from './command-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('ApiStream')

export interface RequestDebugInfo {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  contextWindowBody?: string
  timestamp: number
  transport?: 'http' | 'websocket'
  fallbackReason?: string
  reusedConnection?: boolean
}

export class ApiStreamError extends Error {
  debugInfo: RequestDebugInfo
  statusCode?: number
  errorType?: string
  constructor(
    message: string,
    debugInfo: RequestDebugInfo,
    options?: { statusCode?: number; type?: string }
  ) {
    super(message)
    this.name = 'ApiStreamError'
    this.debugInfo = debugInfo
    this.statusCode = options?.statusCode
    this.errorType = options?.type
  }
}

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {}
  const sensitiveKeys = ['authorization', 'x-api-key', 'api-key', 'x-goog-api-key']
  for (const [k, v] of Object.entries(headers)) {
    if (sensitiveKeys.includes(k.toLowerCase()) && v.length > 8) {
      masked[k] = v.slice(0, 4) + '****' + v.slice(-4)
    } else {
      masked[k] = v
    }
  }
  return masked
}

type QueueItem =
  | { type: 'chunk'; data: string }
  | { type: 'end' }
  | { type: 'error'; error: string; statusCode?: number; errorType?: string }

type StreamQueueSink = {
  push: (item: QueueItem) => void
}

type ApiStreamDispatcherState = {
  initialized: boolean
  requests: Map<string, StreamQueueSink>
}

const API_STREAM_DISPATCHER_KEY = '__flintApiStreamDispatcher__'

function getApiStreamDispatcherState(): ApiStreamDispatcherState {
  const scope = globalThis as typeof globalThis & {
    [API_STREAM_DISPATCHER_KEY]?: ApiStreamDispatcherState
  }

  if (!scope[API_STREAM_DISPATCHER_KEY]) {
    scope[API_STREAM_DISPATCHER_KEY] = {
      initialized: false,
      requests: new Map<string, StreamQueueSink>()
    }
  }

  return scope[API_STREAM_DISPATCHER_KEY]
}

function completeRequest(
  state: ApiStreamDispatcherState,
  requestId: string,
  item: QueueItem
): void {
  const request = state.requests.get(requestId)
  if (!request) return
  request.push(item)
  if (item.type === 'end' || item.type === 'error') {
    state.requests.delete(requestId)
  }
}

function ensureApiStreamDispatcher(): void {
  const state = getApiStreamDispatcherState()
  if (state.initialized) return

  tauriCommands.on('api:stream-chunk', (data: { requestId?: string; data?: string }) => {
    if (typeof data?.requestId !== 'string' || typeof data.data !== 'string') return
    completeRequest(state, data.requestId, { type: 'chunk', data: data.data })
  })

  tauriCommands.on('api:stream-end', (data: { requestId?: string }) => {
    if (typeof data?.requestId !== 'string') return
    completeRequest(state, data.requestId, { type: 'end' })
  })

  tauriCommands.on(
    'api:stream-error',
    (data: { requestId?: string; error?: string; type?: string; statusCode?: number }) => {
      if (typeof data?.requestId !== 'string') return
      completeRequest(state, data.requestId, {
        type: 'error',
        error: typeof data.error === 'string' ? data.error : 'Unknown stream error',
        ...(typeof data.statusCode === 'number' ? { statusCode: data.statusCode } : {}),
        ...(typeof data.type === 'string' ? { errorType: data.type } : {})
      })
    }
  )

  state.initialized = true
}

function registerApiStreamRequest(requestId: string, push: (item: QueueItem) => void): () => void {
  const state = getApiStreamDispatcherState()
  state.requests.set(requestId, { push })
  return () => {
    state.requests.delete(requestId)
  }
}

/**
 * Streams an API request through the native command proxy.
 * Returns an AsyncIterable of SSE events, matching the same interface
 * as the direct fetch-based SSE parser.
 */
export async function* streamApiRequestViaTauri(params: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  allowInsecureTls?: boolean
  providerId?: string
  providerBuiltinId?: string
  accountId?: string
  providerType?: string
  model?: string
  taskId?: string
  responsesTaskScope?: string
  websocketUrl?: string
  websocketMode?: 'auto' | 'disabled'
  httpFallbackBody?: string
}): AsyncIterable<SSEEvent> {
  const requestId = nanoid()
  const {
    url,
    method,
    headers,
    body,
    signal,
    allowInsecureTls,
    providerId,
    providerBuiltinId,
    accountId,
    providerType,
    model,
    taskId,
    responsesTaskScope,
    websocketUrl,
    websocketMode,
    httpFallbackBody
  } = params

  const queue: QueueItem[] = []
  let resolve: (() => void) | null = null
  let done = false

  const push = (item: QueueItem): void => {
    queue.push(item)
    if (resolve) {
      resolve()
      resolve = null
    }
  }

  const waitForItem = (timeoutMs = 30_000): Promise<void> =>
    new Promise<void>((r) => {
      if (queue.length > 0) {
        r()
        return
      }
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        resolve = null
        r()
      }
      const timer = setTimeout(settle, timeoutMs)
      resolve = () => {
        clearTimeout(timer)
        settle()
      }
    })

  ensureApiStreamDispatcher()
  const unregisterRequest = registerApiStreamRequest(requestId, push)

  const abortHandler = (): void => {
    tauriCommands.send('api:abort', { requestId })
    push({ type: 'end' })
  }
  signal?.addEventListener('abort', abortHandler, { once: true })

  let firstChunkReceived = false

  const streamRequestParams = {
    requestId,
    url,
    method,
    headers,
    body,
    allowInsecureTls,
    providerId,
    providerBuiltinId,
    accountId,
    providerType,
    model,
    taskId,
    responsesTaskScope,
    websocketUrl,
    websocketMode,
    httpFallbackBody
  }

  invokeTauriCommand('emit_app_command', {
    channel: 'api:stream-request',
    args: [streamRequestParams]
  }).catch((err: unknown) => {
    log.error('Failed to send api:stream-request', err)
    push({
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
  })

  let buffer = ''
  const errorDebugBody = httpFallbackBody ?? body
  const FIRST_RESPONSE_TIMEOUT_MS = 60_000
  const requestStartedAt = Date.now()

  try {
    while (!done) {
      await waitForItem(firstChunkReceived ? 30_000 : FIRST_RESPONSE_TIMEOUT_MS)

      if (!firstChunkReceived && queue.length === 0 && Date.now() - requestStartedAt >= FIRST_RESPONSE_TIMEOUT_MS) {
        log.error('First response timeout', { requestId, url, elapsed: Date.now() - requestStartedAt })
        throw new ApiStreamError(
          `No response received from ${url} within ${FIRST_RESPONSE_TIMEOUT_MS / 1000}s`,
          {
            url,
            method,
            headers: maskHeaders(headers),
            body: errorDebugBody,
            timestamp: Date.now()
          }
        )
      }

      while (queue.length > 0) {
        const item = queue.shift()!

        if (item.type === 'end') {
          done = true
          if (!firstChunkReceived) {
            log.warn('Stream ended without any data', { requestId, url })
          }
          if (buffer.trim()) {
            const lines = buffer.split(/\r?\n/)
            const parsed: SSEEvent = { data: '' }
            const dataLines: string[] = []
            for (const line of lines) {
              if (line.startsWith('event:')) {
                parsed.event = line.slice(line.charAt(6) === ' ' ? 7 : 6)
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(line.charAt(5) === ' ' ? 6 : 5))
              }
            }
            parsed.data = dataLines.join('\n')
            if (parsed.data) yield parsed
            buffer = ''
          }
          break
        }

        if (item.type === 'error') {
          done = true
          throw new ApiStreamError(
            item.error,
            {
              url,
              method,
              headers: maskHeaders(headers),
              body: errorDebugBody,
              timestamp: Date.now()
            },
            {
              ...(typeof item.statusCode === 'number' ? { statusCode: item.statusCode } : {}),
              ...(item.errorType ? { type: item.errorType } : {})
            }
          )
        }

        if (!firstChunkReceived) {
          firstChunkReceived = true
        }
        buffer += item.data
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() || ''

        for (const eventStr of events) {
          const lines = eventStr.split(/\r?\n/)
          const parsed: SSEEvent = { data: '' }
          const dataLines: string[] = []
          for (const line of lines) {
            if (line.startsWith('event:')) parsed.event = line.slice(line.charAt(6) === ' ' ? 7 : 6)
            else if (line.startsWith('data:')) {
              dataLines.push(line.slice(line.charAt(5) === ' ' ? 6 : 5))
            }
          }
          parsed.data = dataLines.join('\n')
          if (parsed.data) yield parsed
        }
      }
    }
  } finally {
    unregisterRequest()
    signal?.removeEventListener('abort', abortHandler)
  }
}
