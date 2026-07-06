import { useChatStore } from '@/stores/chat-store'
import { useSettingsStore, resolveReasoningEffortForModel } from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'
import { useUIStore } from '@/stores/ui-store'
import { type ActiveTeam } from '@/stores/team-store'
import { toast } from 'sonner'
import i18n from '@/locales'

import type { ProviderConfig, AIModelConfig, ToolDefinition } from '@/lib/api/types'
import { displayName } from '@/lib/localized-string'
import { estimateContextTokensForRequest } from '@/lib/agent/context-estimation'

// Provider / model resolution

export function findProviderModel(
  providerId: string | null | undefined,
  modelId: string | null | undefined
): { providerName?: string; modelName?: string; modelConfig: AIModelConfig | null } {
  if (!providerId || !modelId) {
    return { modelConfig: null }
  }

  const provider = useProviderStore.getState().providers.find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === modelId) ?? null

  return {
    providerName: provider ? displayName(provider.name) : undefined,
    modelName: model?.name ?? modelId,
    modelConfig: model
  }
}

export function buildProviderConfigWithRuntimeSettings(
  providerConfig: ProviderConfig | null,
  modelConfig: AIModelConfig | null,
  taskId: string,
  settings?: ReturnType<typeof useSettingsStore.getState>
): ProviderConfig | null {
  const resolvedSettings = settings ?? useSettingsStore.getState()
  if (!providerConfig) {
    return resolvedSettings.apiKey
      ? {
          type: resolvedSettings.provider,
          apiKey: resolvedSettings.apiKey,
          baseUrl: resolvedSettings.baseUrl || undefined,
          model: resolvedSettings.model,
          temperature: 0.7,
          systemPrompt: undefined,
          thinkingEnabled: false,
          reasoningEffort: resolvedSettings.reasoningEffort
        }
      : null
  }

  const effectiveMaxTokens = modelConfig?.maxOutputTokens
    ? modelConfig.maxOutputTokens
    : undefined
  const resolvedThinkingConfig = modelConfig?.thinkingConfig ?? providerConfig.thinkingConfig
  const thinkingEnabled = resolvedSettings.thinkingEnabled && !!resolvedThinkingConfig
  const reasoningEffort = resolveReasoningEffortForModel({
    reasoningEffort: resolvedSettings.reasoningEffort,
    reasoningEffortByModel: resolvedSettings.reasoningEffortByModel,
    providerId: providerConfig.providerId,
    modelId: modelConfig?.id ?? providerConfig.model,
    thinkingConfig: resolvedThinkingConfig
  })

  return {
    ...providerConfig,
    maxTokens: effectiveMaxTokens,
    temperature: 0.7,
    systemPrompt: undefined,
    thinkingEnabled,
    thinkingConfig: resolvedThinkingConfig,
    reasoningEffort,
    responseSummary: modelConfig?.responseSummary ?? providerConfig.responseSummary,
    responsesImageGeneration:
      modelConfig?.responsesImageGeneration ?? providerConfig.responsesImageGeneration,
    enablePromptCache: modelConfig?.enablePromptCache ?? providerConfig.enablePromptCache,
    enableSystemPromptCache:
      modelConfig?.enableSystemPromptCache ?? providerConfig.enableSystemPromptCache,
    supportsFunctionCalling: modelConfig?.supportsFunctionCalling,
    taskId
  }
}

export async function resolveMainRequestProvider(options: { taskId: string }): Promise<{
  providerConfig: ProviderConfig | null
  modelConfig: AIModelConfig | null
}> {
  const providerStore = useProviderStore.getState()
  const taskItem = useChatStore.getState().tasks.find((item) => item.id === options.taskId)

  let explicitProviderId: string | null = null
  let explicitModelId: string | null = null

  if (taskItem?.providerId && taskItem?.modelId) {
    explicitProviderId = taskItem.providerId
    explicitModelId = taskItem.modelId
  }

  if (explicitProviderId && explicitModelId) {
    const providerConfig = providerStore.getProviderConfigById(explicitProviderId, explicitModelId)
    return {
      providerConfig,
      modelConfig: findProviderModel(explicitProviderId, explicitModelId).modelConfig
    }
  }

  const providerConfig = providerStore.getActiveProviderConfig()
  return {
    providerConfig,
    modelConfig: findProviderModel(providerConfig?.providerId, providerConfig?.model).modelConfig
  }
}

export function estimateCurrentIterationContextTokens(args: {
  taskId: string
  assistantMessageId: string
  tools: ToolDefinition[]
  providerConfig: ProviderConfig
}): number {
  const taskItem = useChatStore.getState().tasks.find((item) => item.id === args.taskId)
  if (!taskItem) return 0

  const requestMessages =
    taskItem.messages.length > 0 &&
    taskItem.messages[taskItem.messages.length - 1]?.id === args.assistantMessageId
      ? taskItem.messages.slice(0, -1)
      : taskItem.messages

  return estimateContextTokensForRequest({
    messages: requestMessages,
    tools: args.tools,
    providerConfig: args.providerConfig
  })
}

// Auth preflight

export async function checkProviderAuth(
  providerConfig: ProviderConfig,
  providerStore: ReturnType<typeof useProviderStore.getState>,
  uiStore: ReturnType<typeof useUIStore.getState>
): Promise<boolean> {
  if (!providerConfig.providerId) return true

  const provider = providerStore.providers.find(
    (item) => item.id === providerConfig.providerId
  )
  if (provider?.apiKey) return true
  const authHint = i18n.t('chat:errors.configureApiKey')
  toast.error(i18n.t('chat:errors.authenticationRequired'), {
    description: authHint,
    action: {
      label: i18n.t('chat:errors.openSettings'),
      onClick: () => uiStore.openSettingsPage('provider')
    }
  })
  return false
}

// Team context

export function summarizeActiveTeamForPromptCache(activeTeam: ActiveTeam | null | undefined): {
  name: string
  permissionMode?: string
  members: string[]
} | null {
  if (!activeTeam) return null
  return {
    name: activeTeam.name,
    permissionMode: activeTeam.permissionMode,
    members: activeTeam.members.map((member) => member.name)
  }
}
