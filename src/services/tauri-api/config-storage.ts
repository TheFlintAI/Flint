import type { StateStorage } from 'zustand/middleware'
import { createJsonKvStore } from '@/lib/db/kv-store'

/**
 * Zustand StateStorage backed by ~/.flint/config.json via kv-store.
 * Replaces the Rust config:get/config:set round-trip.
 */
const configKvStore = createJsonKvStore('config.json')

export const configStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    await configKvStore.init()
    const value = configKvStore.get(name)
    if (value === undefined || value === null) return null
    return typeof value === 'string' ? value : JSON.stringify(value)
  },

  setItem: async (name: string, value: string): Promise<void> => {
    await configKvStore.init()
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = value
    }
    configKvStore.set(name, parsed)
  },

  removeItem: async (name: string): Promise<void> => {
    await configKvStore.init()
    configKvStore.remove(name)
  }
}
