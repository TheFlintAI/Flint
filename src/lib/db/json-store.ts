/**
 * Pure TypeScript JSON file store — replaces the Rust db.rs layer.
 *
 * All data lives in a single db.json file at ~/.flint/db.json.
 * The frontend Zustand stores already hold the authoritative in-memory state;
 * this module handles persistence using Tauri fs:* commands.
 *
 * The Rust db.rs (~1200 lines) performs JSON CRUD with an in-memory Value tree
 * and locks via std::sync::Mutex. Since Tauri runs the webview on a single
 * thread, we can safely replace the Mutex with a simple async queue.
 */
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'

// Types

type JsonRow = Record<string, unknown>
type JsonTable = JsonRow[]

interface DbSchema {
  tasks: JsonTable
  messages: JsonTable
  plans: JsonTable
  agent_change_sets: JsonTable
  agent_file_changes: JsonTable
  [key: string]: JsonTable
}

// State

let _db: DbSchema | null = null
let _pendingWrite: ReturnType<typeof setTimeout> | null = null
let _writeQueued = false
const DEBOUNCE_MS = 300

// File paths

let _cachedHomeDir: string | null = null

async function getHomeDir(): Promise<string> {
  if (!_cachedHomeDir) {
    _cachedHomeDir = await tauriCommands.invoke<string>(TAURI_COMMANDS.APP_HOMEDIR)
  }
  return _cachedHomeDir
}

async function dbPath(): Promise<string> {
  return `${await getHomeDir()}/.flint/db.json`
}

// Load / Save

async function loadDb(): Promise<DbSchema> {
  if (_db) return _db
  try {
    const path = await dbPath()
    const result = await tauriCommands.invoke<{ content: string }>(TAURI_COMMANDS.FS_READ_FILE, { path })
    _db = JSON.parse(result?.content ?? '{}') as DbSchema
  } catch {
    _db = {} as DbSchema
  }
  return _db!
}

function scheduleWrite(): void {
  if (_writeQueued) return
  _writeQueued = true
  if (_pendingWrite) clearTimeout(_pendingWrite)
  _pendingWrite = setTimeout(async () => {
    _pendingWrite = null
    _writeQueued = false
    try {
      const path = await dbPath()
      await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, {
        path,
        content: JSON.stringify(_db, null, 2)
      })
    } catch {
      // Persistence failures are non-fatal; state stays in memory
    }
  }, DEBOUNCE_MS)
}

export async function flushDb(): Promise<void> {
  if (_pendingWrite) {
    clearTimeout(_pendingWrite)
    _pendingWrite = null
    _writeQueued = false
  }
  try {
    const path = await dbPath()
    await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, {
      path,
      content: JSON.stringify(_db, null, 2)
    })
  } catch {
    // non-fatal
  }
}

// Table helpers

function ensureTable(name: string): JsonTable {
  if (!_db![name] || !Array.isArray(_db![name])) {
    _db![name] = []
  }
  return _db![name]
}

function now(): number {
  return Date.now()
}

function rowId(row: JsonRow): string | undefined {
  const id = row.id ?? row.Id ?? row.ID
  return typeof id === 'string' ? id : undefined
}

function findRow(table: JsonTable, id: string): JsonRow | undefined {
  return table.find(r => rowId(r) === id)
}

function normalizeRow(row: JsonRow): JsonRow {
  // Convert camelCase keys to snake_case for DB storage consistency
  const out: JsonRow = {}
  for (const [key, value] of Object.entries(row)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    out[snakeKey] = value
  }
  return out
}

// Public API

/** Initialize and load the database. Call once on app startup. */
export async function initDb(): Promise<void> {
  await loadDb()
}

/** Force flush pending writes. Call before app close. */
export async function closeDb(): Promise<void> {
  await flushDb()
  _db = null
}

// Generic CRUD

export async function listTable(tableName: string): Promise<JsonRow[]> {
  await loadDb()
  const rows = [...ensureTable(tableName)]
  // Sort by updated_at desc, created_at desc
  rows.sort((a, b) => {
    const au = (a.updated_at as number) ?? 0
    const bu = (b.updated_at as number) ?? 0
    if (au !== bu) return bu - au
    const ac = (a.created_at as number) ?? 0
    const bc = (b.created_at as number) ?? 0
    return bc - ac
  })
  return rows
}

export async function createRow(tableName: string, row: JsonRow): Promise<JsonRow> {
  await loadDb()
  const table = ensureTable(tableName)
  const ts = now()
  const normalized = normalizeRow(row)
  normalized.id = normalized.id ?? `${tableName}-${ts}`
  normalized.created_at = normalized.created_at ?? ts
  normalized.updated_at = normalized.updated_at ?? ts
  table.push(normalized)
  scheduleWrite()
  return normalized
}

export async function updateRow(tableName: string, id: string, patch: JsonRow): Promise<JsonRow | null> {
  await loadDb()
  const table = ensureTable(tableName)
  const row = findRow(table, id)
  if (!row) return null
  const normalizedPatch = normalizeRow(patch)
  normalizedPatch.updated_at = now()
  Object.assign(row, normalizedPatch)
  scheduleWrite()
  return row
}

export async function deleteRow(tableName: string, id: string): Promise<boolean> {
  await loadDb()
  const table = ensureTable(tableName)
  const idx = table.findIndex(r => rowId(r) === id)
  if (idx === -1) return false
  table.splice(idx, 1)
  scheduleWrite()
  return true
}

export async function upsertRow(tableName: string, row: JsonRow): Promise<JsonRow> {
  await loadDb()
  const table = ensureTable(tableName)
  const normalized = normalizeRow(row)
  const id = rowId(normalized)
  const ts = now()
  normalized.updated_at = ts
  if (!normalized.created_at) normalized.created_at = ts

  if (id) {
    const existing = findRow(table, id)
    if (existing) {
      Object.assign(existing, normalized)
      scheduleWrite()
      return existing
    }
  }
  normalized.id = normalized.id ?? `${tableName}-${ts}`
  table.push(normalized)
  scheduleWrite()
  return normalized
}

export async function deleteByField(tableName: string, field: string, value: string): Promise<number> {
  await loadDb()
  const table = ensureTable(tableName)
  const before = table.length
  const snakeField = field.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
  const newTable = table.filter(r => r[snakeField] !== value && r[field] !== value)
  _db![tableName] = newTable
  scheduleWrite()
  return before - newTable.length
}

export async function listByField(tableName: string, field: string, value: string): Promise<JsonRow[]> {
  await loadDb()
  const table = ensureTable(tableName)
  const snakeField = field.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
  return table.filter(r => r[snakeField] === value || r[field] === value)
}

export async function getByField(tableName: string, field: string, value: string): Promise<JsonRow | null> {
  await loadDb()
  const table = ensureTable(tableName)
  const snakeField = field.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
  return table.find(r => r[snakeField] === value || r[field] === value) ?? null
}

// Explicit re-exports for common table names

export const TABLES = {
  TASKS: 'tasks',
  MESSAGES: 'messages',
  PLANS: 'plans',
  AGENT_CHANGE_SETS: 'agent_change_sets',
  AGENT_FILE_CHANGES: 'agent_file_changes'
} as const
