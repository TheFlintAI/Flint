// ── Structured Memory Types ────────────────────────────────────────
// Vector-backed memory system using SQLite + pluggable embedding pipeline.
// Storage: ~/.flint/memory.db (SQLite, WAL mode).
// Embedding: configurable — local fastembed (EmbeddingGemma-300M, 768-dim) or provider API.
// Search: cosine similarity (brute-force, fast for personal-scale <100K entries).

// ── Taxonomy ────────────────────────────────────────────────────────

export type MemoryEntryType =
  | 'preference'
  | 'decision'
  | 'context'
  | 'reference'

// ── Entry ───────────────────────────────────────────────────────────

/** A memory entry as returned from the backend */
export interface MemoryEntry {
  id: string
  type: MemoryEntryType
  title: string // Agent-provided human-readable title
  body: string // Markdown body
  created_at: string // ISO 8601
  updated_at: string // ISO 8601
}

// ── Index Snapshot (lightweight, for context injection) ─────────────

export interface MemoryIndexEntry {
  id: string
  type: MemoryEntryType
  title: string
  updated_at: string // ISO 8601
}

export interface MemoryIndexSnapshot {
  entries: MemoryIndexEntry[]
  total_entries: number
  updated_at: number // epoch ms
}

// ── Search ──────────────────────────────────────────────────────────

export interface MatchedLine {
  line: number
  text: string
}

export interface MemorySearchResult {
  entry: MemoryEntry
  score: number // 0.0 – 1.0 cosine similarity
  matched_lines: MatchedLine[]
}

export interface MemoryStats {
  total_entries: number
  by_type: Record<string, number>
  vector_dim: number
  storage_path: string
}

// ── Filters ─────────────────────────────────────────────────────────

export interface MemoryEntryFilter {
  type?: MemoryEntryType
  search?: string // text search in body
  updatedSince?: string // ISO 8601
  limit?: number
  offset?: number
}

// ── Labels (i18n keys) ──────────────────────────────────────────────

export const MEMORY_TYPE_LABELS: Record<MemoryEntryType, string> = {
  preference: 'memory.types.preference',
  decision: 'memory.types.decision',
  context: 'memory.types.context',
  reference: 'memory.types.reference',
}

// ── Type Guards & Normalization ─────────────────────────────────────

const VALID_MEMORY_TYPES: Set<string> = new Set([
  'preference', 'decision', 'context', 'reference',
])

/** Normalize a type name to the current taxonomy. Returns null for unknown types. */
export function normalizeMemoryType(value: string): MemoryEntryType | null {
  if (value === 'preference' || value === 'decision' || value === 'context' || value === 'reference') {
    return value
  }
  return null
}

export function isValidMemoryType(value: unknown): value is string {
  return typeof value === 'string' && VALID_MEMORY_TYPES.has(value)
}
