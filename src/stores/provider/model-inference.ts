import type { AIModelConfig, ProviderType, ResponseSummary } from '@/lib/api/types'
import { useSettingsStore } from '../settings-store'

/** Infer supportsFunctionCall: default true, only false for embedding/speech models. */
export function inferSupportsFunctionCall(model: AIModelConfig): boolean {
  if (model.category === 'embedding') return false
  return true
}

/** Infer supportsComputerUse: only for GPT-5.x + openai-responses type. */
export function inferSupportsComputerUse(model: AIModelConfig, providerType: ProviderType): boolean {
  const requestType = model.type ?? providerType
  if (requestType !== 'openai-responses') return false
  const normalized = model.id.toLowerCase()
  return normalized.includes('gpt-5')
}

/** Infer enableComputerUse: same as supportsComputerUse for now. */
export function inferComputerUseEnabled(model: AIModelConfig, providerType: ProviderType): boolean {
  return inferSupportsComputerUse(model, providerType)
}

/** Infer icon from model ID prefix. */
export function inferIcon(modelId: string): string | undefined {
  const id = modelId.toLowerCase()
  if (id.includes('claude')) return 'claude'
  if (id.includes('gpt') || id.includes('o3') || id.includes('o4')) return 'openai'
  if (id.includes('gemini')) return 'gemini'
  if (id.includes('deepseek')) return 'deepseek'
  if (id.includes('qwen') || id.includes('qwq')) return 'qwen'
  if (id.includes('glm')) return 'chatglm'
  if (id.includes('kimi')) return 'kimi'
  if (id.includes('minimax')) return 'minimax'
  if (id.includes('mimo')) return 'mimo'
  if (id.includes('ernie')) return 'baidu'
  if (id.includes('llama')) return 'meta'
  if (id.includes('mistral')) return 'mistral'
  if (id.includes('grok')) return 'grok'
  if (id.includes('hunyuan')) return 'hunyuan'
  return undefined
}

/** Infer enableExtendedContextCompression: true when context > 200K. */
export function inferExtendedContextCompression(model: AIModelConfig): boolean {
  return (model.contextLength ?? 0) > 200000
}

/** Infer enableSystemPromptCache: true for anthropic type. */
export function inferSystemPromptCache(providerType: ProviderType): boolean {
  return providerType === 'anthropic'
}

/** Infer enablePromptCache: true for openai-chat/responses with known models. */
export function inferPromptCache(model: AIModelConfig, providerType: ProviderType): boolean {
  const requestType = model.type ?? providerType
  if (requestType !== 'openai-chat' && requestType !== 'openai-responses') return false
  if (model.category === 'image' || model.category === 'speech' || model.category === 'embedding') return false
  const id = model.id.toLowerCase()
  if (id.includes('gpt-5') || id.includes('gpt-4') || id.includes('o3') || id.includes('o4')) return true
  return false
}

/** Resolve responseSummary: "detailed" for codex models. */
export function inferResponseSummary(model: AIModelConfig): ResponseSummary | undefined {
  if (model.id.toLowerCase().includes('codex')) return 'detailed'
  return undefined
}

/** Resolve service tier: only for fast mode on known supported models. */
export function resolveServiceTier(
  model: AIModelConfig | null | undefined,
  _providerBuiltinId?: string
): 'priority' | undefined {
  if (!model) return undefined
  const id = model.id.toLowerCase()
  if (id.includes('gpt-5') && useSettingsStore.getState().fastModeEnabled) return 'priority'
  return undefined
}

/** Build runtime model config with inference applied. */
export function resolveRuntimeModelConfig(
  model: AIModelConfig | null | undefined,
  provider: { type: ProviderType; builtinId?: string }
): {
  resolvedModel: AIModelConfig | null
  requestType: ProviderType
  supportsFunctionCall: boolean
  supportsComputerUse: boolean
  computerUseEnabled: boolean
  enablePromptCache: boolean
  enableSystemPromptCache: boolean
  responseSummary: ResponseSummary | undefined
  serviceTier: 'priority' | undefined
} {
  const resolvedModel = model ?? null
  const requestType = (resolvedModel?.type ?? provider.type) as ProviderType
  return {
    resolvedModel,
    requestType,
    supportsFunctionCall: resolvedModel ? inferSupportsFunctionCall(resolvedModel) : true,
    supportsComputerUse: resolvedModel ? inferSupportsComputerUse(resolvedModel, provider.type) : false,
    computerUseEnabled: resolvedModel ? inferComputerUseEnabled(resolvedModel, provider.type) : false,
    enablePromptCache: resolvedModel ? inferPromptCache(resolvedModel, provider.type) : false,
    enableSystemPromptCache: inferSystemPromptCache(provider.type),
    responseSummary: resolvedModel ? inferResponseSummary(resolvedModel) : undefined,
    serviceTier: resolveServiceTier(resolvedModel, provider.builtinId),
  }
}
