import type {
  UnifiedMessage,
  ToolResultContent
} from '@/lib/api/types'

export function extractMessagePlainText(message?: UnifiedMessage): string {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

export function extractToolResultText(content?: ToolResultContent): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is Extract<ToolResultContent[number], { type: 'text' }> =>
        block.type === 'text'
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

export function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim()
  }

  const error = record.error
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (error && typeof error === 'object') {
    const nestedError = error as Record<string, unknown>
    if (typeof nestedError.message === 'string' && nestedError.message.trim()) {
      return nestedError.message.trim()
    }
    if (typeof nestedError.error === 'string' && nestedError.error.trim()) {
      return nestedError.error.trim()
    }
  }

  return null
}

export function parseJsonErrorCandidate(candidate: string): unknown | null {
  const trimmed = candidate.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function normalizeContinuationErrorMessage(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return 'Tool continuation failed'

  const withoutHttpPrefix = trimmed.replace(/^HTTP\s+\d{3}:\s*/i, '').trim()
  const withoutProviderPrefix = withoutHttpPrefix
    .replace(/^(?:OpenAI response error|Response error|API error):\s*/i, '')
    .trim()

  for (const candidate of [withoutProviderPrefix, withoutHttpPrefix, trimmed]) {
    const parsed = parseJsonErrorCandidate(candidate)
    const extracted = extractApiErrorMessage(parsed)
    if (!extracted) continue
    if (/No tool output found for function call/i.test(extracted)) {
      return 'Model requests previous function call tool output, but no matching result in current task'
    }
    return extracted
  }

  if (/No tool output found for function call/i.test(withoutProviderPrefix)) {
    return 'Model requests previous function call tool output, but no matching result in current task'
  }

  return withoutProviderPrefix || withoutHttpPrefix || trimmed
}

export function shouldSuppressTransientRuntimeError(message: string | null | undefined): boolean {
  const normalized = message?.trim()
  if (!normalized) return false

  return (
    /CancellationTokenSource has been disposed/i.test(normalized) ||
    (/Cannot access a disposed object\./i.test(normalized) &&
      /CancellationTokenSource/i.test(normalized))
  )
}