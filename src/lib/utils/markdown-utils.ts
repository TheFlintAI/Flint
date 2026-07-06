import 'katex/contrib/mhchem'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useChatStore } from '@/stores/chat-store'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { tauriCommands } from '@/services/tauri-api/command-client'

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

const HTTP_URL_RE = /^https?:\/\//i
const FILE_URL_RE = /^file:\/\//i
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/
const OTHER_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const ROOT_FILE_NAME_RE =
  /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|bun\.lock|tsconfig(?:\.[^.]+)?\.json|README(?:\.[A-Za-z0-9_-]+)?\.md|CHANGELOG\.md|LICENSE|AGENTS\.md|CLAUDE\.md|USER\.md|MEMORY\.md|Dockerfile|docker-compose(?:\.[A-Za-z0-9_-]+)?\.ya?ml|Makefile|\.env(?:\.[A-Za-z0-9_-]+)?)$/i
const SPECIAL_FILE_NAME_RE = /^(?:Dockerfile|Makefile|LICENSE)$/i
const PAREN_LINE_RE = /\s+\(line\s+(\d+)(?::(\d+))?\)$/i
const HASH_LINE_RE = /#L(\d+)(?:-L?\d+)?$/i
const COLON_LINE_RE = /(?<!^[a-zA-Z]):(\d+)(?::(\d+))?$/
const EXPLICIT_LINE_RE = /(?::\d+(?::\d+)?)$|#L\d+(?:-L?\d+)?$|\s+\(line\s+\d+(?::\d+)?\)$/i

// ---------------------------------------------------------------------------
// Markdown plugins
// ---------------------------------------------------------------------------

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
export const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]

// ---------------------------------------------------------------------------
// Code block detection
// ---------------------------------------------------------------------------

type MarkdownCodeElementProps = {
  position?: {
    start?: { line?: number }
    end?: { line?: number }
  }
}

export function isMarkdownCodeBlock(
  rawCode: string,
  node?: MarkdownCodeElementProps
): boolean {
  const startLine = node?.position?.start?.line
  const endLine = node?.position?.end?.line
  return (
    (typeof startLine === 'number' && typeof endLine === 'number' && startLine !== endLine) ||
    rawCode.includes('\n')
  )
}

// ---------------------------------------------------------------------------
// Active task context
// ---------------------------------------------------------------------------

function getActiveTaskContext(): { workingFolder?: string; sshConnectionId?: string } {
  const chatState = useChatStore.getState()
  const activeTask = chatState.tasks.find(
    (taskItem) => taskItem.id === chatState.activeTaskId
  )

  return {
    workingFolder: activeTask?.workingFolder?.trim(),
    sshConnectionId: activeTask?.sshConnectionId
  }
}

// ---------------------------------------------------------------------------
// Path parsing helpers
// ---------------------------------------------------------------------------

function stripLocalPathDecorators(value: string): string {
  let normalized = value.trim()
  normalized = normalized.replace(PAREN_LINE_RE, '')
  const queryIndex = normalized.indexOf('?')
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex)
  const hashIndex = normalized.indexOf('#')
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex)
  if (/(?<!^[a-zA-Z]):\d+(?::\d+)?$/.test(normalized)) {
    normalized = normalized.replace(/:\d+(?::\d+)?$/, '')
  }
  return normalized
}

function getLocalPathTarget(value: string): { line?: number; column?: number } {
  const raw = value.trim()
  const parenMatch = PAREN_LINE_RE.exec(raw)
  const hashMatch = HASH_LINE_RE.exec(raw)
  const colonMatch = COLON_LINE_RE.exec(raw.replace(PAREN_LINE_RE, '').split('#', 1)[0])
  const lineText = parenMatch?.[1] ?? hashMatch?.[1] ?? colonMatch?.[1]
  if (!lineText) return {}

  const line = Number(lineText)
  const columnText = parenMatch?.[2] ?? colonMatch?.[2]
  const column = columnText ? Number(columnText) : undefined
  return {
    line: Number.isFinite(line) && line > 0 ? line : undefined,
    column: column !== undefined && Number.isFinite(column) && column > 0 ? column : undefined
  }
}

function decodeFileUrlPath(value: string): string {
  try {
    const url = new URL(value)
    let pathname = decodeURIComponent(url.pathname || '')
    if (/^\/[a-zA-Z]:/.test(pathname)) pathname = pathname.slice(1)
    if (url.host) {
      return `//${decodeURIComponent(url.host)}${pathname}`
    }
    return pathname
  } catch {
    const raw = value.replace(FILE_URL_RE, '')
    const normalized = raw.startsWith('/') && /^\/[a-zA-Z]:/.test(raw) ? raw.slice(1) : raw
    try {
      return decodeURIComponent(normalized)
    } catch {
      return normalized
    }
  }
}

function hasFileLikeName(value: string): boolean {
  const lastSegment = value.split(/[\\/]/).pop()?.trim() ?? ''
  if (!lastSegment) return false
  return /\.[A-Za-z0-9._-]+$/.test(lastSegment) || SPECIAL_FILE_NAME_RE.test(lastSegment)
}

function joinPath(baseDir: string, relativePath: string): string {
  const trimmedBase = baseDir.replace(/[\\/]+$/, '')
  const trimmedRelative = relativePath.replace(/^\.[\\/]/, '')
  const separator = trimmedBase.includes('\\') && !trimmedBase.includes('/') ? '\\' : '/'
  return `${trimmedBase}${separator}${trimmedRelative}`
}

// ---------------------------------------------------------------------------
// File path detection & resolution
// ---------------------------------------------------------------------------

export function isLikelyLocalFilePath(value: string): boolean {
  const raw = value.trim()
  if (!raw || raw.startsWith('#') || HTTP_URL_RE.test(raw)) return false
  if (FILE_URL_RE.test(raw)) return true

  const normalized = stripLocalPathDecorators(raw)
  if (!normalized) return false
  if (OTHER_SCHEME_RE.test(normalized) && !WINDOWS_ABSOLUTE_PATH_RE.test(normalized)) return false

  if (
    WINDOWS_ABSOLUTE_PATH_RE.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../')
  ) {
    return hasFileLikeName(normalized)
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    return hasFileLikeName(normalized)
  }

  return ROOT_FILE_NAME_RE.test(normalized)
}

export function resolveLocalFilePath(value: string, filePath?: string): string | null {
  if (!isLikelyLocalFilePath(value)) return null

  let target = FILE_URL_RE.test(value) ? decodeFileUrlPath(value) : stripLocalPathDecorators(value)
  try {
    target = decodeURIComponent(target)
  } catch {
    // ignore decode failures and keep original target
  }

  if (
    WINDOWS_ABSOLUTE_PATH_RE.test(target) ||
    target.startsWith('\\\\') ||
    target.startsWith('/')
  ) {
    return target
  }

  const baseDir =
    (filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : getActiveTaskContext().workingFolder) ||
    ''
  if (!baseDir) return null

  return joinPath(baseDir, target)
}

export function openLocalFilePath(value: string, filePath?: string): boolean {
  const resolved = resolveLocalFilePath(value, filePath)
  if (!resolved) return false

  void tauriCommands.invoke(TAURI_COMMANDS.SHELL_OPEN_PATH, resolved)
  return true
}

export function openMarkdownHref(href: string, filePath?: string): boolean {
  const link = href.trim()
  if (!link) return false
  if (HTTP_URL_RE.test(link)) {
    void tauriCommands.invoke(TAURI_COMMANDS.SHELL_OPEN_EXTERNAL, link)
    return true
  }
  return openLocalFilePath(link, filePath)
}
