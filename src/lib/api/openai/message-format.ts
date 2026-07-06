import type {
  UnifiedMessage,
  ContentBlock
} from '../types'
import { sanitizeMessagesForToolReplay } from '../../tools/tool-input-sanitizer'
import { isComputerUseToolResultBlock } from './computer-use'

export function serializeToolResultOutput(
  content: Extract<ContentBlock, { type: 'tool_result' }>['content']
): string {
  if (Array.isArray(content)) {
    const textParts = content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
    const imageCount = content.filter((block) => block.type === 'image').length
    return (
      [...textParts, ...Array.from({ length: imageCount }, () => '[Image attached]')].join(
        '\n'
      ) || '[Image]'
    )
  }

  return content
}

export function normalizeMessagesForOpenAI(messages: UnifiedMessage[]): UnifiedMessage[] {
  const normalized: UnifiedMessage[] = []
  const validToolUseIds = new Set<string>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'system' || typeof message.content === 'string') {
      normalized.push(message)
      continue
    }

    const blocks = message.content as ContentBlock[]
    const replayableToolUseIds = new Set(
      blocks
        .filter(
          (block): block is Extract<ContentBlock, { type: 'tool_use' }> =>
            block.type === 'tool_use' &&
            block.extraContent?.openaiResponses?.computerUse?.kind !== 'computer_use'
        )
        .map((block) => block.id)
    )

    const pairedToolUseIds = new Set<string>()
    if (replayableToolUseIds.size > 0) {
      for (let j = index + 1; j < messages.length; j++) {
        const candidateMsg = messages[j]
        if (candidateMsg.role !== 'user' || !Array.isArray(candidateMsg.content)) break
        const candidateBlocks = candidateMsg.content as ContentBlock[]
        if (!candidateBlocks.some((b) => b.type === 'tool_result')) break
        for (const block of candidateBlocks) {
          if (block.type !== 'tool_result' || !replayableToolUseIds.has(block.toolUseId)) continue
          pairedToolUseIds.add(block.toolUseId)
          validToolUseIds.add(block.toolUseId)
        }
      }
    }

    const sanitizedBlocks = blocks.filter((block) => {
      if (
        block.type === 'tool_use' &&
        block.extraContent?.openaiResponses?.computerUse?.kind !== 'computer_use'
      ) {
        return pairedToolUseIds.has(block.id)
      }
      if (block.type !== 'tool_result') return true
      if (isComputerUseToolResultBlock(block, messages, message.id)) return true
      return validToolUseIds.has(block.toolUseId)
    })

    if (sanitizedBlocks.length === 0) continue
    normalized.push({ ...message, content: sanitizedBlocks })
  }

  return normalized
}

export function formatMessages(
  messages: UnifiedMessage[],
  systemPrompt?: string,
  includeEncryptedReasoning = false
): unknown[] {
  const input: unknown[] = []
  const normalizedMessages = normalizeMessagesForOpenAI(
    sanitizeMessagesForToolReplay(messages)
  )

  if (systemPrompt) {
    input.push({ type: 'message', role: 'developer', content: systemPrompt })
  }

  for (const m of normalizedMessages) {
    if (m.role === 'system') continue

    if (typeof m.content === 'string') {
      input.push({ type: 'message', role: m.role, content: m.content })
      continue
    }

    const blocks = m.content as ContentBlock[]

    if (m.role === 'user') {
      const parts: unknown[] = []
      const toolResults = blocks.filter(
        (block): block is Extract<ContentBlock, { type: 'tool_result' }> =>
          block.type === 'tool_result'
      )
      let emittedToolResult = false

      for (const toolResult of toolResults) {
        if (isComputerUseToolResultBlock(toolResult, normalizedMessages, m.id)) {
          continue
        }
        emittedToolResult = true
        input.push({
          type: 'function_call_output',
          call_id: toolResult.toolUseId,
          output: serializeToolResultOutput(toolResult.content)
        })
      }

      for (const b of blocks) {
        if (b.type === 'image') {
          const url =
            b.source.type === 'base64'
              ? `data:${b.source.mediaType || 'image/png'};base64,${b.source.data}`
              : b.source.url || ''
          parts.push({ type: 'input_image', image_url: url })
        } else if (b.type === 'text') {
          parts.push({ type: 'input_text', text: b.text })
        }
      }
      if (parts.length > 0) {
        input.push({ type: 'message', role: 'user', content: parts })
        continue
      }
      if (emittedToolResult) {
        continue
      }
    }

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          input.push({ type: 'message', role: m.role, content: block.text })
          break
        case 'image':
          break
        case 'thinking':
          if (
            includeEncryptedReasoning &&
            m.role === 'assistant' &&
            block.encryptedContent &&
            (block.encryptedContentProvider === 'openai-responses' ||
              !block.encryptedContentProvider)
          ) {
            input.push({
              type: 'reasoning',
              summary: block.thinking ? [{ type: 'summary_text', text: block.thinking }] : [],
              encrypted_content: block.encryptedContent
            })
          }
          break
        case 'tool_use':
          if (block.extraContent?.openaiResponses?.computerUse?.kind === 'computer_use') {
            break
          }
          input.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
            status: 'completed'
          })
          break
        case 'tool_result': {
          if (isComputerUseToolResultBlock(block, normalizedMessages, m.id)) {
            break
          }
          let output: string
          if (Array.isArray(block.content)) {
            const textParts = block.content
              .filter((cb) => cb.type === 'text')
              .map((cb) => (cb.type === 'text' ? cb.text : ''))
            const imageParts = block.content.filter((cb) => cb.type === 'image')
            output =
              [...textParts, ...imageParts.map(() => '[Image attached]')].join('\n') || '[Image]'
          } else {
            output = block.content
          }
          input.push({
            type: 'function_call_output',
            call_id: block.toolUseId,
            output
          })
          break
        }
      }
    }
  }

  return input
}
