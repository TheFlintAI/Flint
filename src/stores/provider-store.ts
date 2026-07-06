import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type {
  ModelProvider,
  AIModelConfig,
  ProviderConfig,
  ProviderType,
  ModelCategory,
  RequestOverrides,
  BuiltinProviderPreset
} from '../lib/api/types'

import { configStorage } from '@/services/tauri-api/config-storage'
import { createLogger } from '@/lib/logger'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { normalizeResponsesImageGenerationConfig } from '@/lib/api/responses-image-generation'

const log = createLogger('ProviderStore')

let _builtinPresets: BuiltinProviderPreset[] = []
let _presetsLoaded = false

export type { BuiltinProviderPreset }

/** Load built-in provider presets from Rust (TOML files). Call once at startup. */
export async function loadBuiltinPresets(): Promise<void> {
  if (_presetsLoaded) return
  try {
    const presets = await tauriCommands.invoke<BuiltinProviderPreset[]>('provider:get-builtin-presets')
    _builtinPresets = Array.isArray(presets) ? presets : []
    _presetsLoaded = true
    log.info(`Loaded ${_builtinPresets.length} built-in provider presets`)
  } catch (error) {
    log.error('Failed to load built-in presets:', error)
    _builtinPresets = []
    _presetsLoaded = true
  }
}

export function getBuiltinPresets(): BuiltinProviderPreset[] {
  return _builtinPresets
}

export { createProviderFromPreset }

export function normalizeModelKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }
  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      cloned[key] = cloneValue(item)
    }
    return cloned as T
  }
  return value
}

function cloneModelConfig(model: AIModelConfig): AIModelConfig {
  return cloneValue(model)
}

function resolveModelIdByKey(models: AIModelConfig[], modelId: string): string | undefined {
  const modelKey = normalizeModelKey(modelId)
  return models.find((model) => normalizeModelKey(model.id) === modelKey)?.id
}

export function buildProviderModelSnapshot(
  model: AIModelConfig,
  options: {
    existingModel?: AIModelConfig | null
  } = {}
): AIModelConfig {
  const baseModel = cloneModelConfig(model)
  const existingModel = options.existingModel ? cloneModelConfig(options.existingModel) : null

  if (existingModel) {
    return {
      ...existingModel,
      ...baseModel,
      enabled: existingModel.enabled
    }
  }

  return baseModel
}

function createProviderFromPreset(preset: BuiltinProviderPreset): ModelProvider {
  const models = preset.defaultModels.map((model) => buildProviderModelSnapshot(model))
  const defaultModel = preset.defaultModel
    ? (resolveModelIdByKey(models, preset.defaultModel) ?? preset.defaultModel)
    : undefined

  return {
    id: nanoid(),
    name: { ...(preset.name as Record<string, string>) },
    type: preset.type,
    apiKey: '',
    baseUrl: preset.defaultBaseUrl.trim(),
    enabled: preset.defaultEnabled ?? false,
    models,
    builtinId: preset.builtinId,
    createdAt: Date.now(),
    requiresApiKey: preset.requiresApiKey ?? true,
    ...(preset.userAgent ? { userAgent: preset.userAgent } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    authMode: preset.authMode ?? 'apiKey',
        ...(preset.requestOverrides ? { requestOverrides: { ...preset.requestOverrides } } : {}),
    ...(preset.instructionsPrompt ? { instructionsPrompt: preset.instructionsPrompt } : {}),
    ...(preset.ui ? { ui: { ...preset.ui } } : {}),
    ...(preset.websocketUrl ? { websocketUrl: preset.websocketUrl } : {}),
    ...(preset.websocketMode ? { websocketMode: preset.websocketMode } : {}),
    ...(preset.supportsStreamOptions !== undefined ? { supportsStreamOptions: preset.supportsStreamOptions } : {}),
    ...(preset.supportsPromptCacheKey !== undefined ? { supportsPromptCacheKey: preset.supportsPromptCacheKey } : {}),
    ...(preset.supportsStrictSchemas !== undefined ? { supportsStrictSchemas: preset.supportsStrictSchemas } : {}),
    ...(preset.supportsToolChoice !== undefined ? { supportsToolChoice: preset.supportsToolChoice } : {})
  }
}

export function modelSupportsVision(
  model: AIModelConfig | null | undefined,
  providerType?: ProviderType
): boolean {
  if (!model) return providerType === 'openai-images'
  const requestType = model.type ?? providerType
  return Boolean(
    model.supportsVision || model.category === 'image' || requestType === 'openai-images'
  )
}

// ── Auto-inference helpers (extracted) ──
import {
  inferComputerUseEnabled,
  resolveServiceTier,
  resolveRuntimeModelConfig
} from './provider/model-inference'

export function isProviderAuthReady(provider: ModelProvider | null | undefined): boolean {
  if (!provider) return false

  const authMode = provider.authMode ?? 'apiKey'
  if (authMode === 'apiKey') {
    return provider.requiresApiKey === false || provider.apiKey.trim().length > 0
  }
  return false
}

export function isProviderAvailableForModelSelection(
  provider: ModelProvider | null | undefined
): boolean {
  if (!provider?.enabled) return false
  return isProviderAuthReady(provider)
}

export function getEnabledModelsByCategory(
  provider: ModelProvider | null | undefined,
  category: ModelCategory
): AIModelConfig[] {
  if (!provider) return []
  return provider.models.filter((model) => model.enabled && (model.category ?? 'chat') === category)
}

export function normalizeProviderBaseUrl(
  baseUrl: string,
  requestType: ProviderConfig['type']
): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (requestType === 'anthropic') {
    // Anthropic provider will append `/v1/messages` itself.
    return trimmed.replace(/\/v1(?:\/messages)?$/i, '')
  }
  return trimmed
}

function mergeRequestOverrides(
  ...overrides: (RequestOverrides | undefined)[]
): RequestOverrides | undefined {
  const merged: RequestOverrides = {}
  let hasHeaders = false
  let hasBody = false
  let hasOmitKeys = false

  for (const override of overrides) {
    if (!override) continue

    if (override.headers) {
      merged.headers = { ...(merged.headers ?? {}), ...override.headers }
      hasHeaders = true
    }

    if (override.body) {
      merged.body = { ...(merged.body ?? {}), ...override.body }
      hasBody = true
    }

    if (override.omitBodyKeys?.length) {
      const existing = new Set(merged.omitBodyKeys ?? [])
      for (const key of override.omitBodyKeys) {
        if (key) existing.add(key)
      }
      merged.omitBodyKeys = Array.from(existing)
      hasOmitKeys = merged.omitBodyKeys.length > 0
    }
  }

  return hasHeaders || hasBody || hasOmitKeys ? merged : undefined
}

function usesGpt5Model(modelId?: string): boolean {
  if (!modelId) return false
  const normalized = modelId.split('/').pop() ?? modelId
  return /^gpt-5/i.test(normalized)
}

function ensureTemperatureOmit(
  overrides: RequestOverrides | undefined,
  modelId?: string
): RequestOverrides | undefined {
  if (!usesGpt5Model(modelId)) {
    return overrides
  }

  const omitBodyKeys = new Set(overrides?.omitBodyKeys ?? [])
  omitBodyKeys.add('temperature')

  const result: RequestOverrides = {}
  if (overrides?.headers) {
    result.headers = overrides.headers
  }
  if (overrides?.body) {
    result.body = overrides.body
  }
  result.omitBodyKeys = Array.from(omitBodyKeys)
  return result
}

function buildRequestOverrides(
  providerOverrides: RequestOverrides | undefined,
  modelOverrides: RequestOverrides | undefined,
  modelId?: string
): RequestOverrides | undefined {
  const merged = mergeRequestOverrides(providerOverrides, modelOverrides)
  return ensureTemperatureOmit(merged, modelId)
}

function resolveProviderAccountId(_provider: ModelProvider): string | undefined {
  return undefined
}

function mergeBuiltinModels(
  existingModels: AIModelConfig[],
  presetModels: AIModelConfig[]
): AIModelConfig[] {
  const existingByKey = new Map(
    existingModels.map((model) => [normalizeModelKey(model.id), model] as const)
  )
  const presetKeys = new Set(presetModels.map((model) => normalizeModelKey(model.id)))

  const merged = presetModels.map((presetModel) => {
    const modelKey = normalizeModelKey(presetModel.id)
    return buildProviderModelSnapshot(presetModel, {
      existingModel: existingByKey.get(modelKey) ?? null
    })
  })

  for (const existingModel of existingModels) {
    const modelKey = normalizeModelKey(existingModel.id)
    if (!presetKeys.has(modelKey)) {
      merged.push(existingModel)
    }
  }

  return merged
}

function resolveProviderDefaultModelId(provider: ModelProvider): string {
  const defaultModelId = provider.defaultModel
    ? resolveModelIdByKey(provider.models, provider.defaultModel)
    : undefined
  const defaultModel = defaultModelId
    ? provider.models.find((model) => model.id === defaultModelId)
    : null
  if (defaultModel?.enabled) return defaultModel.id

  const enabledModels = provider.models.filter((model) => model.enabled)
  if (enabledModels[0]) return enabledModels[0].id

  return defaultModel?.id ?? provider.models[0]?.id ?? ''
}

function resolveProviderDefaultModelIdByCategory(
  provider: ModelProvider,
  category: ModelCategory
): string {
  const defaultModelId = provider.defaultModel
    ? resolveModelIdByKey(provider.models, provider.defaultModel)
    : undefined
  const defaultModel = defaultModelId
    ? provider.models.find((model) => model.id === defaultModelId)
    : null
  if (defaultModel?.enabled && (defaultModel.category ?? 'chat') === category) {
    return defaultModel.id
  }

  const categoryModels = provider.models.filter((model) => (model.category ?? 'chat') === category)
  const enabledModels = categoryModels.filter((model) => model.enabled)
  if (enabledModels[0]) return enabledModels[0].id

  if (defaultModel && (defaultModel.category ?? 'chat') === category) {
    return defaultModel.id
  }

  return categoryModels[0]?.id ?? ''
}

function resolveDefaultAuxSelection(
  providers: ModelProvider[]
): { providerId: string; modelId: string } | null {
  const fallbackProviderId = resolveFirstProviderIdByCategory(providers, 'chat')
  if (!fallbackProviderId) return null
  const fallbackProvider = providers.find((provider) => provider.id === fallbackProviderId)
  if (!fallbackProvider) return null
  const modelId =
    resolveProviderDefaultModelIdByCategory(fallbackProvider, 'chat') ||
    resolveProviderDefaultModelId(fallbackProvider)
  if (!modelId) return null
  return { providerId: fallbackProvider.id, modelId }
}

function resolveFirstProviderIdByCategory(
  providers: ModelProvider[],
  category: ModelCategory
): string | null {
  return (
    providers.find(
      (provider) =>
        isProviderAvailableForModelSelection(provider) &&
        provider.models.some((model) => model.enabled && (model.category ?? 'chat') === category)
    )?.id ?? null
  )
}

function resolveValidModelIdByCategory(
  provider: ModelProvider,
  modelId: string,
  category: ModelCategory
): string {
  const currentModelId = resolveModelIdByKey(provider.models, modelId)
  const current = currentModelId
    ? provider.models.find((model) => model.id === currentModelId)
    : null
  if (current && current.enabled && (current.category ?? 'chat') === category) {
    return current.id
  }
  return resolveProviderDefaultModelIdByCategory(provider, category)
}

// --- Store ---

interface ProviderStore {
  providers: ModelProvider[]
  activeProviderId: string | null
  activeModelId: string
  activeAuxProviderId: string | null
  activeAuxModelId: string
  activeSpeechProviderId: string | null
  activeSpeechModelId: string
  activeImageProviderId: string | null
  activeImageModelId: string

  // CRUD
  addProvider: (provider: ModelProvider) => void
  addProviderFromPreset: (builtinId: string) => string | null
  updateProvider: (id: string, patch: Partial<Omit<ModelProvider, 'id'>>) => void
  removeProvider: (id: string) => void
  removeProviders: (ids: string[]) => void
  reorderProviders: (orderedIds: string[]) => void
  toggleProviderEnabled: (id: string) => void

  addModel: (providerId: string, model: AIModelConfig) => void
  updateModel: (providerId: string, modelId: string, patch: Partial<AIModelConfig>) => void
  removeModel: (providerId: string, modelId: string) => void
  toggleModelEnabled: (providerId: string, modelId: string) => void
  setProviderModels: (providerId: string, models: AIModelConfig[]) => void

  // Active selection
  setActiveProvider: (providerId: string) => void
  setActiveModel: (modelId: string) => void
  setActiveAuxProvider: (providerId: string) => void
  setActiveAuxModel: (modelId: string) => void
  setActiveSpeechProvider: (providerId: string) => void
  setActiveSpeechModel: (modelId: string) => void
  setActiveImageProvider: (providerId: string) => void
  setActiveImageModel: (modelId: string) => void

  // Derived
  getActiveProvider: () => ModelProvider | null
  getActiveModelConfig: () => AIModelConfig | null
  getActiveProviderConfig: () => ProviderConfig | null
  /** Build a ProviderConfig for a specific provider+model (used by plugin/task overrides) */
  getProviderConfigById: (providerId: string, modelId: string) => ProviderConfig | null
  getAuxProviderConfig: () => ProviderConfig | null
  /** Build provider config for speech recognition; returns null if not configured */
  getSpeechProviderConfig: () => ProviderConfig | null
  /** Build provider config for image generation; returns null if not configured */
  getImageProviderConfig: () => ProviderConfig | null
  /** Clamp user maxTokens to model's maxOutputTokens if exceeded */
  getEffectiveMaxTokens: (userMaxTokens: number, modelId?: string) => number
  /** Look up a model's maxOutputTokens by model ID */
  getActiveModelMaxOutputTokens: (modelId?: string) => number | undefined
  /** Whether the active model supports thinking and its config */
  getActiveModelSupportsThinking: () => boolean
  getActiveModelThinkingConfig: () => import('../lib/api/types').ThinkingConfig | undefined
}

type ProviderSelectionState = Pick<
  ProviderStore,
  | 'activeProviderId'
  | 'activeModelId'
  | 'activeAuxProviderId'
  | 'activeAuxModelId'
  | 'activeSpeechProviderId'
  | 'activeSpeechModelId'
  | 'activeImageProviderId'
  | 'activeImageModelId'
>

function resolveProviderSelectionByCategory(
  providers: ModelProvider[],
  providerId: string | null,
  modelId: string,
  category: ModelCategory
): { providerId: string | null; modelId: string } {
  const currentProvider = providerId
    ? providers.find((provider) => provider.id === providerId)
    : null
  const hasEnabledCategoryModel = currentProvider?.models.some(
    (model) => model.enabled && (model.category ?? 'chat') === category
  )

  if (
    currentProvider &&
    hasEnabledCategoryModel &&
    isProviderAvailableForModelSelection(currentProvider)
  ) {
    const nextModelId = resolveValidModelIdByCategory(currentProvider, modelId, category)
    if (nextModelId) {
      return { providerId: currentProvider.id, modelId: nextModelId }
    }
  }

  const fallbackProviderId = resolveFirstProviderIdByCategory(providers, category)
  if (!fallbackProviderId) {
    return { providerId: null, modelId: '' }
  }

  const fallbackProvider = providers.find((provider) => provider.id === fallbackProviderId)
  if (!fallbackProvider) {
    return { providerId: null, modelId: '' }
  }

  const fallbackModelId = resolveValidModelIdByCategory(fallbackProvider, '', category)
  if (!fallbackModelId) {
    return { providerId: null, modelId: '' }
  }

  return { providerId: fallbackProvider.id, modelId: fallbackModelId }
}

function buildNormalizedProviderState(
  state: ProviderSelectionState,
  providers: ModelProvider[]
): Partial<ProviderStore> {
  const mainSelection = resolveProviderSelectionByCategory(
    providers,
    state.activeProviderId,
    state.activeModelId,
    'chat'
  )

  const hasExplicitAuxSelection = Boolean(state.activeAuxProviderId || state.activeAuxModelId)
  const explicitAuxSelection = hasExplicitAuxSelection
    ? resolveProviderSelectionByCategory(
        providers,
        state.activeAuxProviderId ?? mainSelection.providerId,
        state.activeAuxModelId,
        'chat'
      )
    : { providerId: null, modelId: '' }
  const auxSelection =
    explicitAuxSelection.providerId && explicitAuxSelection.modelId
      ? explicitAuxSelection
      : (resolveDefaultAuxSelection(providers) ??
        resolveProviderSelectionByCategory(
          providers,
          mainSelection.providerId,
          mainSelection.modelId,
          'chat'
        ))

  const imageSelection = resolveProviderSelectionByCategory(
    providers,
    state.activeImageProviderId,
    state.activeImageModelId,
    'image'
  )

  const speechSelection = state.activeSpeechProviderId
    ? resolveProviderSelectionByCategory(
        providers,
        state.activeSpeechProviderId,
        state.activeSpeechModelId,
        'speech'
      )
    : { providerId: null, modelId: '' }

  return {
    activeProviderId: mainSelection.providerId,
    activeModelId: mainSelection.modelId,
    activeAuxProviderId: auxSelection.providerId,
    activeAuxModelId: auxSelection.modelId,
    activeSpeechProviderId: speechSelection.providerId,
    activeSpeechModelId: speechSelection.modelId,
    activeImageProviderId: imageSelection.providerId,
    activeImageModelId: imageSelection.modelId
  }
}

export const useProviderStore = create<ProviderStore>()(
  persist(
    (set, get) => ({
      providers: [],
      activeProviderId: null,
      activeModelId: '',
      activeAuxProviderId: null,
      activeAuxModelId: '',
      activeSpeechProviderId: null,
      activeSpeechModelId: '',
      activeImageProviderId: null,
      activeImageModelId: '',

      addProvider: (provider) =>
        set((state) => {
          const providers = [...state.providers, provider]
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      addProviderFromPreset: (builtinId) => {
        const preset = getBuiltinPresets().find((p) => p.builtinId === builtinId)
        if (!preset) return null
        const existing = get().providers.find((p) => p.builtinId === builtinId)
        if (existing) return existing.id
        const provider = createProviderFromPreset(preset)
        set((state) => {
          const providers = [...state.providers, provider]
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        })
        return provider.id
      },

      updateProvider: (id, patch) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === id ? { ...provider, ...patch } : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      removeProvider: (id) =>
        set((state) => {
          const providers = state.providers.filter((provider) => provider.id !== id)
          return {
            providers,
            ...buildNormalizedProviderState(
              {
                ...state,
                activeProviderId: state.activeProviderId === id ? null : state.activeProviderId,
                activeModelId: state.activeProviderId === id ? '' : state.activeModelId,
                activeSpeechProviderId:
                  state.activeSpeechProviderId === id ? null : state.activeSpeechProviderId,
                activeSpeechModelId:
                  state.activeSpeechProviderId === id ? '' : state.activeSpeechModelId,
                activeImageProviderId:
                  state.activeImageProviderId === id ? null : state.activeImageProviderId,
                activeImageModelId:
                  state.activeImageProviderId === id ? '' : state.activeImageModelId,
                activeAuxProviderId:
                  state.activeAuxProviderId === id ? null : state.activeAuxProviderId,
                activeAuxModelId: state.activeAuxProviderId === id ? '' : state.activeAuxModelId
              },
              providers
            )
          }
        }),

      removeProviders: (ids) =>
        set((state) => {
          const idSet = new Set(ids)
          const providers = state.providers.filter((p) => !idSet.has(p.id))
          const _removedFirst =
            ids.includes(state.activeProviderId ?? '') ||
            ids.includes(state.activeSpeechProviderId ?? '') ||
            ids.includes(state.activeImageProviderId ?? '') ||
            ids.includes(state.activeAuxProviderId ?? '')
          return {
            providers,
            ...buildNormalizedProviderState(
              {
                ...state,
                ...(ids.includes(state.activeProviderId ?? '')
                  ? { activeProviderId: null, activeModelId: '' }
                  : {}),
                ...(ids.includes(state.activeSpeechProviderId ?? '')
                  ? { activeSpeechProviderId: null, activeSpeechModelId: '' }
                  : {}),
                ...(ids.includes(state.activeImageProviderId ?? '')
                  ? { activeImageProviderId: null, activeImageModelId: '' }
                  : {}),
                ...(ids.includes(state.activeAuxProviderId ?? '')
                  ? { activeAuxProviderId: null, activeAuxModelId: '' }
                  : {})
              },
              providers
            )
          }
        }),

      reorderProviders: (orderedIds) =>
        set((state) => {
          const idToProvider = new Map(state.providers.map((p) => [p.id, p]))
          const providers = orderedIds
            .map((id) => idToProvider.get(id))
            .filter((p): p is ModelProvider => Boolean(p))
          // Append any providers not in the ordered list (shouldn't happen normally)
          for (const p of state.providers) {
            if (!orderedIds.includes(p.id)) {
              providers.push(p)
            }
          }
          return { providers, ...buildNormalizedProviderState(state, providers) }
        }),

      toggleProviderEnabled: (id) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === id ? { ...provider, enabled: !provider.enabled } : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      addModel: (providerId, model) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === providerId
              ? { ...provider, models: [...provider.models, model] }
              : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      updateModel: (providerId, modelId, patch) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  models: provider.models.map((model) =>
                    model.id === modelId ? { ...model, ...patch } : model
                  )
                }
              : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      removeModel: (providerId, modelId) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === providerId
              ? { ...provider, models: provider.models.filter((model) => model.id !== modelId) }
              : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      toggleModelEnabled: (providerId, modelId) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  models: provider.models.map((model) =>
                    model.id === modelId ? { ...model, enabled: !model.enabled } : model
                  )
                }
              : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      setProviderModels: (providerId, models) =>
        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === providerId ? { ...provider, models } : provider
          )
          return {
            providers,
            ...buildNormalizedProviderState(state, providers)
          }
        }),

      setActiveProvider: (providerId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeProviderId: providerId,
              activeModelId: ''
            },
            state.providers
          )
        ),

      setActiveModel: (modelId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeModelId: modelId
            },
            state.providers
          )
        ),

      setActiveAuxProvider: (providerId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeAuxProviderId: providerId,
              activeAuxModelId: ''
            },
            state.providers
          )
        ),

      setActiveAuxModel: (modelId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeAuxModelId: modelId
            },
            state.providers
          )
        ),

      setActiveSpeechProvider: (providerId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeSpeechProviderId: providerId,
              activeSpeechModelId: ''
            },
            state.providers
          )
        ),

      setActiveSpeechModel: (modelId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeSpeechModelId: modelId
            },
            state.providers
          )
        ),

      setActiveImageProvider: (providerId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeImageProviderId: providerId,
              activeImageModelId: ''
            },
            state.providers
          )
        ),

      setActiveImageModel: (modelId) =>
        set((state) =>
          buildNormalizedProviderState(
            {
              ...state,
              activeImageModelId: modelId
            },
            state.providers
          )
        ),

      getActiveProvider: () => {
        const { providers, activeProviderId } = get()
        if (!activeProviderId) return null
        return providers.find((p) => p.id === activeProviderId) ?? null
      },

      getActiveModelConfig: () => {
        const { providers, activeProviderId, activeModelId } = get()
        if (!activeProviderId) return null
        const provider = providers.find((p) => p.id === activeProviderId)
        if (!provider) return null
        return provider.models.find((m) => m.id === activeModelId) ?? null
      },

      getActiveProviderConfig: () => {
        const { providers, activeProviderId, activeModelId } = get()
        if (!activeProviderId) return null
        const provider = providers.find((p) => p.id === activeProviderId)
        if (!provider) return null
        const activeModel = provider.models.find((m) => m.id === activeModelId)

        const inferred = resolveRuntimeModelConfig(activeModel, provider)
        let requestType = inferred.requestType
        if (activeModel?.category === 'image' && !activeModel?.type) {
          requestType = 'openai-images'
        }

        const resolvedBaseUrl = provider.baseUrl
        const normalizedBaseUrl = resolvedBaseUrl
          ? normalizeProviderBaseUrl(resolvedBaseUrl, requestType)
          : undefined
        const requestOverrides = buildRequestOverrides(
          provider.requestOverrides,
          activeModel?.requestOverrides,
          activeModel?.id ?? activeModelId
        )
        const accountId = resolveProviderAccountId(provider)
        return {
          type: requestType,
          apiKey: provider.apiKey,
          baseUrl: normalizedBaseUrl,
          model: activeModelId,
          category: activeModel?.category,
          providerId: provider.id,
          providerBuiltinId: provider.builtinId,
          computerUseEnabled: inferred.computerUseEnabled,
          ...(inferred.serviceTier ? { serviceTier: inferred.serviceTier } : {}),
          requiresApiKey: provider.requiresApiKey,
          ...(provider.allowInsecureTls !== undefined
            ? { allowInsecureTls: provider.allowInsecureTls }
            : {}),
          ...(inferred.responseSummary ? { responseSummary: inferred.responseSummary } : {}),
          enablePromptCache: inferred.enablePromptCache,
          enableSystemPromptCache: inferred.enableSystemPromptCache,
          ...(provider.userAgent ? { userAgent: provider.userAgent } : {}),
          ...(requestOverrides ? { requestOverrides } : {}),
          ...(provider.instructionsPrompt
            ? { instructionsPrompt: provider.instructionsPrompt }
            : {}),
          ...(accountId ? { accountId } : {}),
          ...(activeModel?.thinkingConfig ? { thinkingConfig: activeModel.thinkingConfig } : {}),
          ...(provider.websocketUrl ? { websocketUrl: provider.websocketUrl } : {}),
          ...(provider.websocketMode ? { websocketMode: provider.websocketMode } : {}),
          ...(provider.supportsStreamOptions !== undefined
            ? { supportsStreamOptions: provider.supportsStreamOptions }
            : {}),
          ...(provider.supportsPromptCacheKey !== undefined
            ? { supportsPromptCacheKey: provider.supportsPromptCacheKey }
            : {}),
          ...(provider.supportsStrictSchemas !== undefined
            ? { supportsStrictSchemas: provider.supportsStrictSchemas }
            : {})
        }
      },

      getSpeechProviderConfig: () => {
        const { activeSpeechProviderId, activeSpeechModelId, getProviderConfigById } = get()
        if (!activeSpeechProviderId || !activeSpeechModelId) return null
        return getProviderConfigById(activeSpeechProviderId, activeSpeechModelId)
      },

      getImageProviderConfig: () => {
        const { activeImageProviderId, activeImageModelId, getProviderConfigById } = get()
        if (!activeImageProviderId || !activeImageModelId) return null
        return getProviderConfigById(activeImageProviderId, activeImageModelId)
      },

      getProviderConfigById: (providerId, modelId) => {
        const provider = get().providers.find((p) => p.id === providerId)
        if (!provider) return null
        const resolvedModelId = modelId
        const model = provider.models.find((m) => m.id === resolvedModelId)

        const inferred = resolveRuntimeModelConfig(model, provider)
        let requestType = inferred.requestType
        if (model?.category === 'image' && !model?.type) {
          requestType = 'openai-images'
        }

        const resolvedBaseUrl = provider.baseUrl
        const normalizedBaseUrl = resolvedBaseUrl
          ? normalizeProviderBaseUrl(resolvedBaseUrl, requestType)
          : undefined
        const requestOverrides = buildRequestOverrides(
          provider.requestOverrides,
          model?.requestOverrides,
          model?.id ?? resolvedModelId
        )
        const accountId = resolveProviderAccountId(provider)
        return {
          type: requestType,
          apiKey: provider.apiKey,
          baseUrl: normalizedBaseUrl,
          model: resolvedModelId,
          category: model?.category,
          providerId: provider.id,
          providerBuiltinId: provider.builtinId,
          computerUseEnabled: inferred.computerUseEnabled,
          ...(inferred.serviceTier ? { serviceTier: inferred.serviceTier } : {}),
          requiresApiKey: provider.requiresApiKey,
          ...(provider.allowInsecureTls !== undefined
            ? { allowInsecureTls: provider.allowInsecureTls }
            : {}),
          ...(inferred.responseSummary ? { responseSummary: inferred.responseSummary } : {}),
          enablePromptCache: inferred.enablePromptCache,
          enableSystemPromptCache: inferred.enableSystemPromptCache,
          ...(provider.userAgent ? { userAgent: provider.userAgent } : {}),
          ...(requestOverrides ? { requestOverrides } : {}),
          ...(provider.instructionsPrompt
            ? { instructionsPrompt: provider.instructionsPrompt }
            : {}),
          ...(accountId ? { accountId } : {}),
          ...(model?.thinkingConfig ? { thinkingConfig: model.thinkingConfig } : {}),
          ...(provider.websocketUrl ? { websocketUrl: provider.websocketUrl } : {}),
          ...(provider.websocketMode ? { websocketMode: provider.websocketMode } : {}),
          ...(provider.supportsStreamOptions !== undefined
            ? { supportsStreamOptions: provider.supportsStreamOptions }
            : {}),
          ...(provider.supportsPromptCacheKey !== undefined
            ? { supportsPromptCacheKey: provider.supportsPromptCacheKey }
            : {}),
          ...(provider.supportsStrictSchemas !== undefined
            ? { supportsStrictSchemas: provider.supportsStrictSchemas }
            : {})
        }
      },

      getAuxProviderConfig: () => {
        const {
          providers,
          activeProviderId,
          activeModelId,
          activeAuxProviderId,
          activeAuxModelId
        } = get()
        const hasExplicitAuxSelection = Boolean(activeAuxProviderId || activeAuxModelId)
        const explicitAuxSelection = hasExplicitAuxSelection
          ? resolveProviderSelectionByCategory(
              providers,
              activeAuxProviderId ?? activeProviderId,
              activeAuxModelId,
              'chat'
            )
          : { providerId: null, modelId: '' }
        const resolvedAuxSelection =
          explicitAuxSelection.providerId && explicitAuxSelection.modelId
            ? explicitAuxSelection
            : (resolveDefaultAuxSelection(providers) ??
              resolveProviderSelectionByCategory(
                providers,
                activeProviderId,
                activeModelId,
                'chat'
              ))
        if (!resolvedAuxSelection.providerId || !resolvedAuxSelection.modelId) return null
        const provider = providers.find((p) => p.id === resolvedAuxSelection.providerId)
        if (!provider) return null
        const model = resolvedAuxSelection.modelId
        const auxModel = provider.models.find((m) => m.id === model)

        // Image models should respect explicit protocol overrides (e.g. Gemini).
        // Fall back to OpenAI Images only when an image model has no explicit type.
        let requestType = auxModel?.type ?? provider.type
        if (auxModel?.category === 'image' && !auxModel?.type) {
          requestType = 'openai-images'
          log.debug(
            'Image model without explicit type in getAuxProviderConfig, routing to openai-images provider',
            {
              modelId: model,
              providerType: provider.type,
              finalType: requestType
            }
          )
        }

        const resolvedBaseUrl = provider.baseUrl
        const normalizedBaseUrl = resolvedBaseUrl
          ? normalizeProviderBaseUrl(resolvedBaseUrl, requestType)
          : undefined
        const requestOverrides = buildRequestOverrides(
          provider.requestOverrides,
          auxModel?.requestOverrides,
          auxModel?.id ?? model
        )
        const websocketUrl = auxModel?.websocketUrl ?? provider.websocketUrl
        const websocketMode = auxModel?.websocketMode ?? provider.websocketMode
        const serviceTier = resolveServiceTier(auxModel, provider.builtinId)
        const accountId = resolveProviderAccountId(provider)
        const responsesImageGeneration =
          requestType === 'openai-responses'
            ? normalizeResponsesImageGenerationConfig(auxModel?.responsesImageGeneration)
            : undefined
        return {
          type: requestType,
          apiKey: provider.apiKey,
          baseUrl: normalizedBaseUrl,
          model,
          providerId: provider.id,
          providerBuiltinId: provider.builtinId,
          computerUseEnabled: auxModel ? inferComputerUseEnabled(auxModel, provider.type) : false,
          ...(serviceTier ? { serviceTier } : {}),
          requiresApiKey: provider.requiresApiKey,
          ...(provider.allowInsecureTls !== undefined
            ? { allowInsecureTls: provider.allowInsecureTls }
            : {}),
          responseSummary: auxModel?.responseSummary,
          ...(responsesImageGeneration ? { responsesImageGeneration } : {}),
          enablePromptCache: auxModel?.enablePromptCache,
          enableSystemPromptCache: auxModel?.enableSystemPromptCache,
          ...(provider.userAgent ? { userAgent: provider.userAgent } : {}),
          ...(requestOverrides ? { requestOverrides } : {}),
          ...(provider.instructionsPrompt
            ? { instructionsPrompt: provider.instructionsPrompt }
            : {}),
          ...(accountId ? { accountId } : {}),
          ...(websocketUrl ? { websocketUrl } : {}),
          ...(websocketMode ? { websocketMode } : {}),
          ...(provider.supportsStreamOptions !== undefined
            ? { supportsStreamOptions: provider.supportsStreamOptions }
            : {}),
          ...(provider.supportsPromptCacheKey !== undefined
            ? { supportsPromptCacheKey: provider.supportsPromptCacheKey }
            : {}),
          ...(provider.supportsStrictSchemas !== undefined
            ? { supportsStrictSchemas: provider.supportsStrictSchemas }
            : {})
        }
      },

      getEffectiveMaxTokens: (userMaxTokens: number, modelId?: string) => {
        const { providers, activeProviderId, activeModelId } = get()
        const targetModelId = modelId ?? activeModelId
        if (!activeProviderId || !targetModelId) return userMaxTokens
        const provider = providers.find((p) => p.id === activeProviderId)
        if (!provider) return userMaxTokens
        const model = provider.models.find((m) => m.id === targetModelId)
        if (!model?.maxOutputTokens) return userMaxTokens
        return Math.min(userMaxTokens, model.maxOutputTokens)
      },

      getActiveModelMaxOutputTokens: (modelId?: string) => {
        const { providers, activeProviderId, activeModelId } = get()
        const targetModelId = modelId ?? activeModelId
        if (!activeProviderId || !targetModelId) return undefined
        const provider = providers.find((p) => p.id === activeProviderId)
        if (!provider) return undefined
        const model = provider.models.find((m) => m.id === targetModelId)
        return model?.maxOutputTokens
      },

      getActiveModelSupportsThinking: () => {
        const model = get().getActiveModelConfig()
        return model?.supportsThinking ?? false
      },

      getActiveModelThinkingConfig: () => {
        const model = get().getActiveModelConfig()
        return model?.thinkingConfig
      }
    }),
    {
      name: 'flint-providers',
      storage: createJSONStorage(() => configStorage),
      partialize: (state) => ({
        providers: state.providers,
        activeProviderId: state.activeProviderId,
        activeModelId: state.activeModelId,
        activeAuxProviderId: state.activeAuxProviderId,
        activeAuxModelId: state.activeAuxModelId,
        activeSpeechProviderId: state.activeSpeechProviderId,
        activeSpeechModelId: state.activeSpeechModelId,
        activeImageProviderId: state.activeImageProviderId,
        activeImageModelId: state.activeImageModelId
      })
    }
  )
)

/**
 * Sync provider-level fields and models from presets for already-added providers.
 * No longer auto-adds built-in presets — users must add them explicitly via the UI.
 */
function ensureBuiltinPresets(): void {
  const presets = getBuiltinPresets()
  for (const preset of presets) {
    const existing = useProviderStore
      .getState()
      .providers.find((p) => p.builtinId === preset.builtinId)

    if (!existing) continue

    // Sync provider-level fields from preset (e.g. requiresApiKey, userAgent, defaultModel)
    const patch: Partial<Omit<ModelProvider, 'id'>> = {}
    if (JSON.stringify(existing.name) !== JSON.stringify(preset.name)) {
      patch.name = { ...(preset.name as Record<string, string>) }
    }
    if (existing.requiresApiKey !== (preset.requiresApiKey ?? true)) {
      patch.requiresApiKey = preset.requiresApiKey ?? true
    }
    if (existing.userAgent !== preset.userAgent) {
      patch.userAgent = preset.userAgent
    }
    if (existing.websocketUrl !== preset.websocketUrl) {
      patch.websocketUrl = preset.websocketUrl
    }
    if (existing.websocketMode !== preset.websocketMode) {
      patch.websocketMode = preset.websocketMode
    }
    if (existing.supportsStreamOptions !== preset.supportsStreamOptions) {
      patch.supportsStreamOptions = preset.supportsStreamOptions
    }
    if (existing.supportsPromptCacheKey !== preset.supportsPromptCacheKey) {
      patch.supportsPromptCacheKey = preset.supportsPromptCacheKey
    }
    if (existing.supportsStrictSchemas !== preset.supportsStrictSchemas) {
      patch.supportsStrictSchemas = preset.supportsStrictSchemas
    }
    if (preset.instructionsPrompt && existing.instructionsPrompt !== preset.instructionsPrompt) {
      patch.instructionsPrompt = preset.instructionsPrompt
    }
    if (existing.authMode !== (preset.authMode ?? 'apiKey')) {
      patch.authMode = preset.authMode ?? 'apiKey'
    }
    
    if (preset.requestOverrides) {
      if (preset.builtinId === 'moonshot-coding') {
        patch.requestOverrides = { ...preset.requestOverrides }
      } else if (!existing.requestOverrides) {
        patch.requestOverrides = { ...preset.requestOverrides }
      }
    }
    if (preset.ui) {
      if (!existing.ui) {
        patch.ui = { ...preset.ui }
      }
    }
    const updatedModels = mergeBuiltinModels(existing.models, preset.defaultModels)
    const resolvedDefaultModel = preset.defaultModel
      ? (resolveModelIdByKey(updatedModels, preset.defaultModel) ?? preset.defaultModel)
      : undefined
    if (existing.defaultModel !== resolvedDefaultModel) {
      patch.defaultModel = resolvedDefaultModel
    }
    if (existing.type !== preset.type) {
      patch.type = preset.type
    }
    if (Object.keys(patch).length > 0) {
      useProviderStore.getState().updateProvider(existing.id, patch)
    }

    if (JSON.stringify(updatedModels) !== JSON.stringify(existing.models)) {
      useProviderStore.getState().setProviderModels(existing.id, updatedModels)
    }
  }

  if (!useProviderStore.getState().activeProviderId) {
    const providers = useProviderStore.getState().providers
    const firstAvailableProviderId = resolveFirstProviderIdByCategory(providers, 'chat')
    if (firstAvailableProviderId) {
      useProviderStore.getState().setActiveProvider(firstAvailableProviderId)
    }
  }

  const state = useProviderStore.getState()
  const defaultAuxSelection = resolveDefaultAuxSelection(state.providers)
  const shouldAdoptDefaultAuxSelection =
    Boolean(defaultAuxSelection) && !state.activeAuxProviderId && !state.activeAuxModelId
  const activeProvider = state.activeProviderId
    ? state.providers.find((provider) => provider.id === state.activeProviderId)
    : null
  if (activeProvider) {
    const nextChatModelId = resolveValidModelIdByCategory(
      activeProvider,
      state.activeModelId,
      'chat'
    )
    if (nextChatModelId && nextChatModelId !== state.activeModelId) {
      state.setActiveModel(nextChatModelId)
    }
  }

  const auxProviderId = shouldAdoptDefaultAuxSelection
    ? (defaultAuxSelection?.providerId ?? state.activeAuxProviderId ?? state.activeProviderId)
    : (state.activeAuxProviderId ?? state.activeProviderId)
  if (auxProviderId) {
    const auxProvider = state.providers.find((provider) => provider.id === auxProviderId)
    if (auxProvider) {
      if (shouldAdoptDefaultAuxSelection) {
        if (state.activeAuxProviderId !== auxProvider.id) {
          state.setActiveAuxProvider(auxProvider.id)
        }
        const preferredAuxModelId =
          defaultAuxSelection?.providerId === auxProvider.id
            ? defaultAuxSelection.modelId
            : resolveValidModelIdByCategory(auxProvider, '', 'chat')
        if (preferredAuxModelId && preferredAuxModelId !== state.activeAuxModelId) {
          state.setActiveAuxModel(preferredAuxModelId)
        }
      } else {
        if (!state.activeAuxProviderId && state.activeAuxModelId) {
          useProviderStore.setState({ activeAuxProviderId: auxProvider.id })
        }
        const nextAuxModelId = resolveValidModelIdByCategory(
          auxProvider,
          state.activeAuxModelId,
          'chat'
        )
        if (nextAuxModelId && nextAuxModelId !== state.activeAuxModelId) {
          state.setActiveAuxModel(nextAuxModelId)
        }
      }
    }
  }

  const imageProviderId =
    state.activeImageProviderId ?? resolveFirstProviderIdByCategory(state.providers, 'image')
  if (imageProviderId) {
    const imageProvider = state.providers.find((provider) => provider.id === imageProviderId)
    if (imageProvider) {
      if (state.activeImageProviderId !== imageProviderId) {
        state.setActiveImageProvider(imageProviderId)
      } else {
        const nextImageModelId = resolveValidModelIdByCategory(
          imageProvider,
          state.activeImageModelId,
          'image'
        )
        if (nextImageModelId && nextImageModelId !== state.activeImageModelId) {
          state.setActiveImageModel(nextImageModelId)
        }
      }
    }
  }

  if (state.activeSpeechProviderId) {
    const speechProvider = state.providers.find(
      (provider) => provider.id === state.activeSpeechProviderId
    )
    if (speechProvider) {
      const nextSpeechModelId = resolveValidModelIdByCategory(
        speechProvider,
        state.activeSpeechModelId,
        'speech'
      )
      if (nextSpeechModelId && nextSpeechModelId !== state.activeSpeechModelId) {
        state.setActiveSpeechModel(nextSpeechModelId)
      }
    }
  }
}

/**
 * Initialize provider store: load presets from Rust, ensure built-in presets exist.
 * Waits for TAURI_COMMANDS storage rehydration and preset loading before running.
 */
export async function initProviderStore(): Promise<void> {
  await loadBuiltinPresets()
  // If already rehydrated (e.g. sync storage), run immediately
  if (useProviderStore.persist.hasHydrated()) {
    ensureBuiltinPresets()
  }
  // Also register for when rehydration finishes (async TAURI_COMMANDS storage)
  useProviderStore.persist.onFinishHydration(() => {
    ensureBuiltinPresets()
  })
}
