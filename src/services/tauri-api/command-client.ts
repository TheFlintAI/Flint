import { invoke as invokeTauriCommand } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { TauriCommandClient } from '@/lib/tools/tool-types'
import { handleNonNativeCommand, isNonNativeCommand } from './command-router'

type Listener = (...args: unknown[]) => void

type ListenerRecord = {
  callback: Listener
  unlisten: Promise<UnlistenFn>
}

const listeners = new Map<string, ListenerRecord[]>()

function normalizeArgs(args: unknown[]): unknown[] {
  return args.length === 1 ? [args[0]] : args
}

class TauriCommandClientImpl implements TauriCommandClient {
  async invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    // Route non-native commands to TypeScript handlers instead of Rust
    if (isNonNativeCommand(channel)) {
      return handleNonNativeCommand(channel, normalizeArgs(args)) as Promise<T>
    }
    return invokeTauriCommand<T>('invoke_app_command', {
      channel,
      args: normalizeArgs(args)
    })
  }

  send(channel: string, ...args: unknown[]): void {
    void invokeTauriCommand('emit_app_command', {
      channel,
      args: normalizeArgs(args)
    })
  }

  on<T = unknown>(channel: string, callback: (...args: T[]) => void): () => void {
    const unlisten = listen(`command:${channel}`, (event) => {
      callback(event.payload as T)
    })
    const records = listeners.get(channel) ?? []
    records.push({ callback: callback as Listener, unlisten })
    listeners.set(channel, records)

    return () => {
      this.removeListener(channel, callback)
    }
  }

  removeListener<T = unknown>(channel: string, callback: (...args: T[]) => void): void {
    const records = listeners.get(channel) ?? []
    const remaining: ListenerRecord[] = []
    for (const record of records) {
      if (record.callback === (callback as Listener)) {
        void record.unlisten.then((dispose) => dispose())
      } else {
        remaining.push(record)
      }
    }

    if (remaining.length > 0) {
      listeners.set(channel, remaining)
    } else {
      listeners.delete(channel)
    }
  }

  removeAllListeners(channel: string): void {
    const records = listeners.get(channel) ?? []
    for (const record of records) {
      void record.unlisten.then((dispose) => dispose())
    }
    listeners.delete(channel)
  }

  once<T = unknown>(channel: string, callback: (...args: T[]) => void): () => void {
    const unsubscribe = this.on<T>(channel, (...args) => {
      unsubscribe()
      callback(...args)
    })
    return () => {
      this.removeListener(channel, callback)
    }
  }
}

export const tauriCommands = new TauriCommandClientImpl()
