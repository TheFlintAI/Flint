// Public API for the compression subsystem.
//
// Module layout:
//   prompts     — LLM prompt templates
//   serialize   — message → text serialization for compression input
//   compress    — core compression (call AI summarizer, create compression message)
//   threshold   — auto-compression threshold config & calculation
//   precompress — lightweight pre-compression (clear old tool results/thinking)
//   runtime     — runtime compression config builder

export {
  isCompressionMessage,
  extractMessageText,
  createCompressionMessage,
  compressMessages,
} from './compress'

export type { CompressionConfig, CompressionResult } from './threshold'

export {
  DEFAULT_COMPRESSION_LIMIT,
  DEFAULT_COMPRESSION_THRESHOLD,
  MIN_COMPRESSION_THRESHOLD,
  MAX_COMPRESSION_THRESHOLD,
  DEFAULT_COMPRESSION_RESERVED_OUTPUT,
  COMPRESSION_AUTO_BUFFER,
  PRECOMPRESSION_BUFFER,
  PRECOMPRESSION_GAP,
  clampCompressionThreshold,
  resolveCompressionThreshold,
  resolveCompressionContextLength,
  resolveCompressionReservedOutput,
  getEffectiveContextWindow,
  getCompressionTriggerTokens,
  getPreCompressionTriggerTokens,
  shouldCompress,
  shouldPreCompress,
} from './threshold'

export { preCompressMessages } from './precompress'

export {
  buildRuntimeCompression,
  buildRuntimeCompressionConfig,
} from './runtime'
