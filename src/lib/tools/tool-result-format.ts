import { decode, encode, type EncodeOptions, type DecodeOptions } from '@toon-format/toon'

type StructuredToolResult = Record<string, unknown> | unknown[]

// keyFolding: 'safe' collapses single-key chains into dotted paths for maximum compression
// expandPaths: 'safe' restores dotted paths back to nested objects on decode
// strict: false is lenient with LLM-generated or internally-stored data

const TOON_ENCODE_OPTIONS: EncodeOptions = {
  keyFolding: 'safe',
  indent: 2
}

const TOON_DECODE_OPTIONS: DecodeOptions = {
  strict: false,
  expandPaths: 'safe',
  indent: 2
}

/**
 * Encode any JSON-compatible value to TOON format with optimal defaults.
 * Uses safe key folding for maximum token compression.
 */
export function toonEncode(value: unknown): string {
  return encode(value, TOON_ENCODE_OPTIONS).trimEnd()
}

/**
 * Decode a TOON format string to a JavaScript value.
 * Lenient mode with path expansion for round-trip fidelity.
 */
export function toonDecode(text: string): unknown {
  return decode(text, TOON_DECODE_OPTIONS)
}

export function encodeStructuredToolResult(
  value: StructuredToolResult
): string {
  return toonEncode(value)
}

export function encodeToolError(message: string): string {
  return toonEncode({ error: message })
}

export function decodeStructuredToolResult(text: string): StructuredToolResult | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = toonDecode(trimmed) as unknown
    if (isStructuredToolResult(parsed)) return parsed
  } catch {
    // ignore TOON parse errors
  }

  return null
}

function isStructuredToolResult(value: unknown): value is StructuredToolResult {
  return Array.isArray(value) || (!!value && typeof value === 'object')
}

export function isStructuredToolErrorText(text: string): boolean {
  const parsed = decodeStructuredToolResult(text)
  if (!parsed || Array.isArray(parsed)) return false
  const keys = Object.keys(parsed)
  return keys.length === 1 && typeof parsed.error === 'string'
}
