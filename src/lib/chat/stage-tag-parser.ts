/**
 * Segment type produced by `parseStageTags` when splitting a plain-text
 * message body into `text` and `<stage>...</stage>` sections. A `stage`
 * segment carries that stage's declared title as its inner content.
 */
export interface StageSegment {
  type: 'text' | 'stage'
  content: string
  closed?: boolean
}

const STAGE_OPEN_TAG_RE = /<\s*stage\s*>/i

/**
 * Remove `<stage>` and `</stage>` tag markers from `text`, leaving only
 * the inner content.
 */
export function stripStageTagMarkers(text: string): string {
  return text.replace(/<\s*\/?\s*stage\s*>/gi, '')
}

/**
 * Split `text` into an alternating list of text / stage segments.
 * Each stage segment is wrapped by the `<stage>...</stage>` tag pair and
 * its `content` is the declared stage title.
 *
 * When the closing `</stage>` tag is missing (streaming mid-stage) the
 * segment will have `closed: false` — its partial inner text is the
 * title streaming in.
 */
export function parseStageTags(text: string): StageSegment[] {
  if (!STAGE_OPEN_TAG_RE.test(text)) {
    return [{ type: 'text', content: stripStageTagMarkers(text) }]
  }

  const segments: StageSegment[] = []
  const regex = /<\s*stage\s*>([\s\S]*?)(<\s*\/\s*stage\s*>|$)/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = stripStageTagMarkers(text.slice(lastIndex, match.index))
      if (before.trim()) segments.push({ type: 'text', content: before })
    }
    segments.push({ type: 'stage', content: stripStageTagMarkers(match[1]), closed: !!match[2] })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    const remaining = stripStageTagMarkers(text.slice(lastIndex))
    if (remaining.trim()) segments.push({ type: 'text', content: remaining })
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: stripStageTagMarkers(text) }]
}

/**
 * Remove all `<stage>...</stage>` blocks from `text` and return the
 * remaining visible text, trimmed.
 */
export function stripStageTags(text: string): string {
  return text
    .replace(/<\s*stage\s*>[\s\S]*?(<\s*\/\s*stage\s*>|$)/gi, '')
    .replace(/<\s*\/?\s*stage\s*>/gi, '')
    .trim()
}
