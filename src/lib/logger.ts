/**
 * Unified Logger — centralizes all frontend logging with compile-time DCE.
 *
 * - `debug()` / `info()` → removed in production via `import.meta.env.DEV` guard
 * - `warn()` / `error()` → always active
 * - Messages are tagged `[Tag]` for filtering in DevTools
 *
 * Usage:
 *   const log = createLogger('MyModule')
 *   log.debug('state changed', { key: 'value' })
 *   log.warn('something unexpected', error)
 *   log.error('fatal', error)
 */

const isDev = import.meta.env.DEV

export interface Logger {
  /** Trace-level log with stack trace — stripped in production builds */
  trace: (message: string, ...data: unknown[]) => void
  /** Debug-level log — stripped in production builds */
  debug: (message: string, ...data: unknown[]) => void
  /** Info-level log — stripped in production builds */
  info: (message: string, ...data: unknown[]) => void
  /** Warning — always active */
  warn: (message: string, ...data: unknown[]) => void
  /** Error — always active */
  error: (message: string, ...data: unknown[]) => void
}

export function createLogger(tag: string): Logger {
  return {
    trace(message: string, ...data: unknown[]) {
      if (isDev) {
        console.trace(`[${tag}]`, message, ...data)
      }
    },

    debug(message: string, ...data: unknown[]) {
      if (isDev) {
        // Use console.log instead of console.debug so messages are visible
        // by default in DevTools (debug level is hidden under "Verbose")
        console.log(`[${tag}]`, message, ...data)
      }
    },

    info(message: string, ...data: unknown[]) {
      if (isDev) {
        console.info(`[${tag}]`, message, ...data)
      }
    },

    warn(message: string, ...data: unknown[]) {
      console.warn(`[${tag}]`, message, ...data)
    },

    error(message: string, ...data: unknown[]) {
      console.error(`[${tag}]`, message, ...data)
    },
  }
}
