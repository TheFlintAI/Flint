let registrationPromise: Promise<void> | null = null
let registrationScheduled = false
import { createLogger } from '@/lib/logger'

const log = createLogger('Tools')

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
}

export function registerCoreToolsOnce(): Promise<void> {
  if (!registrationPromise) {
    registrationPromise = import('./index')
      .then(({ registerAllTools }) => registerAllTools())
      .catch((error) => {
        registrationPromise = null
        throw error
      })
  }
  return registrationPromise
}

export function scheduleCoreToolsRegistration(): void {
  if (registrationScheduled) return
  registrationScheduled = true

  const run = (): void => {
    registerCoreToolsOnce().catch((error) => {
      log.error('Failed to register core tools:', error)
    })
  }

  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(run, { timeout: 2000 })
    return
  }

  window.setTimeout(run, 250)
}
