import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from '@/stores/settings-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { createProvider } from '@/lib/api/provider'
import { estimateTokens } from '@/lib/utils/format-tokens'
import type {
  UnifiedMessage,
  ProviderConfig,
  TokenUsage,
  RequestDebugInfo,
  ToolDefinition,
} from '@/lib/api/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('ChatActions')

export function readPersistedContextLength(usage?: TokenUsage): number {
  return typeof usage?.contextLength === 'number' && usage.contextLength > 0
    ? usage.contextLength
    : 0
}

export function findPersistedContextLength(messages: UnifiedMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const contextLength = readPersistedContextLength(messages[i]?.usage)
    if (contextLength > 0) return contextLength
  }
  return 0
}

export function normalizeUsageForPersistence(usage: TokenUsage, contextLength?: number): TokenUsage {
  const normalizedContextLength =
    typeof contextLength === 'number' && contextLength > 0
      ? contextLength
      : readPersistedContextLength(usage)

  return {
    ...usage,
    contextTokens: usage.contextTokens ?? usage.inputTokens,
    ...(normalizedContextLength > 0 ? { contextLength: normalizedContextLength } : {})
  }
}

export function resolveDebugContextWindowPayload(debugInfo?: RequestDebugInfo | null): string | null {
  if (!debugInfo) return null
  if (debugInfo.transport === 'websocket' && debugInfo.websocketRequestKind === 'warmup') {
    return null
  }
  if (typeof debugInfo.contextWindowBody === 'string' && debugInfo.contextWindowBody.trim()) {
    return debugInfo.contextWindowBody
  }
  if (typeof debugInfo.body === 'string' && debugInfo.body.trim()) {
    return debugInfo.body
  }
  return null
}

export interface ContextEstimatePayloadInfo {
  serialized: string
  hadBase64Payload: boolean
}

const CONTEXT_ESTIMATE_BASE64_DATA_URL_PATTERN = /^data:([^;,]+);base64,/i
const CONTEXT_ESTIMATE_BASE64_VALUE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const CONTEXT_ESTIMATE_BASE64_MIN_LENGTH = 256
const CONTEXT_ESTIMATE_BASE64_PLACEHOLDER = '[base64 omitted]'
const CONTEXT_ESTIMATE_DATA_URL_PLACEHOLDER = '[image omitted]'
const CONTEXT_ESTIMATE_BINARY_KEYS = new Set(['data', 'result'])

export function isLikelyBase64Payload(value: string): boolean {
  const normalized = value.replace(/\s+/g, '')
  if (normalized.length < CONTEXT_ESTIMATE_BASE64_MIN_LENGTH) return false
  if (normalized.length % 4 !== 0) return false
  return CONTEXT_ESTIMATE_BASE64_VALUE_PATTERN.test(normalized)
}

export function sanitizeContextEstimateString(args: {
  value: string
  key?: string
  parentType?: string
}): { sanitized: string; hadBase64Payload: boolean } {
  const trimmed = args.value.trim()
  if (CONTEXT_ESTIMATE_BASE64_DATA_URL_PATTERN.test(trimmed)) {
    return {
      sanitized: CONTEXT_ESTIMATE_DATA_URL_PLACEHOLDER,
      hadBase64Payload: true
    }
  }

  const shouldSanitizeRawBase64 =
    (CONTEXT_ESTIMATE_BINARY_KEYS.has(args.key ?? '') ||
      (args.parentType === 'image_generation_call' && args.key === 'result')) &&
    isLikelyBase64Payload(trimmed)
  if (shouldSanitizeRawBase64) {
    return {
      sanitized: CONTEXT_ESTIMATE_BASE64_PLACEHOLDER,
      hadBase64Payload: true
    }
  }

  return {
    sanitized: args.value,
    hadBase64Payload: false
  }
}

export function sanitizeContextEstimateValue(
  value: unknown,
  key?: string,
  parentType?: string
): { sanitized: unknown; hadBase64Payload: boolean } {
  if (typeof value === 'string') {
    const sanitized = sanitizeContextEstimateString({ value, key, parentType })
    return {
      sanitized: sanitized.sanitized,
      hadBase64Payload: sanitized.hadBase64Payload
    }
  }

  if (Array.isArray(value)) {
    let hadBase64Payload = false
    const sanitized = value.map((entry) => {
      const next = sanitizeContextEstimateValue(entry, key, parentType)
      hadBase64Payload ||= next.hadBase64Payload
      return next.sanitized
    })
    return { sanitized, hadBase64Payload }
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const childParentType = typeof record.type === 'string' ? record.type : parentType
    let hadBase64Payload = false
    const sanitized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(record)) {
      const next = sanitizeContextEstimateValue(childValue, childKey, childParentType)
      sanitized[childKey] = next.sanitized
      hadBase64Payload ||= next.hadBase64Payload
    }
    return { sanitized, hadBase64Payload }
  }

  return { sanitized: value, hadBase64Payload: false }
}

export function serializeContextEstimatePayload(value: unknown): ContextEstimatePayloadInfo {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      const sanitized = sanitizeContextEstimateValue(parsed)
      return {
        serialized: JSON.stringify(sanitized.sanitized),
        hadBase64Payload: sanitized.hadBase64Payload
      }
    } catch {
      const sanitized = sanitizeContextEstimateString({ value })
      return {
        serialized: sanitized.sanitized,
        hadBase64Payload: sanitized.hadBase64Payload
      }
    }
  }

  try {
    const sanitized = sanitizeContextEstimateValue(value)
    return {
      serialized: JSON.stringify(sanitized.sanitized),
      hadBase64Payload: sanitized.hadBase64Payload
    }
  } catch {
    return {
      serialized: String(value ?? ''),
      hadBase64Payload: false
    }
  }
}

export function resolveDebugContextEstimatePayload(
  debugInfo?: RequestDebugInfo | null
): ContextEstimatePayloadInfo | null {
  const payload = resolveDebugContextWindowPayload(debugInfo)
  return payload ? serializeContextEstimatePayload(payload) : null
}

export interface ApiRequestResult {
  statusCode?: number
  body?: string
  error?: string
}

export function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

export function buildResponsesInputTokensUrl(baseUrl?: string): string | null {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '')
  return trimmed ? `${trimmed}/responses/input_tokens` : null
}

export function buildResponsesInputTokensRequestBody(debugInfo?: RequestDebugInfo | null): string | null {
  const payload = resolveDebugContextWindowPayload(debugInfo)
  if (!payload) return null

  const parsed = tryParseJsonRecord(payload)
  if (!parsed) return null

  if (parsed.type === 'response.create') {
    delete parsed.type
  }
  delete parsed.stream
  delete parsed.background

  return serializeContextEstimatePayload(parsed).serialized
}

export function buildResponsesInputTokensHeaders(
  debugInfo: RequestDebugInfo | undefined,
  providerConfig: ProviderConfig
): Record<string, string> | null {
  const apiKey = providerConfig.apiKey?.trim()
  if (!apiKey || !debugInfo) return null

  const headers: Record<string, string> = { ...debugInfo.headers }
  const hasHeader = (name: string): boolean =>
    Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())

  headers.Authorization = `Bearer ${apiKey}`
  if (!hasHeader('Content-Type')) {
    headers['Content-Type'] = 'application/json'
  }
  if (providerConfig.userAgent && !hasHeader('User-Agent')) {
    headers['User-Agent'] = providerConfig.userAgent
  }
  if (providerConfig.accountId && !hasHeader('Chatgpt-Account-Id')) {
    headers['Chatgpt-Account-Id'] = providerConfig.accountId
  }
  if (providerConfig.organization && !hasHeader('OpenAI-Organization')) {
    headers['OpenAI-Organization'] = providerConfig.organization
  }
  if (providerConfig.project && !hasHeader('OpenAI-Project')) {
    headers['OpenAI-Project'] = providerConfig.project
  }
  if (providerConfig.serviceTier && !hasHeader('service_tier')) {
    headers.service_tier = providerConfig.serviceTier
  }

  return headers
}

export function shouldRequestPreciseResponsesContextTokens(args: {
  debugInfo?: RequestDebugInfo | null
  providerConfig: ProviderConfig
}): boolean {
  return (
    args.providerConfig.type === 'openai-responses' &&
    args.debugInfo?.transport === 'websocket' &&
    args.debugInfo.websocketRequestKind !== 'warmup' &&
    !!buildResponsesInputTokensUrl(args.providerConfig.baseUrl) &&
    !!buildResponsesInputTokensRequestBody(args.debugInfo)
  )
}

export async function requestPreciseResponsesContextTokens(args: {
  debugInfo: RequestDebugInfo
  providerConfig: ProviderConfig
}): Promise<number> {
  const url = buildResponsesInputTokensUrl(args.providerConfig.baseUrl)
  const body = buildResponsesInputTokensRequestBody(args.debugInfo)
  const headers = buildResponsesInputTokensHeaders(args.debugInfo, args.providerConfig)
  if (!url || !body || !headers) return 0

  const result = (await tauriCommands.invoke('api:request', {
    url,
    method: 'POST',
    headers,
    body,
    allowInsecureTls: args.providerConfig.allowInsecureTls,
    providerId: args.providerConfig.providerId,
    providerBuiltinId: args.providerConfig.providerBuiltinId
  })) as ApiRequestResult

  if (result.error) {
    throw new Error(result.error)
  }
  if (!result.body) {
    return 0
  }
  if ((result.statusCode ?? 0) >= 400) {
    throw new Error(`HTTP ${result.statusCode}: ${result.body.slice(0, 500)}`)
  }

  const data = tryParseJsonRecord(result.body)
  if (!data) {
    return 0
  }

  const inputTokens = Number(data.input_tokens)
  return Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0
}

export function shouldUseEstimatedContextTokens(debugInfo?: RequestDebugInfo | null): boolean {
  return debugInfo?.transport === 'websocket' && !!resolveDebugContextWindowPayload(debugInfo)
}

export function estimateContextTokensForRequest(args: {
  messages: UnifiedMessage[]
  tools: ToolDefinition[]
  providerConfig: ProviderConfig
}): number {
  if (args.messages.length === 0) return 0

  try {
    const provider = createProvider(args.providerConfig)
    const payload = {
      systemPrompt: args.providerConfig.systemPrompt ?? '',
      messages: provider.formatMessages(args.messages),
      ...(args.tools.length > 0 ? { tools: provider.formatTools(args.tools) } : {})
    }
    return estimateTokens(serializeContextEstimatePayload(payload).serialized)
  } catch (error) {
    log.warn('Failed to estimate request context tokens', error)
    return 0
  }
}

export function estimateContextTokensFromDebugInfo(debugInfo?: RequestDebugInfo | null): {
  tokenCount: number
  hadBase64Payload: boolean
} {
  const payload = resolveDebugContextEstimatePayload(debugInfo)
  if (!payload) {
    return {
      tokenCount: 0,
      hadBase64Payload: false
    }
  }

  try {
    return {
      tokenCount: estimateTokens(payload.serialized),
      hadBase64Payload: payload.hadBase64Payload
    }
  } catch (error) {
    log.warn('Failed to estimate debug context tokens', error)
    return {
      tokenCount: 0,
      hadBase64Payload: payload.hadBase64Payload
    }
  }
}

export function normalizeUsageWithEstimatedContext(args: {
  usage: TokenUsage
  contextLength?: number
  debugInfo?: RequestDebugInfo | null
  estimatedContextTokens?: number
  preferEstimatedContextTokens?: boolean
}): TokenUsage {
  const normalized = normalizeUsageForPersistence(args.usage, args.contextLength)
  const estimatedContextTokens = args.estimatedContextTokens ?? 0
  if (shouldUseEstimatedContextTokens(args.debugInfo) && estimatedContextTokens > 0) {
    normalized.contextTokens = args.preferEstimatedContextTokens
      ? estimatedContextTokens
      : Math.max(normalized.contextTokens ?? normalized.inputTokens, estimatedContextTokens)
  }
  return normalized
}

export function buildStreamingContextUsage(
  contextTokens: number,
  contextLength?: number
): TokenUsage | null {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) {
    return null
  }

  return {
    inputTokens: 0,
    outputTokens: 0,
    contextTokens,
    ...(typeof contextLength === 'number' && contextLength > 0 ? { contextLength } : {})
  }
}

export function getConfiguredMaxParallelTools(): number {
  return DEFAULT_MAX_PARALLEL_TOOL_CALLS
}