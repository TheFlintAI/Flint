import { Allow, parse as parsePartialJSON } from 'partial-json'
import { escapeRegExp } from '@/lib/utils'
import { toonDecode, toonEncode } from '../../tools/tool-result-format'

/**
 * Normalize a parsed tool input through a TOON encode→decode round-trip.
 * This ensures the internal representation is TOON-compatible and strips
 * any JSON-specific artifacts (e.g., null vs undefined inconsistencies).
 */
function normalizeThroughToon(input: Record<string, unknown>): Record<string, unknown> {
  try {
    const encoded = toonEncode(input)
    const decoded = toonDecode(encoded)
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded as Record<string, unknown>
    }
  } catch {
    // If TOON round-trip fails, return original input unchanged
  }
  return input
}

export function readLooseJsonStringField(raw: string, key: string): string | null {
  const keyPattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`)
  const match = keyPattern.exec(raw)
  if (!match) return null

  let idx = match.index + match[0].length
  let value = ''
  let escaped = false

  while (idx < raw.length) {
    const ch = raw[idx]

    if (escaped) {
      switch (ch) {
        case 'n':
          value += '\n'
          break
        case 'r':
          value += '\r'
          break
        case 't':
          value += '\t'
          break
        case '"':
          value += '"'
          break
        case '\\':
          value += '\\'
          break
        default:
          value += ch
          break
      }
      escaped = false
      idx++
      continue
    }

    if (ch === '\\') {
      escaped = true
      idx++
      continue
    }

    if (ch === '"') return value

    value += ch
    idx++
  }

  if (escaped) value += '\\'
  return value
}

export function parseWriteInputLoosely(rawArgs: string): Record<string, unknown> | null {
  const filePath =
    readLooseJsonStringField(rawArgs, 'file_path') ?? readLooseJsonStringField(rawArgs, 'path')
  const content = readLooseJsonStringField(rawArgs, 'content')

  const input: Record<string, unknown> = {}
  if (filePath !== null) input.file_path = filePath
  if (content !== null) input.content = content
  return Object.keys(input).length > 0 ? input : null
}

export function normalizeParsedToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const args = input.args
  if (
    args &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    Object.keys(input).every((key) => key === 'args')
  ) {
    return args as Record<string, unknown>
  }
  return input
}

export function parseToolInputSnapshot(rawArgs: string, toolName: string): Record<string, unknown> | null {
  const isWriteTool = toolName === 'Write'
  const looseWriteInput = isWriteTool ? parseWriteInputLoosely(rawArgs) : null
  const looseInput = looseWriteInput

  try {
    const parsed = parsePartialJSON(rawArgs, Allow.ALL)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalizedParsed = normalizeParsedToolInput(parsed as Record<string, unknown>)
      if (looseInput && Object.keys(looseInput).length > 0) {
        return { ...looseInput, ...normalizedParsed }
      }
      return normalizedParsed
    }
  } catch {
    // Fall through to tool-specific tolerant parsing.
  }

  if (looseInput && Object.keys(looseInput).length > 0) {
    return looseInput
  }

  return null
}

export function mergeToolInputs(
  streamedInput: Record<string, unknown> | null,
  providerInput?: Record<string, unknown>
): Record<string, unknown> {
  const normalizedProviderInput =
    providerInput && typeof providerInput === 'object' && !Array.isArray(providerInput)
      ? normalizeParsedToolInput(providerInput)
      : {}

  if (streamedInput && Object.keys(streamedInput).length > 0) {
    return normalizeThroughToon({ ...streamedInput, ...normalizedProviderInput })
  }
  return normalizeThroughToon(normalizedProviderInput)
}
