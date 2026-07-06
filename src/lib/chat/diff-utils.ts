// Diff types

export interface DiffLine {
  type: 'keep' | 'add' | 'del'
  text: string
  oldNum?: number
  newNum?: number
}

export type DiffChunk =
  | { type: 'lines'; lines: DiffLine[] }
  | { type: 'collapsed'; count: number; lines: DiffLine[] }

// String helpers

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export function lineCount(text: string): number {
  const normalized = normalizeLineEndings(text)
  return normalized.length === 0 ? 0 : normalized.split('\n').length
}

// Diff computation

function computeLargeDiff(a: string[], b: string[]): DiffLine[] {
  const result: DiffLine[] = []
  const m = a.length
  const n = b.length

  let start = 0
  while (start < m && start < n && a[start] === b[start]) {
    result.push({ type: 'keep', text: a[start], oldNum: start + 1, newNum: start + 1 })
    start += 1
  }

  let endA = m - 1
  let endB = n - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1
    endB -= 1
  }

  for (let index = start; index <= endA; index += 1) {
    result.push({ type: 'del', text: a[index], oldNum: index + 1 })
  }

  for (let index = start; index <= endB; index += 1) {
    result.push({ type: 'add', text: b[index], newNum: index + 1 })
  }

  for (let offset = 1; endA + offset < m && endB + offset < n; offset += 1) {
    result.push({
      type: 'keep',
      text: a[endA + offset],
      oldNum: endA + offset + 1,
      newNum: endB + offset + 1
    })
  }

  return result
}

export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const a = normalizeLineEndings(oldStr).split('\n')
  const b = normalizeLineEndings(newStr).split('\n')
  const m = a.length
  const n = b.length

  if (m * n > 100000) {
    return computeLargeDiff(a, b)
  }

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const result: DiffLine[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: 'keep', text: a[i - 1], oldNum: i, newNum: j })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', text: b[j - 1], newNum: j })
      j -= 1
    } else {
      result.push({ type: 'del', text: a[i - 1], oldNum: i })
      i -= 1
    }
  }

  return result.reverse()
}

export function summarizeDiff(lines: DiffLine[]): { added: number; deleted: number } {
  return lines.reduce(
    (acc, line) => {
      if (line.type === 'add') acc.added += 1
      if (line.type === 'del') acc.deleted += 1
      return acc
    },
    { added: 0, deleted: 0 }
  )
}

export function foldContext(lines: DiffLine[], ctx: number = 2): DiffChunk[] {
  const chunks: DiffChunk[] = []
  let keepRun: DiffLine[] = []

  const flushKeep = (): void => {
    if (keepRun.length <= ctx * 2 + 1) {
      chunks.push({ type: 'lines', lines: keepRun })
    } else {
      chunks.push({ type: 'lines', lines: keepRun.slice(0, ctx) })
      chunks.push({
        type: 'collapsed',
        count: keepRun.length - ctx * 2,
        lines: keepRun.slice(ctx, -ctx)
      })
      chunks.push({ type: 'lines', lines: keepRun.slice(-ctx) })
    }
    keepRun = []
  }

  for (const line of lines) {
    if (line.type === 'keep') {
      keepRun.push(line)
    } else {
      if (keepRun.length > 0) flushKeep()
      if (chunks.length > 0 && chunks[chunks.length - 1].type === 'lines') {
        ;(chunks[chunks.length - 1] as { type: 'lines'; lines: DiffLine[] }).lines.push(line)
      } else {
        chunks.push({ type: 'lines', lines: [line] })
      }
    }
  }

  if (keepRun.length > 0) flushKeep()
  return chunks
}

export function diffDisplayLineNumber(line: DiffLine): number | undefined {
  if (line.type === 'del') return line.oldNum
  return line.newNum ?? line.oldNum
}

export function buildDiffCopyText(lines: DiffLine[]): string {
  return lines
    .map((line) => {
      const lineNumber = diffDisplayLineNumber(line)
      const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
      return `${lineNumber ?? ''}\t${marker}${line.text}`
    })
    .join('\n')
}
