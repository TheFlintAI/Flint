import type { LocalizedString } from '@/lib/localized-string'

// --- Token Usage ---

export interface RequestTiming {
  /** Total request duration in milliseconds (request start �?message_end). */
  totalMs: number
  /** Time to first token in milliseconds (request start �?first streamed content). */
  ttftMs?: number
  /** Output tokens per second, calculated from streamed output. */
  tps?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Normalized non-cached input tokens used for pricing/display when available. */
  billableInputTokens?: number
  /** Anthropic prompt caching: tokens written to cache */
  cacheCreationTokens?: number
  /** Anthropic prompt caching: tokens written to 5m cache */
  cacheCreation5mTokens?: number
  /** Anthropic prompt caching: tokens written to 1h cache */
  cacheCreation1hTokens?: number
  /** Anthropic prompt caching: tokens read from cache */
  cacheReadTokens?: number
  /** Reasoning model (o3/o4-mini etc.) internal thinking tokens */
  reasoningTokens?: number
  /** Last API call's input tokens �?represents current context window usage (not accumulated) */
  contextTokens?: number
  /** Effective context limit used for compression/runtime budgeting on this request */
  contextLength?: number
  /** Total wall time for the full agent run (including tools), in ms. */
  totalDurationMs?: number
  /** Per-request timing metrics for each API call in the loop. */
  requestTimings?: RequestTiming[]
}

// --- Content Blocks ---

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    mediaType?: string
    data?: string
    url?: string
    filePath?: string
  }
}

export type ImageErrorCode = 'timeout' | 'network' | 'request_aborted' | 'api_error' | 'unknown'

export interface ImageErrorBlock {
  type: 'image_error'
  code: ImageErrorCode
  message: string
}

export type AgentErrorCode = 'runtime_error' | 'tool_error' | 'unknown'

export interface AgentErrorBlock {
  type: 'agent_error'
  code: AgentErrorCode
  message: string
  errorType?: string
  details?: string
  stackTrace?: string
}

export type OpenAIComputerActionType =
  | 'click'
  | 'double_click'
  | 'scroll'
  | 'keypress'
  | 'type'
  | 'wait'
  | 'screenshot'

export interface ToolCallExtraContent {
  google?: {
    thought_signature?: string
  }
  openaiResponses?: {
    computerUse?: {
      kind: 'computer_use'
      computerCallId: string
      computerActionType: OpenAIComputerActionType
      computerActionIndex: number
      autoAddedScreenshot?: boolean
    }
  }
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  extraContent?: ToolCallExtraContent
}

/**
 * Placeholder stored in a persisted Write/Edit tool_use input field when the
 * original string was too large to keep resident in frontend memory. The full
 * payload is still present in the SQLite message row and can be rehydrated on
 * demand (see loadRequestContextMessages in chat-store.ts).
 */
export interface ElidedToolInput {
  __elided: true
  bytes: number
}

export function isElidedToolInput(value: unknown): value is ElidedToolInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __elided?: unknown }).__elided === true
  )
}

export type ToolResultContent = string | Array<TextBlock | ImageBlock>

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: ToolResultContent
  isError?: boolean
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  /** Provider-issued encrypted/signature payload for reasoning continuity validation */
  encryptedContent?: string
  /** Which provider emitted encryptedContent (used to replay only to compatible APIs) */
  encryptedContentProvider?: 'anthropic' | 'openai-responses' | 'google'
  startedAt?: number
  completedAt?: number
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ImageErrorBlock
  | AgentErrorBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock

// --- Messages ---

export interface RequestDebugInfo {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  contextWindowBody?: string
  timestamp: number
  providerId?: string
  providerBuiltinId?: string
  model?: string
  executionPath?: 'frontend'
  transport?: 'http' | 'websocket'
  fallbackReason?: string
  reusedConnection?: boolean
  websocketRequestKind?: 'warmup' | 'full' | 'incremental'
  websocketIncrementalReason?: string
  previousResponseId?: string
}


export interface CompressionMeta {
  trigger: 'auto' | 'manual'
  messagesCompressed: number
  preTokens?: number
}

export interface MessageContextSnapshot {
  /** Working folder path active when this message was sent */
  workspace?: string
  /** Clean user-authored text (without file tokens or editor tags) */
  text?: string
  /** File paths referenced in the message (for attachment display) */
  filePaths?: string[]
  /** Number of image attachments in the message */
  imageCount?: number
}

export interface MessageMeta {
  compression?: CompressionMeta
  contextSnapshot?: MessageContextSnapshot
}

export interface UnifiedMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentBlock[]
  createdAt: number
  usage?: TokenUsage
  debugInfo?: RequestDebugInfo
  /** Provider-native response ID for follow-up requests such as OpenAI Responses previous_response_id. */
  providerResponseId?: string
  /** Optional source marker for non-manual message insertion paths. */
  source?: 'team' | 'queued'
  /** Persisted auxiliary metadata used by transcript/runtime features. */
  meta?: MessageMeta
  /**
   * Monotonic counter bumped by the chat-store every time the message is mutated.
   * Used by React.memo equality checks to skip expensive deep content scans.
   * Not persisted to the database.
   */
  _revision?: number
}

// --- Streaming Events ---

export type StreamEventType =
  | 'message_start'
  | 'text_delta'
  | 'thinking_delta'
  | 'thinking_encrypted'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'image_generation_started'
  | 'image_generation_partial'
  | 'image_generated'
  | 'image_error'
  | 'message_end'
  | 'error'
  | 'request_debug'

export interface StreamEvent {
  type: StreamEventType
  text?: string
  thinking?: string
  thinkingEncryptedContent?: string
  thinkingEncryptedProvider?: 'anthropic' | 'openai-responses' | 'google'
  toolCallId?: string
  toolName?: string
  argumentsDelta?: string
  toolCallInput?: Record<string, unknown>
  toolCallExtraContent?: ToolCallExtraContent
  partialImageIndex?: number
  imageBlock?: ImageBlock
  imageError?: { code: ImageErrorCode; message: string }
  stopReason?: string
  usage?: TokenUsage
  timing?: RequestTiming
  providerResponseId?: string
  error?: { type: string; message: string }
  debugInfo?: RequestDebugInfo
}

// --- Tool Definitions ---

export interface ToolDefinition {
  name: string
  description: string
  inputSchema:
    | {
        type: 'object'
        properties: Record<string, unknown>
        required?: string[]
        additionalProperties?: boolean
      }
    | {
        type: 'object'
        oneOf: Array<{
          type: 'object'
          properties: Record<string, unknown>
          required?: string[]
          additionalProperties?: boolean
        }>
      }
}

// --- Thinking / Reasoning Config ---

export type ReasoningEffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

export interface ThinkingConfig {
  /** Extra key-value pairs merged into the request body when thinking is enabled */
  bodyParams: Record<string, unknown>
  /** Extra key-value pairs merged into the request body when thinking is explicitly disabled (e.g. MiMo: thinking.type="disabled") */
  disabledBodyParams?: Record<string, unknown>
  /** Force-override temperature when thinking is active (e.g. Anthropic requires 1) */
  forceTemperature?: number
  /**
   * Available reasoning effort levels for this model.
   * When set, the UI shows a level selector instead of a simple toggle.
   * The bodyParams should use a placeholder that gets replaced at runtime.
   */
  reasoningEffortLevels?: ReasoningEffortLevel[]
  /** Default reasoning effort level when thinking is first enabled */
  defaultReasoningEffort?: ReasoningEffortLevel
}

// --- Model Provider Management ---

export type ProviderType =
  | 'anthropic'
  | 'openai-chat'
  | 'openai-responses'
  | 'openai-images'
  | 'gemini'
  | 'vertex-ai'
export type ResponseSummary = 'auto' | 'concise' | 'detailed'
export type ResponsesImageGenerationAction = 'auto' | 'generate' | 'edit'
export type ResponsesImageGenerationBackground = 'auto' | 'transparent' | 'opaque'
export type ResponsesImageGenerationInputFidelity = 'low' | 'high'
export type ResponsesImageGenerationModeration = 'auto' | 'low'
export type ResponsesImageGenerationOutputFormat = 'png' | 'webp' | 'jpeg'
export type ResponsesImageGenerationQuality = 'auto' | 'low' | 'medium' | 'high'
export type ResponsesImageGenerationSize = 'auto' | '1024x1024' | '1024x1536' | '1536x1024'

export interface ResponsesImageGenerationInputMask {
  fileId?: string
  imageUrl?: string
}

export interface ResponsesImageGenerationConfig {
  enabled?: boolean
  action?: ResponsesImageGenerationAction
  background?: ResponsesImageGenerationBackground
  inputFidelity?: ResponsesImageGenerationInputFidelity
  /** Request-scoped mask used for inpainting. */
  inputImageMask?: ResponsesImageGenerationInputMask
  moderation?: ResponsesImageGenerationModeration
  outputCompression?: number
  outputFormat?: ResponsesImageGenerationOutputFormat
  partialImages?: number
  quality?: ResponsesImageGenerationQuality
  size?: ResponsesImageGenerationSize
}

export interface ImageGenerationStreamConfig {
  enabled?: boolean
  partialImages?: number
}

export type AuthMode = 'apiKey'

export type ModelCategory = 'chat' | 'speech' | 'embedding' | 'image'

export interface AIModelConfig {
  id: string
  name: string
  enabled: boolean
  /** Optional protocol override for this model; falls back to provider.type when omitted */
  type?: ProviderType
  /** How this model should be used (chat, speech, embedding, image) */
  category?: ModelCategory
  /** Icon key for model-level icon. Auto-inferred from model ID when omitted. */
  icon?: string
  contextLength?: number
  maxOutputTokens?: number
  /** Whether the model supports image/vision input */
  supportsVision?: boolean
  /** Whether the model supports toggleable thinking/reasoning mode */
  supportsThinking?: boolean
  /** Whether the model supports function calling / tool use. Defaults to true when omitted. */
  supportsFunctionCalling?: boolean
  /** Configuration describing how to enable thinking for this model */
  thinkingConfig?: ThinkingConfig
  /** Optional request overrides applied only to this model */
  requestOverrides?: RequestOverrides
  /** Whether the provider API supports strict JSON Schema (additionalProperties: false) in tool parameters */
  supportsStrictSchemas?: boolean
  /** Per-model override: OpenAI Responses reasoning summary level */
  responseSummary?: ResponseSummary
  /** Per-model override: OpenAI Responses image_generation tool configuration */
  responsesImageGeneration?: ResponsesImageGenerationConfig
  /** Per-model override: enable prompt caching with task-based key */
  enablePromptCache?: boolean
  /** Per-model override: Anthropic system prompt caching */
  enableSystemPromptCache?: boolean
  /** Per-model override: OpenAI Responses WebSocket endpoint */
  websocketUrl?: string
  /** Per-model override: OpenAI Responses transport mode */
  websocketMode?: 'auto' | 'disabled'
}

export interface RequestOverrides {
  /** Extra headers to include with API requests */
  headers?: Record<string, string>
  /** Body key-value overrides merged into the request body */
  body?: Record<string, unknown>
  /** Body keys to omit from the final payload */
  omitBodyKeys?: string[]
}

/** Provider-specific UI configuration bag (e.g. hide OAuth settings fields). */
export type ProviderUiConfig = Record<string, unknown>

/** Localized display name — any language code → translation. */
export interface BuiltinProviderPreset {
  builtinId: string
  name: LocalizedString
  type: ProviderType
  defaultBaseUrl: string
  defaultModels: AIModelConfig[]
  defaultEnabled?: boolean
  requiresApiKey?: boolean
  homepage: string

  /** Custom User-Agent header for providers that require platform identification */
  userAgent?: string
  /** Default model ID to use when this provider is first selected */
  defaultModel?: string
  /** Authentication mode for this provider */
  authMode?: AuthMode
  /** Optional request overrides (headers/body) for this provider */
  requestOverrides?: RequestOverrides
  /** Optional prompt name to use for Responses instructions */
  instructionsPrompt?: string
  /** Optional UI configuration for this provider */
  ui?: ProviderUiConfig
  /** OpenAI Responses WebSocket endpoint override for this provider preset */
  websocketUrl?: string
  /** OpenAI Responses transport mode for this provider preset */
  websocketMode?: 'auto' | 'disabled'
  /** Whether the API supports stream_options.include_usage for per-chunk token counting */
  supportsStreamOptions?: boolean
  /** Whether Flint prompt_cache_key is sent to this provider's API */
  supportsPromptCacheKey?: boolean
  /** Whether the API accepts strict JSON Schema (additionalProperties: false) in tool parameters */
  supportsStrictSchemas?: boolean
  /** Whether to send tool_choice parameter explicitly */
  supportsToolChoice?: boolean
}

export interface ModelProvider {
  id: string
  name: LocalizedString
  type: ProviderType
  apiKey: string
  baseUrl: string
  enabled: boolean
  models: AIModelConfig[]
  builtinId?: string
  createdAt: number
  /** Whether this provider requires an API key. Defaults to true when omitted. */
  requiresApiKey?: boolean
  /** Whether to skip TLS certificate validation for this provider's agent requests */
  allowInsecureTls?: boolean
  /** Custom User-Agent header (some providers require a specific UA string, e.g. 'RooCode/3.48.0') */
  userAgent?: string
  /** Default model ID to use when this provider is first selected */
  defaultModel?: string
  /** Authentication mode for this provider */
  authMode?: AuthMode
  /** Optional request overrides (headers/body) for this provider */
  requestOverrides?: RequestOverrides
  /** Optional prompt name to use for Responses instructions */
  instructionsPrompt?: string
  /** Optional UI configuration for this provider */
  ui?: ProviderUiConfig
  /** OAuth device id (e.g. Moonshot device binding) when authMode is oauth */
  oauth?: { deviceId?: string }
  /** OpenAI Responses WebSocket endpoint override for this provider */
  websocketUrl?: string
  /** OpenAI Responses transport mode for this provider */
  websocketMode?: 'auto' | 'disabled'
  /** Whether the API supports stream_options.include_usage for per-chunk token counting */
  supportsStreamOptions?: boolean
  /** Whether Flint prompt_cache_key is sent to this provider's API */
  supportsPromptCacheKey?: boolean
  /** Whether the API accepts strict JSON Schema (additionalProperties: false) in tool parameters */
  supportsStrictSchemas?: boolean
  /** Whether to send tool_choice parameter explicitly */
  supportsToolChoice?: boolean
}

// --- Provider Config ---

export interface ProviderConfig {
  type: ProviderType
  apiKey: string
  baseUrl?: string
  model: string
  category?: ModelCategory
  /** Provider ID (used for quota tracking and UI bindings) */
  providerId?: string
  /** Built-in provider ID (for preset-based mapping) */
  providerBuiltinId?: string
  /** OpenAI-compatible service tier override */
  serviceTier?: 'priority'
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  /** Whether this provider actually needs an API key */
  requiresApiKey?: boolean
  /** Whether to skip TLS certificate validation for this provider request */
  allowInsecureTls?: boolean
  /** Whether thinking mode is enabled for this request */
  thinkingEnabled?: boolean
  /** Thinking configuration from the active model */
  thinkingConfig?: ThinkingConfig
  /** Selected reasoning effort level (when model supports reasoningEffortLevels) */
  reasoningEffort?: ReasoningEffortLevel
  /** Current taskItem ID �?used for request correlation and Responses transport continuity */
  taskId?: string
  /** OpenAI Responses reusable WebSocket taskItem scope. Use distinct values for auxiliary flows. */
  responsesTaskScope?: string
  /** OpenAI Responses: summary of reasoning (auto/concise/detailed) */
  responseSummary?: ResponseSummary
  /** OpenAI Responses: image_generation tool configuration */
  responsesImageGeneration?: ResponsesImageGenerationConfig
  /** Request-scoped image streaming preview control for drawing flows. */
  imageGenerationStream?: ImageGenerationStreamConfig
  /** OpenAI Responses: enable prompt caching with task-based key */
  enablePromptCache?: boolean
  /** Whether OpenAI Computer Use should be enabled for this request */
  computerUseEnabled?: boolean
  /** Anthropic: enable system prompt caching */
  enableSystemPromptCache?: boolean
  /** Custom User-Agent header (some providers require a specific UA string, e.g. 'RooCode/3.48.0') */
  userAgent?: string
  /** Optional request overrides (headers/body) for this request */
  requestOverrides?: RequestOverrides
  /** Optional prompt name to use for Responses instructions */
  instructionsPrompt?: string
  /** OpenAI organization header */
  organization?: string
  /** Account-backed OpenAI/Codex requests may require Chatgpt-Account-Id */
  accountId?: string
  /** OpenAI project header */
  project?: string
  /** OpenAI Responses WebSocket endpoint override resolved for this request */
  websocketUrl?: string
  /** OpenAI Responses transport mode resolved for this request */
  websocketMode?: 'auto' | 'disabled'
  /** Whether the API supports stream_options.include_usage for per-chunk token counting */
  supportsStreamOptions?: boolean
  /** Whether Flint prompt_cache_key is sent to this provider's API */
  supportsPromptCacheKey?: boolean
  /** Whether the API accepts strict JSON Schema (additionalProperties: false) in tool parameters */
  supportsStrictSchemas?: boolean
  /** Whether the model supports function calling / tool use. When false, tools are not sent. */
  supportsFunctionCalling?: boolean
  /** Whether to send tool_choice parameter explicitly. Defaults to false (omitted, API defaults to "auto"). */
  supportsToolChoice?: boolean
}

// --- Provider Interface ---

export interface APIProvider {
  readonly name: string
  readonly type: ProviderType

  sendMessage(
    messages: UnifiedMessage[],
    tools: ToolDefinition[],
    config: ProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamEvent>

  formatMessages(messages: UnifiedMessage[]): unknown
  formatTools(tools: ToolDefinition[]): unknown
}
