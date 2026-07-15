/**
 * Unified content truncation utilities.
 *
 * All tools that return large content to the AI (Read, WebFetch, Grep, etc.)
 * should use these helpers to ensure predictable context usage and provide
 * friendly truncation notices when content is too large.
 *
 * Design principles:
 * - Byte-accurate (UTF-8), not char-count — keeps LLM context budgets exact.
 * - Truncation notice is included in the byte budget and tells the AI both
 *   the original size AND how to request more (offset/limit for files).
 * - All constants live here; tools import from a single source of truth.
 */

// ── Constants ─────────────────────────────────────────────────────

/** Maximum bytes of content to include in a single tool response. Matches Rust's MAX_OUTPUT_BYTES. */
export const MAX_CONTENT_BYTES = 60 * 1024 // 60 KB (leaves ~4 KB headroom for Rust's 64 KB ceiling)

/** Maximum line length in grep results. */
export const MAX_GREP_LINE_LENGTH = 160

/** Maximum grep match rows. */
export const MAX_GREP_MATCHES = 200

/** Maximum glob results. */
export const MAX_GLOB_RESULTS = 100

// ── Types ─────────────────────────────────────────────────────────

export interface TruncationResult {
  /** The truncated content, with notice appended if truncated. */
  content: string
  /** Whether content was actually truncated. */
  truncated: boolean
  /** Original byte size before truncation. */
  originalBytes: number
  /** Estimated original line count. */
  originalLines: number
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Estimate the UTF-8 byte length of a string.
 * Uses native TextEncoder which is highly optimised.
 */
export function estimateBytes(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Format byte count into a human-friendly string.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Core ──────────────────────────────────────────────────────────

/**
 * Truncate `content` to fit within `maxBytes` UTF-8 bytes.
 *
 * When the content exceeds the budget, it is sliced at a clean UTF-8
 * boundary and a truncation notice is appended. The notice tells the AI
 * the original size and line count, and suggests using Read's offset/limit
 * to fetch specific sections.
 *
 * The notice itself is included in the byte budget so the combined result
 * never exceeds `maxBytes`.
 */
export function truncateContent(
  content: string,
  maxBytes: number = MAX_CONTENT_BYTES,
): TruncationResult {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const fullBytes = encoder.encode(content)
  const originalBytes = fullBytes.length
  const originalLines = content.split('\n').length

  if (originalBytes <= maxBytes) {
    return { content, truncated: false, originalBytes, originalLines }
  }

  const notice = buildTruncationNotice(originalBytes, originalLines)
  const noticeBytes = encoder.encode(notice).length + 1 // +1 for leading newline
  const contentBudget = maxBytes - noticeBytes

  // Edge case: notice alone exceeds budget — return notice only
  if (contentBudget <= 0) {
    return { content: notice, truncated: true, originalBytes, originalLines }
  }

  // Decode a valid UTF-8 prefix of contentBudget bytes
  const truncatedBytes = fullBytes.slice(0, contentBudget)
  const truncatedText = decoder.decode(truncatedBytes, { stream: false })

  return {
    content: `${truncatedText}\n${notice}`,
    truncated: true,
    originalBytes,
    originalLines,
  }
}

/**
 * Build a truncation notice in Chinese (project default).
 */
export function buildTruncationNotice(originalBytes: number, totalLines: number): string {
  const size = formatSize(originalBytes)
  return `[... 内容已截断: 原始 ${size} / ${totalLines.toLocaleString()} 行，如需查看更多请使用 offset/limit 参数分段读取 ...]`
}
