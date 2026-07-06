import { refreshAgentTools } from '../agent/teams/agent-catalog'
import { refreshSkillTools } from './skill-tool'

let refreshPromise: Promise<void> | null = null

async function runDynamicToolCatalogRefresh(): Promise<void> {
  await refreshSkillTools()
  await refreshAgentTools()
}

export function refreshDynamicToolCatalog(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = runDynamicToolCatalogRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}
