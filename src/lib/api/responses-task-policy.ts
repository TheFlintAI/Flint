import type { ProviderConfig } from './types'

export const RESPONSES_TASK_SCOPE_MAIN = 'main'
export const RESPONSES_TASK_SCOPE_AGENT_MAIN = 'agent-main'
export const RESPONSES_TASK_SCOPE_CONTEXT_COMPRESSION = 'context-compression'
export const RESPONSES_TASK_SCOPE_GENERATE_TITLE = 'generate-title'
export const RESPONSES_TASK_SCOPE_AUTO_MODEL_ROUTING = 'auto-model-routing'

export function withResponsesTaskScope(config: ProviderConfig, scope: string): ProviderConfig {
  if (config.type !== 'openai-responses') {
    return config
  }

  return {
    ...config,
    responsesTaskScope: scope
  }
}

export function withAuxiliaryResponsesRequestPolicy(
  config: ProviderConfig,
  scope: string
): ProviderConfig {
  if (config.type !== 'openai-responses') {
    return config
  }

  return {
    ...config,
    responsesTaskScope: scope,
    websocketMode: 'disabled'
  }
}
