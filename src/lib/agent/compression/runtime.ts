import type { AIModelConfig, ProviderConfig, UnifiedMessage } from '../../api/types'
import { useProviderStore } from '@/stores/provider-store'
import { compressMessages } from './compress'
import {
  resolveCompressionContextLength,
  resolveCompressionReservedOutput,
  resolveCompressionThreshold,
  type CompressionConfig,
} from './threshold'
import type { AgentLoopConfig } from '../types'

function findModelConfig(providerConfig: ProviderConfig): AIModelConfig | null {
  const { providers } = useProviderStore.getState()

  if (providerConfig.providerId) {
    const provider = providers.find((item) => item.id === providerConfig.providerId)
    const model = provider?.models.find((item) => item.id === providerConfig.model)
    if (model) return model
  }

  for (const provider of providers) {
    const model = provider.models.find((item) => item.id === providerConfig.model)
    if (model) return model
  }

  return null
}

export function buildRuntimeCompressionConfig(
  providerConfig: ProviderConfig,
): CompressionConfig | null {
  const modelConfig = findModelConfig(providerConfig)
  if (!modelConfig?.contextLength) return null

  const contextLength = resolveCompressionContextLength(modelConfig)
  if (!contextLength || contextLength <= 0) return null

  return {
    enabled: true,
    contextLength,
    threshold: resolveCompressionThreshold(modelConfig),
    preCompressThreshold: 0.65,
    reservedOutputBudget: resolveCompressionReservedOutput(modelConfig),
  }
}

export function buildRuntimeCompression(
  providerConfig: ProviderConfig,
  signal: AbortSignal,
): AgentLoopConfig['contextCompression'] | undefined {
  const config = buildRuntimeCompressionConfig(providerConfig)
  if (!config) return undefined

  return {
    config,
    compressFn: async (messages: UnifiedMessage[]) => {
      const { messages: compressed } = await compressMessages(messages, providerConfig, signal)
      return compressed
    },
  }
}
