import type { APIProvider, ProviderConfig, ProviderType } from './types'

const providers = new Map<ProviderType, () => APIProvider>()
const promptCacheKeyPrefix = 'flint'
const globalPromptCacheKey = createPromptCacheKey()
const promptCacheKeysByTask = new Map<string, string>()

function createPromptCacheKey(seed?: string): string {
  const normalizedSeed = seed?.trim()
  if (normalizedSeed) return `${promptCacheKeyPrefix}-${normalizedSeed}`
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${promptCacheKeyPrefix}-${crypto.randomUUID()}`
    : `${promptCacheKeyPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function registerProvider(type: ProviderType, factory: () => APIProvider): void {
  providers.set(type, factory)
}

export function createProvider(config: ProviderConfig): APIProvider {
  const factory = providers.get(config.type)
  if (!factory) {
    throw new Error(`Unknown provider type: ${config.type}`)
  }
  return factory()
}

export function getAvailableProviders(): ProviderType[] {
  return Array.from(providers.keys())
}

export function getGlobalPromptCacheKey(config?: Pick<ProviderConfig, 'taskId'>): string {
  const taskId = config?.taskId?.trim()
  if (!taskId) {
    return globalPromptCacheKey
  }

  const existing = promptCacheKeysByTask.get(taskId)
  if (existing) return existing

  const created = createPromptCacheKey(taskId)
  promptCacheKeysByTask.set(taskId, created)
  return created
}
