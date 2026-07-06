/**
 * Thin segment type produced by `parseThinkTags` when splitting a plain-text
 * message body into `text` and `<think>...</think>` sections.
 */
export interface ThinkSegment {
  type: 'text' | 'think'
  content: string
  closed?: boolean
}

const THINK_OPEN_TAG_RE = /<\s*think\s*>/i

/**
 * Remove `<think>` and `</think>` tag markers from `text`, leaving only
 * the inner content.
 */
export function stripThinkTagMarkers(text: string): string {
  return text.replace(/<\s*\/?\s*think\s*>/gi, '')
}

/**
 * Split `text` into an alternating list of text / think segments.
 * Each think segment is wrapped by the `<think>...</think>` tag pair.
 *
 * When the closing `</think>` tag is missing (streaming mid-think) the
 * segment will have `closed: false`.
 */
export function parseThinkTags(text: string): ThinkSegment[] {
  if (!THINK_OPEN_TAG_RE.test(text)) {
    return [{ type: 'text', content: stripThinkTagMarkers(text) }]
  }

  const segments: ThinkSegment[] = []
  const regex = /<\s*think\s*>([\s\S]*?)(<\s*\/\s*think\s*>|$)/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = stripThinkTagMarkers(text.slice(lastIndex, match.index))
      if (before.trim()) segments.push({ type: 'text', content: before })
    }
    segments.push({ type: 'think', content: stripThinkTagMarkers(match[1]), closed: !!match[2] })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    const remaining = stripThinkTagMarkers(text.slice(lastIndex))
    if (remaining.trim()) segments.push({ type: 'text', content: remaining })
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: stripThinkTagMarkers(text) }]
}

/**
 * Remove all `<think>...</think>` blocks from `text` and return the
 * remaining visible text, trimmed.
 */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<\s*think\s*>[\s\S]*?(<\s*\/\s*think\s*>|$)/gi, '')
    .replace(/<\s*\/?\s*think\s*>/gi, '')
    .trim()
}
