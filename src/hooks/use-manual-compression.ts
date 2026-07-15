import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { nanoid } from 'nanoid'
import { useChatStore } from '@/stores/chat-store'
import { useAgentStore } from '@/stores/agent-store'
import { useProviderStore } from '@/stores/provider-store'
import { useSettingsStore, resolveReasoningEffortForModel } from '@/stores/settings-store'
import {
  compressMessages,
} from '@/lib/agent/compression'
import type { ProviderConfig, UnifiedMessage } from '@/lib/api/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('ManualCompression')

export type ManualCompressionResult = 'compressed' | 'skipped' | 'blocked' | 'failed'

export function useManualCompression(): (
  focusPrompt?: string
) => Promise<ManualCompressionResult> {
  const { t } = useTranslation('chat')
  const manualCompressContext = useCallback(async (focusPrompt?: string) => {
    const chatStore = useChatStore.getState()
    const agentStore = useAgentStore.getState()
    const taskId = chatStore.activeTaskId
    if (!taskId) {
      toast.error(t('compression.cannotCompress'), { description: t('compression.noActiveTask') })
      return 'blocked'
    }

    const taskStatus = agentStore.runningTasks[taskId]
    if (taskStatus === 'running' || taskStatus === 'retrying') {
      toast.error(t('compression.cannotCompress'), {
        description: t('compression.agentRunning')
      })
      return 'blocked'
    }

    const allMessages = await chatStore.getTaskMessagesForRequest(taskId, {
      requestContextMaxMessages: null,
      includeTrailingAssistantPlaceholder: false
    })

    // Snapshot original messages for rollback on failure
    const originalMessages = chatStore.tasks.find((s) => s.id === taskId)?.messages ?? allMessages

    // Build provider config
    const settings = useSettingsStore.getState()
    const providerStore = useProviderStore.getState()
    const activeProvider = providerStore.getActiveProvider()
    if (activeProvider && !activeProvider.apiKey) {
      toast.error(t('compression.authMissing'), {
        description: t('compression.configureApiKey')
      })
      return 'blocked'
    }

    const providerConfig = providerStore.getActiveProviderConfig()
    const activeModelConfig = providerStore.getActiveModelConfig()
    const effectiveMaxTokens = activeModelConfig?.maxOutputTokens ?? undefined
    const activeModelThinkingConfig = activeModelConfig?.thinkingConfig
    const thinkingEnabled = settings.thinkingEnabled && !!activeModelThinkingConfig
    const reasoningEffort = resolveReasoningEffortForModel({
      reasoningEffort: settings.reasoningEffort,
      reasoningEffortByModel: settings.reasoningEffortByModel,
      providerId: providerConfig?.providerId,
      modelId: activeModelConfig?.id ?? providerConfig?.model,
      thinkingConfig: activeModelThinkingConfig
    })

    const config: ProviderConfig | null = providerConfig
      ? {
          ...providerConfig,
          maxTokens: effectiveMaxTokens,
          temperature: 0.7,
          systemPrompt: undefined,
          thinkingEnabled,
          thinkingConfig: activeModelThinkingConfig,
          reasoningEffort
        }
      : null

    if (!config) {
      toast.error('Cannot compress', { description: 'AI provider not configured' })
      return 'blocked'
    }

    // Override with task-bound provider if available
    const compressTask = chatStore.tasks.find((s) => s.id === taskId)
    if (compressTask?.providerId && compressTask?.modelId) {
      const taskProvider = providerStore.providers.find(p => p.id === compressTask.providerId)
      if (!taskProvider?.apiKey) {
        toast.error('Authentication missing', {
          description: 'Please configure API key in Settings'
        })
        return 'blocked'
      }
      const taskProviderConfig = providerStore.getProviderConfigById(
        compressTask.providerId,
        compressTask.modelId
      )
      if (taskProviderConfig?.apiKey) {
        config.type = taskProviderConfig.type
        config.apiKey = taskProviderConfig.apiKey
        config.baseUrl = taskProviderConfig.baseUrl
        config.model = taskProviderConfig.model
      }
    }

    // Create a streaming placeholder message
    const placeholderId = nanoid()
    const placeholder: UnifiedMessage = {
      id: placeholderId,
      role: 'user',
      content: '',
      createdAt: Date.now(),
      meta: {
        compression: {
          trigger: 'manual',
          messagesCompressed: allMessages.length,
        }
      }
    }

    // Insert placeholder so the UI shows the streaming panel
    chatStore.addMessage(taskId, placeholder)

    let streamingContent = ''

    try {
      const { messages: compressed, result } = await compressMessages(
        allMessages,
        config,
        undefined,
        focusPrompt || undefined,
        undefined,
        'manual',
        0,
        (chunk: string) => {
          streamingContent += chunk
          chatStore.updateMessage(taskId, placeholderId, { content: streamingContent })
        }
      )

      if (!result.compressed) {
        // Restore original messages, removing the placeholder
        chatStore.replaceTaskMessages(taskId, originalMessages)
        toast.warning('No compression needed', {
          description: 'Current message count insufficient for effective compression'
        })
        return 'skipped'
      }

      // Replace all messages with the compression result (immediate, no animation delay)
      chatStore.replaceTaskMessages(taskId, compressed)
      return 'compressed'
    } catch (err) {
      // Rollback to original messages on failure
      chatStore.replaceTaskMessages(taskId, originalMessages)
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error('Manual compress error', err)
      toast.error(t('compression.failed'), { description: errMsg })
      return 'failed'
    }
  }, [t])

  return manualCompressContext
}
