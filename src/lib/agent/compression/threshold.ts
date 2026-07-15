import type { AIModelConfig } from '../../api/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  enabled: boolean
  contextLength: number
  threshold: number
  preCompressThreshold?: number
  reservedOutputBudget?: number
}

export interface CompressionResult {
  compressed: boolean
  originalCount: number
  newCount: number
  messagesCompressed?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_COMPRESSION_LIMIT = 200_000
export const DEFAULT_COMPRESSION_THRESHOLD = 0.8
export const MIN_COMPRESSION_THRESHOLD = 0.3
export const MAX_COMPRESSION_THRESHOLD = 0.9
export const DEFAULT_COMPRESSION_RESERVED_OUTPUT = 20_000
export const COMPRESSION_AUTO_BUFFER = 13_000
export const PRECOMPRESSION_BUFFER = 20_000
export const PRECOMPRESSION_GAP = 8_000

const DEFAULT_PRECOMPRESS_THRESHOLD = 0.65

// ---------------------------------------------------------------------------
// Threshold helpers
// ---------------------------------------------------------------------------

export function clampCompressionThreshold(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_COMPRESSION_THRESHOLD
  }
  return Math.min(
    MAX_COMPRESSION_THRESHOLD,
    Math.max(MIN_COMPRESSION_THRESHOLD, value)
  )
}

export function resolveCompressionThreshold(
  _modelConfig?: Pick<AIModelConfig, 'contextLength'> | null
): number {
  return DEFAULT_COMPRESSION_THRESHOLD
}

export function resolveCompressionContextLength(
  modelConfig?: Pick<AIModelConfig, 'contextLength'> | null
): number {
  return typeof modelConfig?.contextLength === 'number' && modelConfig.contextLength > 0
    ? modelConfig.contextLength
    : DEFAULT_COMPRESSION_LIMIT
}

export function resolveCompressionReservedOutput(
  modelConfig?: Pick<AIModelConfig, 'maxOutputTokens'> | null
): number {
  const maxOutput =
    typeof modelConfig?.maxOutputTokens === 'number' && modelConfig.maxOutputTokens > 0
      ? Math.floor(modelConfig.maxOutputTokens)
      : DEFAULT_COMPRESSION_RESERVED_OUTPUT
  return Math.min(DEFAULT_COMPRESSION_RESERVED_OUTPUT, maxOutput)
}

export function getEffectiveContextWindow(config: CompressionConfig): number {
  if (config.contextLength <= 0) return 0
  const reserved = Math.max(
    0,
    config.reservedOutputBudget ?? DEFAULT_COMPRESSION_RESERVED_OUTPUT
  )
  return Math.max(1, config.contextLength - reserved)
}

export function getCompressionTriggerTokens(config: CompressionConfig): number {
  const effectiveWindow = getEffectiveContextWindow(config)
  if (effectiveWindow <= 0) return 0
  const ratioThreshold = Math.floor(effectiveWindow * config.threshold)
  const bufferedThreshold = effectiveWindow - COMPRESSION_AUTO_BUFFER
  return Math.max(
    1,
    Math.min(ratioThreshold, bufferedThreshold > 0 ? bufferedThreshold : ratioThreshold)
  )
}

export function getPreCompressionTriggerTokens(config: CompressionConfig): number {
  const effectiveWindow = getEffectiveContextWindow(config)
  if (effectiveWindow <= 0) return 0

  const preThreshold = config.preCompressThreshold ?? DEFAULT_PRECOMPRESS_THRESHOLD
  const ratioThreshold = Math.floor(effectiveWindow * preThreshold)
  const fullThreshold = getCompressionTriggerTokens(config)
  const candidates = [ratioThreshold]
  const bufferedThreshold = effectiveWindow - PRECOMPRESSION_BUFFER
  if (bufferedThreshold > 0) candidates.push(bufferedThreshold)
  const gapThreshold = fullThreshold - PRECOMPRESSION_GAP
  if (gapThreshold > 0) candidates.push(gapThreshold)
  const threshold = Math.min(...candidates)
  return Math.max(1, Math.min(threshold, Math.max(1, fullThreshold - 1)))
}

export function shouldCompress(inputTokens: number, config: CompressionConfig): boolean {
  if (!config.enabled || config.contextLength <= 0) return false
  return inputTokens >= getCompressionTriggerTokens(config)
}

export function shouldPreCompress(inputTokens: number, config: CompressionConfig): boolean {
  if (!config.enabled || config.contextLength <= 0) return false
  const preThreshold = getPreCompressionTriggerTokens(config)
  const fullThreshold = getCompressionTriggerTokens(config)
  return inputTokens >= preThreshold && inputTokens < fullThreshold
}
