import type { StateStorage } from 'zustand/middleware'
import { createJsonKvStore } from '@/lib/db/kv-store'

/**
 * Zustand StateStorage backed by ~/.flint/settings.json via kv-store.
 * Replaces the Rust settings:get/settings:set round-trip.
 */
export const settingsKvStore = createJsonKvStore('settings.json')

export const commandStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    await settingsKvStore.init()
    const value = settingsKvStore.get(name)
    if (value === undefined || value === null) return null
    return typeof value === 'string' ? value : JSON.stringify(value)
  },

  setItem: async (name: string, value: string): Promise<void> => {
    await settingsKvStore.init()
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = value
    }
    settingsKvStore.set(name, parsed)
  },

  removeItem: async (name: string): Promise<void> => {
    await settingsKvStore.init()
    settingsKvStore.remove(name)
  }
}
