// Project Memory File Resolution
// Resolves AGENTS.md and other project-level memory files.
// This is separate from the global vector-backed memory system (memory-files.ts).
// Still uses filesystem Tauri commands directly.

import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import type { TauriCommandClient } from '@/lib/tools/tool-types'

// Path Utilities

interface ReadTextFileResult {
  content?: string
  error?: string
  notFound?: boolean
}

function parseReadError(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const entries = Object.entries(parsed)
    if (entries.length !== 1) return null
    const [key, value] = entries[0]
    if (key !== 'error' || typeof value !== 'string' || !value.trim()) return null
    return value
  } catch {
    return null
  }
}

async function readTextFile(
  commands: TauriCommandClient,
  filePath: string,
): Promise<ReadTextFileResult> {
  try {
    const result = await commands.invoke(TAURI_COMMANDS.FS_READ_FILE, { path: filePath })

    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>
      if (obj.notFound === true) return { notFound: true }
      if (typeof obj.content === 'string') return { content: obj.content }
      if ('error' in obj)
        return { error: String((obj as { error?: unknown }).error ?? 'Failed to read file') }
    }

    if (typeof result === 'string') {
      const readError = parseReadError(result)
      if (readError) return { error: readError }
      return { content: result }
    }

    return { error: 'Unexpected fs:read-file response type' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function detectPathSeparator(pathValue: string): '\\' | '/' {
  return pathValue.includes('\\') ? '\\' : '/'
}

export function joinFsPath(basePath: string, ...segments: string[]): string {
  const trimmedBase = basePath.replace(/[\\/]+$/, '')
  const separator = detectPathSeparator(trimmedBase)
  const normalizedSegments = segments
    .map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean)
  if (trimmedBase.length === 0) return normalizedSegments.join(separator)
  if (normalizedSegments.length === 0) return trimmedBase
  return [trimmedBase, ...normalizedSegments].join(separator)
}

// Project Memory Resolution

function getProjectMemoryCandidatePaths(
  projectRootPath: string,
  ...segments: string[]
): { preferredPath: string; fallbackPath: string } {
  return {
    preferredPath: joinFsPath(projectRootPath, '.agents', ...segments),
    fallbackPath: joinFsPath(projectRootPath, ...segments),
  }
}

export async function resolveProjectMemoryTextFileForTarget(
  commands: TauriCommandClient,
  projectRootPath: string,
  ...segments: string[]
): Promise<{
  path: string
  content?: string
  error?: string
  missingFile: boolean
}> {
  const { preferredPath, fallbackPath } = getProjectMemoryCandidatePaths(
    projectRootPath,
    ...segments,
  )

  const preferred = await readTextFile(commands, preferredPath)
  if (preferred.notFound) {
    // preferred not found, try fallback
  } else if (!preferred.error) {
    return { path: preferredPath, content: preferred.content ?? '', missingFile: false }
  } else {
    return { path: preferredPath, error: preferred.error, missingFile: false }
  }

  const fallback = await readTextFile(commands, fallbackPath)
  if (fallback.notFound) {
    // fallback also not found
  } else if (!fallback.error) {
    return { path: fallbackPath, content: fallback.content ?? '', missingFile: false }
  } else {
    return { path: fallbackPath, error: fallback.error, missingFile: false }
  }

  return { path: preferredPath, missingFile: true }
}
