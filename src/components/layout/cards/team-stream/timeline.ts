import type { ToolCallState } from '@/lib/agent/types'

// Teammate activity timeline construction.
// The teammate's live activity comes from two unrelated streams:
//   - `streamingText`: a single accumulated string holding every text delta
//     (with `<stage>` / `<think>` tags inline), parsed into ordered units.
//   - `toolCalls`: a timestamped array of tool invocations.
// Naively concatenating them (all text units, then all tool rows) is wrong —
// it stacks every stage label at the top and every tool call at the bottom,
// destroying the real arrival order. `buildTimeline` merges them into one
// arrival-ordered list using each tool call's cursor (the streamingText length
// at the moment that tool started, captured in teammate-runner), then groups
// the items under the `<stage>` that was open when they were emitted.

export type TimelineItem =
  | { kind: 'think'; text: string; closed: boolean; live: boolean }
  | { kind: 'text'; text: string; closed: boolean; live: boolean }
  | { kind: 'tool'; toolCall: ToolCallState }

export interface TimelineStageGroup {
  kind: 'stage'
  title: string
  closed: boolean
  live: boolean
  items: TimelineItem[]
}

export interface TimelineUngrouped {
  kind: 'ungrouped'
  items: TimelineItem[]
}

export type TimelineGroup = TimelineStageGroup | TimelineUngrouped

interface RawUnit {
  kind: 'stage' | 'think' | 'text'
  start: number // char offset in raw streamingText
  end: number
  closed: boolean
  // for stage:
  title?: string
  // for think/text:
  text?: string
}

const TAG_RE = /<\s*(\/?)(stage|think)\s*>/gi

function pushText(items: RawUnit[], raw: string, start: number, end: number): void {
  const slice = raw.slice(start, end)
  const trimmed = slice.trim()
  if (!trimmed) return
  const lead = slice.length - slice.trimStart().length
  items.push({
    kind: 'text',
    start: start + lead,
    end: start + lead + trimmed.length,
    closed: true,
    text: trimmed
  })
}

function parseUnitsWithSpans(raw: string): RawUnit[] {
  const items: RawUnit[] = []
  let lastIndex = 0
  let openKind: 'stage' | 'think' | null = null
  let openStart = 0
  let openContentStart = 0

  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(raw)) !== null) {
    const closing = m[1] === '/'
    const kind = m[2].toLowerCase() as 'stage' | 'think'

    if (!closing) {
      if (!openKind) {
        // flush text before this opener
        pushText(items, raw, lastIndex, m.index)
        openKind = kind
        openStart = m.index
        openContentStart = TAG_RE.lastIndex
      }
      // nested opener while another tag is open: ignore (treat its content as
      // part of the open tag). The closer will match the open kind.
      lastIndex = TAG_RE.lastIndex
    } else {
      if (openKind === kind) {
        const inner = raw.slice(openContentStart, m.index)
        if (kind === 'stage') {
          const title = inner.trim()
          if (title) {
            items.push({ kind: 'stage', start: openStart, end: TAG_RE.lastIndex, closed: true, title })
          }
        } else {
          if (inner.trim()) {
            items.push({ kind: 'think', start: openStart, end: TAG_RE.lastIndex, closed: true, text: inner })
          }
        }
        openKind = null
      }
      lastIndex = TAG_RE.lastIndex
    }
  }

  // An still-open tag (streaming mid-stage/mid-think).
  if (openKind) {
    const inner = raw.slice(openContentStart)
    if (openKind === 'stage') {
      const title = inner.trim()
      if (title) {
        items.push({ kind: 'stage', start: openStart, end: raw.length, closed: false, title })
      }
    } else {
      if (inner.trim()) {
        items.push({ kind: 'think', start: openStart, end: raw.length, closed: false, text: inner })
      }
    }
  } else if (lastIndex < raw.length) {
    pushText(items, raw, lastIndex, raw.length)
  }

  return items
}

type Entry =
  | { kind: 'stage'; title: string; closed: boolean; live: boolean }
  | { kind: 'think'; text: string; closed: boolean; live: boolean }
  | { kind: 'text'; text: string; closed: boolean; live: boolean }
  | { kind: 'tool'; toolCall: ToolCallState }

export function buildTimeline(
  raw: string,
  toolCalls: ToolCallState[],
  toolCursors: Record<string, number>,
  working: boolean
): TimelineGroup[] {
  const units = parseUnitsWithSpans(raw)

  const toolsSorted = [...toolCalls].sort(
    (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)
  )
  const withCursor = toolsSorted.filter((t) => typeof toolCursors[t.id] === 'number')
  const withoutCursor = toolsSorted.filter((t) => typeof toolCursors[t.id] !== 'number')

  const entries: Entry[] = []
  const lastUnitIndex = units.length - 1

  const emitUnit = (unit: RawUnit, isLast: boolean): void => {
    const live = working && isLast && !unit.closed
    if (unit.kind === 'stage') {
      entries.push({ kind: 'stage', title: unit.title ?? '', closed: unit.closed, live })
    } else if (unit.kind === 'think') {
      entries.push({ kind: 'think', text: unit.text ?? '', closed: unit.closed, live })
    } else {
      entries.push({ kind: 'text', text: unit.text ?? '', closed: unit.closed, live })
    }
  }

  let ui = 0
  for (const tool of withCursor) {
    const cursor = toolCursors[tool.id]!
    // Emit every unit that started before this tool's cursor — those units
    // were already in the text stream when the tool call began.
    while (ui < units.length && units[ui].start < cursor) {
      emitUnit(units[ui], ui === lastUnitIndex)
      ui++
    }
    entries.push({ kind: 'tool', toolCall: tool })
  }
  // Remaining units (emitted after the last tool).
  for (; ui < units.length; ui++) {
    emitUnit(units[ui], ui === lastUnitIndex)
  }
  // Tools without a cursor (predating cursor tracking) go at the end.
  for (const tool of withoutCursor) {
    entries.push({ kind: 'tool', toolCall: tool })
  }

  // Group consecutive items under the most recent stage. A stage opens a new
  // group; everything after it (until the next stage) is its content.
  const groups: TimelineGroup[] = []
  let current: TimelineStageGroup | TimelineUngrouped | null = null
  for (const entry of entries) {
    if (entry.kind === 'stage') {
      if (current && current.items.length > 0) groups.push(current)
      current = { kind: 'stage', title: entry.title, closed: entry.closed, live: entry.live, items: [] }
    } else {
      if (!current) current = { kind: 'ungrouped', items: [] }
      current.items.push(
        entry.kind === 'tool'
          ? { kind: 'tool', toolCall: entry.toolCall }
          : entry.kind === 'think'
            ? { kind: 'think', text: entry.text, closed: entry.closed, live: entry.live }
            : { kind: 'text', text: entry.text, closed: entry.closed, live: entry.live }
      )
    }
  }
  if (current && (current.kind === 'stage' || current.items.length > 0)) {
    groups.push(current)
  }

  return groups
}
