import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ProviderType, ReasoningEffortLevel, ThinkingConfig } from '../lib/api/types'
import { commandStorage } from '@/services/tauri-api/command-storage'
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  clampLeftSidebarWidth
} from '@/components/layout/panel-constants'

export type ShellExecutionEndpoint =
  | 'auto'
  | 'zsh'
  | 'bash'
  | 'sh'
  | 'powershell'
  | 'pwsh'
  | 'cmd'
  | 'custom'
const DEFAULT_SHELL_EXECUTION_ENDPOINT: ShellExecutionEndpoint = 'auto'

export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 8

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSystemLanguage(): 'en' | 'zh' {
  const lang = navigator.language || navigator.languages?.[0] || 'en'
  return lang.startsWith('zh') ? 'zh' : 'en'
}

function normalizeShellExecutionEndpoint(value: unknown): ShellExecutionEndpoint {
  if (
    value === 'auto' ||
    value === 'zsh' ||
    value === 'bash' ||
    value === 'sh' ||
    value === 'powershell' ||
    value === 'pwsh' ||
    value === 'cmd' ||
    value === 'custom'
  ) {
    return value
  }
  return DEFAULT_SHELL_EXECUTION_ENDPOINT
}

export function resolveShellExecutable({
  endpoint,
  customShellExecutable,
  platform
}: {
  endpoint: ShellExecutionEndpoint
  customShellExecutable?: string | null
  platform?: string | null
}): string | undefined {
  const normalizedEndpoint = normalizeShellExecutionEndpoint(endpoint)
  if (normalizedEndpoint === 'auto') return undefined
  if (normalizedEndpoint === 'custom') {
    const custom = customShellExecutable?.trim()
    return custom || undefined
  }

  const normalizedPlatform = platform?.trim().toLowerCase()
  if (normalizedPlatform === 'win32') {
    if (normalizedEndpoint === 'powershell') return 'powershell.exe'
    if (normalizedEndpoint === 'pwsh') return 'pwsh.exe'
    if (normalizedEndpoint === 'cmd') return 'cmd.exe'
    return undefined
  }

  if (normalizedEndpoint === 'zsh') return '/bin/zsh'
  if (normalizedEndpoint === 'bash') return '/bin/bash'
  if (normalizedEndpoint === 'sh') return '/bin/sh'
  return undefined
}

function getReasoningEffortKey(
  providerId?: string | null,
  modelId?: string | null
): string | null {
  if (!providerId || !modelId) return null
  return `${providerId}:${modelId}`
}

export function resolveReasoningEffortForModel({
  reasoningEffort,
  reasoningEffortByModel,
  providerId,
  modelId,
  thinkingConfig
}: {
  reasoningEffort: ReasoningEffortLevel
  reasoningEffortByModel?: Record<string, ReasoningEffortLevel>
  providerId?: string | null
  modelId?: string | null
  thinkingConfig?: ThinkingConfig
}): ReasoningEffortLevel {
  const key = getReasoningEffortKey(providerId, modelId)
  const levels = thinkingConfig?.reasoningEffortLevels
  const savedEffort = key ? reasoningEffortByModel?.[key] : undefined

  if (savedEffort && (!levels || levels.includes(savedEffort))) {
    return savedEffort
  }

  return thinkingConfig?.defaultReasoningEffort ?? reasoningEffort
}

interface SettingsStore {
  provider: ProviderType
  apiKey: string
  baseUrl: string
  model: string
  language: 'en' | 'zh'
  thinkingEnabled: boolean
  fastModeEnabled: boolean
  reasoningEffort: ReasoningEffortLevel
  reasoningEffortByModel: Record<string, ReasoningEffortLevel>
  shellExecutionEndpoint: ShellExecutionEndpoint
  customShellExecutable: string
  memoryUseMemories: boolean

  leftSidebarWidth: number

  updateSettings: (patch: Partial<SettingsStoreData>) => void
}

type SettingsStoreData = Omit<SettingsStore, 'updateSettings'>

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: 'claude-sonnet-4-20250514',
      language: getSystemLanguage(),
      thinkingEnabled: true,
      fastModeEnabled: false,
      reasoningEffort: 'medium',
      reasoningEffortByModel: {},
      shellExecutionEndpoint: DEFAULT_SHELL_EXECUTION_ENDPOINT,
      customShellExecutable: '',
      memoryUseMemories: true,

      leftSidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,

      updateSettings: (patch) => set({ ...patch })
    }),
    {
      name: 'flint-settings',
      storage: createJSONStorage(() => commandStorage),
      partialize: (state) => ({
        provider: state.provider,
        baseUrl: state.baseUrl,
        model: state.model,
        language: state.language,
        thinkingEnabled: state.thinkingEnabled,
        fastModeEnabled: state.fastModeEnabled,
        reasoningEffort: state.reasoningEffort,
        reasoningEffortByModel: state.reasoningEffortByModel,
        shellExecutionEndpoint: normalizeShellExecutionEndpoint(state.shellExecutionEndpoint),
        customShellExecutable: state.customShellExecutable,
        memoryUseMemories: state.memoryUseMemories,
        leftSidebarWidth: clampLeftSidebarWidth(state.leftSidebarWidth),
        // NOTE: apiKey is intentionally excluded from localStorage persistence.
        // In production, it should be stored securely by the native backend.
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(isPlainObject(persisted) ? persisted : {}),
      })
    }
  )
)
