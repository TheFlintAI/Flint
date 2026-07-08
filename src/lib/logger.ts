/**
 * Unified Logger — centralizes all frontend logging.
 *
 * Dev mode: all levels write to console + forward to Rust log file.
 * Production: debug/info/warn/error forwarded to Rust log file; trace stripped.
 *
 * Usage:
 *   const log = createLogger('MyModule')
 *   log.debug('state changed', { key: 'value' })
 *   log.warn('something unexpected', error)
 *   log.error('fatal', error)
 */

import { invoke } from '@tauri-apps/api/core'

const isDev = import.meta.env.DEV

export interface Logger {
  trace: (message: string, ...data: unknown[]) => void
  debug: (message: string, ...data: unknown[]) => void
  info: (message: string, ...data: unknown[]) => void
  warn: (message: string, ...data: unknown[]) => void
  error: (message: string, ...data: unknown[]) => void
}

function formatData(data: unknown[]): string {
  if (data.length === 0) return ''
  const parts = data.map((d) => {
    if (d instanceof Error) return d.stack || d.message
    if (typeof d === 'string') return d
    try {
      return JSON.stringify(d)
    } catch {
      return String(d)
    }
  })
  return ' ' + parts.join(' ')
}

function forwardToRust(level: string, tag: string, message: string, data: unknown[]): void {
  void invoke('invoke_app_command', {
    channel: 'log:write',
    args: [{ level, tag, message: message + formatData(data) }]
  })
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
        console.log(`[${tag}]`, message, ...data)
      }
      forwardToRust('debug', tag, message, data)
    },

    info(message: string, ...data: unknown[]) {
      if (isDev) {
        console.info(`[${tag}]`, message, ...data)
      }
      forwardToRust('info', tag, message, data)
    },

    warn(message: string, ...data: unknown[]) {
      if (isDev) {
        console.warn(`[${tag}]`, message, ...data)
      }
      forwardToRust('warn', tag, message, data)
    },

    error(message: string, ...data: unknown[]) {
      if (isDev) {
        console.error(`[${tag}]`, message, ...data)
      }
      forwardToRust('error', tag, message, data)
    },
  }
}
