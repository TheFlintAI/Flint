import { createLogger } from '@/lib/logger'
import type { ToolModule } from './tool-module'

const log = createLogger('Tools')

let _allToolsRegistered = false
let _dynamicCatalogWarmupStarted = false

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
}

const TOOL_LOADERS: Record<string, () => Promise<ToolModule>> = {
  todo:      () => import('./todo-tool').then(m => m.todoToolModule),
  fs:        () => import('./fs-tool').then(m => m.fsToolModule),
  search:    () => import('./search-tool').then(m => m.searchToolModule),
  bash:      () => import('./bash-tool').then(m => m.bashToolModule),
  webSearch: () => import('./web-search').then(m => m.webSearchToolModule),
  askUser:   () => import('./ask-user-tool').then(m => m.askUserToolModule),
  memory:    () => import('./memory-tool').then(m => m.memoryToolModule),
}

const TEAM_TOOL_LOADER = (): Promise<ToolModule> =>
  import('../agent/teams/register').then(m => m.teamToolsModule)

function scheduleTeamToolsRegistration(): void {
  const idleWindow = window as IdleWindow
  const run = (): void => {
    TEAM_TOOL_LOADER()
      .then(m => m.register())
      .catch((err) => log.error('Failed to register team tools:', err))
  }
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(run, { timeout: 3000 })
  } else {
    window.setTimeout(run, 500)
  }
}

function scheduleDynamicToolCatalogWarmup(): void {
  if (_dynamicCatalogWarmupStarted) return
  _dynamicCatalogWarmupStarted = true

  const run = (): void => {
    import('./dynamic-tool-catalog')
      .then(({ refreshDynamicToolCatalog }) => refreshDynamicToolCatalog())
      .catch((err) => log.error('Failed to warm dynamic tool catalog:', err))
  }

  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(run, { timeout: 2000 })
    return
  }

  window.setTimeout(run, 250)
}

export async function registerAllTools(): Promise<void> {
  if (_allToolsRegistered) return
  _allToolsRegistered = true

  // Register core tools concurrently via dynamic imports
  const modules = await Promise.all(
    Object.values(TOOL_LOADERS).map(loader =>
      loader().catch((err) => {
        log.error('Failed to load tool module:', err)
        return null
      })
    )
  )
  for (const mod of modules) {
    if (mod) mod.register()
  }

  // Defer team tools to next idle callback
  scheduleTeamToolsRegistration()

  // Warm dynamic tool catalogs after first paint
  scheduleDynamicToolCatalogWarmup()
}

export { refreshDynamicToolCatalog } from './dynamic-tool-catalog'
