import type { ImageBlock, ToolResultContent } from '@/lib/api/types'
import type { ToolPanelProps } from './types'
import { decodeStructuredToolResult } from '@/lib/tools/tool-result-format'

// --- Structured input value formatting (for supplement body field rows) ---

const STRUCTURED_INPUT_VALUE_CHARS = 300
const STRUCTURED_INPUT_ARRAY_ITEM_LIMIT = 6
const STRUCTURED_INPUT_OBJECT_KEY_LIMIT = 12

function formatPrimitiveInputValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 80)}...` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value === null) {
    return String(value)
  }
  return value === undefined ? 'undefined' : typeof value
}

export function formatStructuredInputValue(value: unknown): { text: string; mono: boolean } {
  if (typeof value === 'string') {
    const text =
      value.length > STRUCTURED_INPUT_VALUE_CHARS
        ? `${value.slice(0, STRUCTURED_INPUT_VALUE_CHARS)}... (${value.length} chars)`
        : value
    return { text, mono: false }
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value === null) {
    return { text: String(value), mono: true }
  }
  if (Array.isArray(value)) {
    const preview = value.slice(0, STRUCTURED_INPUT_ARRAY_ITEM_LIMIT).map(formatPrimitiveInputValue)
    const suffix = value.length > STRUCTURED_INPUT_ARRAY_ITEM_LIMIT ? ', ...' : ''
    return {
      text: preview.length > 0 ? `[${preview.join(', ')}${suffix}] (${value.length} items)` : '[]',
      mono: true
    }
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    const visibleKeys = keys.slice(0, STRUCTURED_INPUT_OBJECT_KEY_LIMIT)
    const suffix = keys.length > STRUCTURED_INPUT_OBJECT_KEY_LIMIT ? ', ...' : ''
    return {
      text: visibleKeys.length > 0 ? `{ ${visibleKeys.join(', ')}${suffix} } (${keys.length} keys)` : '{}',
      mono: true
    }
  }
  return { text: String(value), mono: true }
}

export function getBashInputTerminalId(input: Record<string, unknown>): string | null {
  const terminalId = input.terminalId
  return typeof terminalId === 'string' && terminalId.trim() ? terminalId.trim() : null
}

function shallowEqualRecord(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  if (prev === next) return true
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false
  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false
    if (!Object.is(prev[key], next[key])) return false
  }
  return true
}

function toolResultContentEqual(
  prev: ToolResultContent | undefined,
  next: ToolResultContent | undefined
): boolean {
  if (prev === next) return true
  if (prev === undefined || next === undefined) return false
  if (typeof prev === 'string' || typeof next === 'string') return prev === next
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    const prevBlock = prev[i]
    const nextBlock = next[i]
    if (prevBlock === nextBlock) continue
    if (prevBlock.type !== nextBlock.type) return false
    if (prevBlock.type === 'text' && nextBlock.type === 'text') {
      if (prevBlock.text !== nextBlock.text) return false
      continue
    }
    if (prevBlock.type === 'image' && nextBlock.type === 'image') {
      if (
        prevBlock.source.type !== nextBlock.source.type ||
        prevBlock.source.mediaType !== nextBlock.source.mediaType ||
        prevBlock.source.data !== nextBlock.source.data ||
        prevBlock.source.url !== nextBlock.source.url ||
        prevBlock.source.filePath !== nextBlock.source.filePath
      ) {
        return false
      }
      continue
    }
    return false
  }
  return true
}

export function areToolPanelPropsEqual(prev: ToolPanelProps, next: ToolPanelProps): boolean {
  return (
    prev.toolUseId === next.toolUseId &&
    prev.name === next.name &&
    prev.status === next.status &&
    prev.error === next.error &&
    prev.startedAt === next.startedAt &&
    prev.completedAt === next.completedAt &&
    shallowEqualRecord(prev.input, next.input) &&
    toolResultContentEqual(prev.output, next.output)
  )
}

export function outputAsString(output: ToolResultContent | undefined): string | undefined {
  if (output === undefined) return undefined
  if (typeof output === 'string') return output
  const texts = output
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
  return texts.join('\n') || undefined
}

export function getSkillNameFromInput(input: Record<string, unknown>): string {
  const raw = input.name
  return typeof raw === 'string' ? raw.trim() : ''
}

export function deriveOutputError(output: string | undefined): string | null {
  if (!output) return null
  const trimmed = output.trim()
  if (!trimmed) return null

  const parsed = decodeStructuredToolResult(trimmed)
  if (parsed) {
    if (!Array.isArray(parsed) && typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim()
    }
    return null
  }

  return trimmed
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function getStringInput(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function compactPath(value: string, depth = 2): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return value
  return parts.slice(-depth).join('/')
}

export function pathFileName(value: string): string {
  return compactPath(value, 1)
}

export function pathParent(value: string, depth = 3): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(Math.max(0, parts.length - depth - 1), -1).join('/')
}

export function stripReadLineNumbers(output: string): string {
  return /^\s*\d+\t/.test(output)
    ? output
        .split('\n')
        .map((line) => line.replace(/^\s*\d+\t/, ''))
        .join('\n')
    : output
}

export function getReadOutputLineCount(output: string | undefined): number | null {
  if (!output?.trim()) return null
  const decoded = decodeStructuredToolResult(output)
  if (decoded && !Array.isArray(decoded) && typeof decoded.error === 'string') return null
  return stripReadLineNumbers(output).split('\n').length
}

export function hasImageBlocks(output: ToolResultContent | undefined): boolean {
  return Array.isArray(output) && output.some((b) => b.type === 'image')
}

export function getImageBlockPreviewSrc(image: ImageBlock): string {
  if (image.source.type === 'base64' && image.source.data) {
    return `data:${image.source.mediaType || 'image/png'};base64,${image.source.data}`
  }
  return image.source.url ?? ''
}

export function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

/**
 * Translate a known enum-like value (a status, type, action, …) via i18n,
 * falling back to the raw value when no translation exists — unknown values
 * or locales that haven't defined the key yet keep their original string.
 *
 * `prefix` is the i18n namespace path (e.g. `'taskPanel.status'`); the value
 * is appended as the leaf key (`'taskPanel.status.in_progress'`).
 */
export function enumLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  prefix: string,
  value: string | undefined | null
): string {
  if (!value) return ''
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? value : translated
}

export function firstStringInput(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

export function fileToolPath(input: Record<string, unknown>): string {
  return firstStringInput(input, [
    'file_path',
    'path',
    'targetPath',
    'target_path'
  ])
}

export function compactToolPathSummary(value: string): {
  primary: string
  secondary?: string
} {
  return {
    primary: pathFileName(value),
    secondary: value ? pathParent(value) || compactPath(value, 2) : undefined
  }
}

export function lineRangeBadge(
  input: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  const rawOffset = input.offset
  const rawLimit = input.limit
  const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? rawOffset : null
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : null
  if (offset === null) return null
  if (limit === null || limit <= 0) return t('toolCall.lineRangeFrom', { start: offset })
  return t('toolCall.lineRange', { start: offset, end: offset + limit - 1 })
}

export function searchScopeText(
  input: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const path = getStringInput(input, ['path'])
  const include = getStringInput(input, ['include'])
  const exclude = getStringInput(input, ['exclude'])
  return [
    path ? t('toolCall.searchInPath', { path: compactPath(path, 3) }) : null,
    include ? t('toolCall.includeGlob', { include }) : null,
    exclude ? t('toolCall.excludeGlob', { exclude }) : null
  ]
    .filter((item): item is string => !!item)
    .join(' · ')
}
