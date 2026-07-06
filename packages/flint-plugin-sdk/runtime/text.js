/**
 * Text decoding utilities for plugin text processing.
 *
 * Provides general-purpose text normalization helpers that plugins
 * can use when processing text from external APIs — especially
 * Chinese web services that may encode Unicode characters as
 * JSON-style \\uXXXX escape sequences.
 */

/**
 * Resolve \\uXXXX Unicode escape sequences in a string.
 *
 * Many Chinese web APIs (Tencent, Sina, etc.) embed Chinese characters
 * as JSON-style Unicode escapes in otherwise non-JSON response formats.
 * This utility resolves those escapes into actual Unicode characters.
 *
 * Example:
 *   decodeUnicodeEscapes('\\u8d35\\u5dde\\u8305\\u53f0') → '贵州茅台'
 *
 * This only handles the \\uXXXX form (4 hex digits). It intentionally
 * does NOT attempt full JSON decoding — it's a targeted normalizer
 * for the most common escape format used by Chinese APIs.
 */
function decodeUnicodeEscapes(text) {
  if (typeof text !== 'string') return text
  return text.replace(
    /\\u([0-9a-fA-F]{4})/g,
    (_, hex) => {
      const cp = parseInt(hex, 16)
      if (cp >= 0xD800 && cp <= 0xDFFF) {
        // Lone surrogate — don't decode, keep as-is
        return _
      }
      return String.fromCharCode(cp)
    }
  )
}

export const textUtils = {
  /** Resolve \\uXXXX Unicode escape sequences to actual characters. */
  decode: decodeUnicodeEscapes,
}
