import { refreshSkillTools } from './skill-tool'

let refreshPromise: Promise<void> | null = null

async function runDynamicToolCatalogRefresh(workspace?: string): Promise<void> {
  await refreshSkillTools(workspace)
}

export function refreshDynamicToolCatalog(workspace?: string): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = runDynamicToolCatalogRefresh(workspace).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}
