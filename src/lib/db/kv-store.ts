/**
 * Lightweight key-value JSON file store.
 *
 * Patterned after json-store.ts: in-memory cache, debounced writes,
 * on-demand flush. Used by command-storage.ts and config-storage.ts
 * to replace the Rust settings/config persistence layer.
 */
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'

// Types

export interface JsonKvStore {
  init(): Promise<void>
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
  flush(): Promise<void>
}

// Factory

export function createJsonKvStore(fileName: string): JsonKvStore {
  let _cache: Record<string, unknown> | null = null
  let _initialized = false
  let _pendingWrite: ReturnType<typeof setTimeout> | null = null
  let _writeQueued = false
  const DEBOUNCE_MS = 300

  let _cachedHomeDir: string | null = null

  async function getHomeDir(): Promise<string> {
    if (!_cachedHomeDir) {
      _cachedHomeDir = await tauriCommands.invoke<string>(TAURI_COMMANDS.APP_HOMEDIR)
    }
    return _cachedHomeDir
  }

  async function filePath(): Promise<string> {
    return `${await getHomeDir()}/.flint/${fileName}`
  }

  async function load(): Promise<Record<string, unknown>> {
    if (_cache) return _cache
    try {
      const path = await filePath()
      const result = await tauriCommands.invoke<{ content: string }>(TAURI_COMMANDS.FS_READ_FILE, { path })
      _cache = JSON.parse(result?.content ?? '{}') as Record<string, unknown>
    } catch {
      _cache = {}
    }
    return _cache
  }

  function scheduleWrite(): void {
    if (_writeQueued) return
    _writeQueued = true
    if (_pendingWrite) clearTimeout(_pendingWrite)
    _pendingWrite = setTimeout(async () => {
      _pendingWrite = null
      _writeQueued = false
      try {
        const path = await filePath()
        await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, {
          path,
          content: JSON.stringify(_cache, null, 2)
        })
      } catch {
        // non-fatal
      }
    }, DEBOUNCE_MS)
  }

  const store: JsonKvStore = {
    async init(): Promise<void> {
      if (!_initialized) {
        await load()
        _initialized = true
      }
    },

    get(key: string): unknown {
      return _cache?.[key]
    },

    set(key: string, value: unknown): void {
      if (!_cache) _cache = {}
      _cache[key] = value
      scheduleWrite()
    },

    remove(key: string): void {
      if (!_cache) _cache = {}
      delete _cache[key]
      scheduleWrite()
    },

    async flush(): Promise<void> {
      if (_pendingWrite) {
        clearTimeout(_pendingWrite)
        _pendingWrite = null
        _writeQueued = false
      }
      try {
        const path = await filePath()
        await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, {
          path,
          content: JSON.stringify(_cache ?? {}, null, 2)
        })
      } catch {
        // non-fatal
      }
    }
  }

  return store
}
