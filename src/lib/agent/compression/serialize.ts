import type { ContentBlock, UnifiedMessage } from '../../api/types'
import { toonEncode } from '../../tools/tool-result-format'

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export const THINKING_CLEARED = '[Thinking cleared]'

export function buildClearedToolResult(name: string, hint: string): string {
  const hintPart = hint.trim() ? ` ${hint.trim()}` : ''
  return `[Tool result cleared — ${name}${hintPart}; re-run the tool to regenerate]`
}

function formatToolCall(name: string, input: string): string {
  return `[Tool: ${name}] ${input}`
}

function formatToolResult(content: string, isError?: boolean): string {
  const tag = isError ? 'ERROR' : ''
  return `[Tool Result${tag ? ` ${tag}` : ''}]: ${content}`
}

export const IMAGE_PLACEHOLDER = '[Image]'

// ---------------------------------------------------------------------------
// Serialization config
// ---------------------------------------------------------------------------

const TOOL_INPUT_MAX = 500
const TOOL_RESULT_MAX = 800

// ---------------------------------------------------------------------------
// Block-level serialization
// ---------------------------------------------------------------------------

function serializeBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'thinking':
          return ''
        case 'tool_use':
          return formatToolCall(
            block.name,
            toonEncode(block.input).slice(0, TOOL_INPUT_MAX)
          )
        case 'tool_result': {
          const raw =
            typeof block.content === 'string'
              ? block.content
              : toonEncode(block.content)
          const preview =
            raw.length > TOOL_RESULT_MAX
              ? `${raw.slice(0, TOOL_RESULT_MAX)}\n... [truncated, ${raw.length} chars total]`
              : raw
          return formatToolResult(preview, block.isError)
        }
        case 'image':
          return IMAGE_PLACEHOLDER
        case 'image_error':
          return `[Image error: ${block.message}]`
        case 'agent_error':
          return `[Agent error: ${block.message}]`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Message-level serialization
// ---------------------------------------------------------------------------

function serializeMessage(message: UnifiedMessage): string {
  if (typeof message.content === 'string') {
    return message.content.trim()
  }
  return serializeBlocks(message.content)
}

function serializeMessages(messages: UnifiedMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    const text = serializeMessage(message)
    if (text) {
      parts.push(`[${message.role.toUpperCase()}]: ${text}`)
    }
  }
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build the full serialized input for the compression summarizer. */
export function serializeForCompression(
  messages: UnifiedMessage[],
  originalTaskContent?: UnifiedMessage['content'],
  pinnedContext?: string
): string {
  const parts: string[] = []

  if (originalTaskContent) {
    parts.push('## Original Task')
    parts.push(
      typeof originalTaskContent === 'string'
        ? originalTaskContent
        : serializeBlocks(originalTaskContent)
    )
  }

  if (pinnedContext?.trim()) {
    parts.push('## Pinned Plan Context')
    parts.push(pinnedContext.trim())
  }

  parts.push('## Full Conversation History')
  parts.push(serializeMessages(messages))

  return parts.join('\n\n')
}
