import type { TFunction } from 'i18next'

// Builds a per-call, user-friendly title for a teammate's tool log row by
// pairing a localized verb with a short detail extracted from the call's input
// (e.g. "Read package.json" instead of the generic "Read file"). Falls back to
// `null` when no detail is available, so the caller can use the plain tool
// display name.

function basename(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const norm = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = norm.lastIndexOf('/')
  return idx >= 0 ? norm.slice(idx + 1) : norm
}

function truncate(value: string, max = 48): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

type Input = Record<string, unknown>

const EXTRACTORS: Record<string, (input: Input) => string> = {
  Read: (i) => basename(i.file_path ?? i.path),
  Write: (i) => basename(i.file_path ?? i.path),
  Edit: (i) => basename(i.file_path ?? i.path),
  LS: (i) => basename(i.path) || '.',
  Glob: (i) => firstString(i.pattern, i.path),
  Grep: (i) => firstString(i.pattern, i.query),
  Bash: (i) => truncate(firstString(i.command, i.description)),
  Skill: (i) => firstString(i.name),
  TaskCreate: (i) => firstString(i.title, i.subject),
  TaskGet: (i) => `#${firstString(i.taskId)}`,
  TaskUpdate: (i) => `#${firstString(i.taskId)}`,
  WebSearch: (i) => truncate(firstString(i.query)),
  WebFetch: (i) => truncate(firstString(i.url)),
  MemoryRead: (i) => firstString(i.key),
  MemorySearch: (i) => firstString(i.query, i.key),
  MemoryWrite: (i) => firstString(i.key),
  MemoryDelete: (i) => firstString(i.key)
}

export function formatToolLogTitle(
  name: string,
  input: Input | undefined,
  t: TFunction
): string | null {
  const extract = EXTRACTORS[name]
  if (!extract) return null
  const detail = extract(input ?? {})
  if (!detail) return null
  const templated = t(`toolLogTitle.${name}`, { detail, defaultValue: '' })
  return templated || null
}
