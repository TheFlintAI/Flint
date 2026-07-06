// Vector Memory Client
// Thin wrapper around tauriCommands.invoke('memory:*') channels.
// Backend (src-tauri/src/memory/) handles SQLite storage, cosine search,
// and optional local embedding via fastembed.
// Vectors can be passed directly (from provider API) or let the backend
// generate them locally.

import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import type { TauriCommandClient } from '@/lib/tools/tool-types'
import type {
  MemoryEntry,
  MemoryEntryFilter,
  MemoryIndexSnapshot,
  MemorySearchResult,
  MemoryStats,
} from '@/protocols/memory-types'

// Index

export async function loadMemoryIndex(
  commands: TauriCommandClient,
): Promise<MemoryIndexSnapshot> {
  const result = await commands.invoke<MemoryIndexSnapshot>(TAURI_COMMANDS.MEMORY_LIST, {})
  return result
}

// Entry CRUD

export async function loadMemoryEntry(
  commands: TauriCommandClient,
  entryId: string,
): Promise<MemoryEntry | null> {
  try {
    return await commands.invoke<MemoryEntry>(TAURI_COMMANDS.MEMORY_READ, { id: entryId })
  } catch {
    return null
  }
}

export async function loadAllMemoryEntries(
  commands: TauriCommandClient,
  filters?: MemoryEntryFilter,
): Promise<MemoryEntry[]> {
  // Load all entries by getting the index then loading each entry
  const snapshot = await loadMemoryIndex(commands)
  const entries = await Promise.all(
    snapshot.entries.map((ie) => loadMemoryEntry(commands, ie.id)),
  )
  const results = entries.filter(Boolean) as MemoryEntry[]

  // Apply client-side filters (for UI display)
  let filtered = results
  if (filters?.type) {
    filtered = filtered.filter((e) => e.type === filters.type)
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter(
      (e) =>
        e.body.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    )
  }
  if (filters?.updatedSince) {
    filtered = filtered.filter((e) => e.updated_at >= filters.updatedSince!)
  }

  return filtered
}

// Search

export async function searchMemoryEntries(
  commands: TauriCommandClient,
  params: {
    query?: string
    vector?: number[]
    limit?: number
    type?: string
  },
): Promise<MemorySearchResult[]> {
  return commands.invoke<MemorySearchResult[]>(TAURI_COMMANDS.MEMORY_SEARCH, {
    query: params.query,
    vector: params.vector,
    limit: params.limit ?? 20,
    type: params.type,
  })
}

// Write / Delete

export async function writeMemoryEntry(
  commands: TauriCommandClient,
  params: {
    id?: string
    type?: string
    body: string
    vector?: number[]
  },
): Promise<MemoryEntry> {
  return commands.invoke<MemoryEntry>(TAURI_COMMANDS.MEMORY_WRITE, params)
}

export async function deleteMemoryEntry(
  commands: TauriCommandClient,
  entryId: string,
): Promise<boolean> {
  const result = await commands.invoke<{ success: boolean; id: string }>(
    TAURI_COMMANDS.MEMORY_DELETE,
    { id: entryId },
  )
  return result.success
}

// Stats / Maintenance

export async function loadMemoryStats(
  commands: TauriCommandClient,
): Promise<MemoryStats> {
  return commands.invoke<MemoryStats>(TAURI_COMMANDS.MEMORY_STATS)
}

export async function rebuildMemoryIndex(
  commands: TauriCommandClient,
): Promise<MemoryStats> {
  return commands.invoke<MemoryStats>(TAURI_COMMANDS.MEMORY_REBUILD_INDEX)
}
