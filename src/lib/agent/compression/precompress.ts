import type { ContentBlock, UnifiedMessage } from '../../api/types'
import { toonEncode } from '../../tools/tool-result-format'
import { THINKING_CLEARED, buildClearedToolResult } from './serialize'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const KEEP_RECENT = 6
const CLEAR_CHAR_THRESHOLD = 200

// ---------------------------------------------------------------------------
// Tool-use reference map
// ---------------------------------------------------------------------------

interface ToolUseRef {
  name: string
  hint: string
}

function resolveHint(name: string, input: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'LS':
      return str(input.file_path) || str(input.path)
    case 'Glob': case 'Grep':
      return str(input.pattern) || str(input.path)
    case 'Bash':
      return str(input.command)
    case 'WebSearch':
      return str(input.query)
    case 'WebFetch':
      return str(input.url)
    default:
      return ''
  }
}

function buildToolUseRefMap(messages: UnifiedMessage[]): Map<string, ToolUseRef> {
  const map = new Map<string, ToolUseRef>()
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.id) {
        const input = (block.input ?? {}) as Record<string, unknown>
        map.set(block.id, { name: block.name, hint: resolveHint(block.name, input) })
      }
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clear large tool results and thinking blocks from older messages.
 * Only the most recent messages are left untouched.
 * Used as a lightweight pre-compression step before full AI summarization.
 */
export function preCompressMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  if (messages.length <= KEEP_RECENT) return messages

  const cutoff = messages.length - KEEP_RECENT
  const toolUseRefs = buildToolUseRefMap(messages)

  return messages.map((message, index) => {
    if (index >= cutoff) return message
    if (typeof message.content === 'string') return message

    let changed = false
    const newBlocks = message.content.map((block) => {
      if (block.type === 'tool_result') {
        const content =
          typeof block.content === 'string' ? block.content : toonEncode(block.content)
        if (content.length > CLEAR_CHAR_THRESHOLD) {
          changed = true
          const ref = block.toolUseId ? toolUseRefs.get(block.toolUseId) : undefined
          return {
            ...block,
            content: ref
              ? buildClearedToolResult(ref.name, ref.hint)
              : buildClearedToolResult('tool', ''),
          }
        }
      }

      if (block.type === 'thinking') {
        changed = true
        return { ...block, thinking: THINKING_CLEARED }
      }

      if (block.type === 'image') {
        changed = true
        return { type: 'text', text: '[image]' } as ContentBlock
      }

      return block
    })

    return changed ? { ...message, content: newBlocks } : message
  })
}
