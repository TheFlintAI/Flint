import type { UnifiedMessage, ContentBlock, ToolUseBlock } from '@/lib/api/types'

export function isToolResultOnlyUserMessage(message: UnifiedMessage): boolean {
  return (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.every((block) => block.type === 'tool_result')
  )
}

export function stripTrailingAssistantAgentErrors(messages: UnifiedMessage[]): {
  messages: UnifiedMessage[]
  changed: boolean
} {
  if (messages.length === 0) {
    return { messages, changed: false }
  }

  const trimmedMessages = [...messages]
  let changed = false
  while (trimmedMessages.length > 0) {
    const lastMessage = trimmedMessages[trimmedMessages.length - 1]
    if (lastMessage.role !== 'assistant' || !Array.isArray(lastMessage.content)) break

    const filteredBlocks = lastMessage.content.filter((block) => block.type !== 'agent_error')
    if (filteredBlocks.length === lastMessage.content.length) break

    changed = true
    if (filteredBlocks.length === 0) {
      trimmedMessages.pop()
      continue
    }

    trimmedMessages[trimmedMessages.length - 1] = { ...lastMessage, content: filteredBlocks }
    break
  }

  return changed ? { messages: trimmedMessages, changed: true } : { messages, changed: false }
}

export function sanitizeToolReplayConsistency(messages: UnifiedMessage[]): {
  messages: UnifiedMessage[]
  changed: boolean
} {
  if (messages.length === 0) {
    return { messages, changed: false }
  }

  const validToolUseIds = new Set<string>()
  const pairedToolUseIdsByAssistantIndex = new Map<number, Set<string>>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue

    const blocks = message.content as ContentBlock[]
    const toolUseIds = new Set(
      blocks
        .filter((block): block is ToolUseBlock => block.type === 'tool_use')
        .map((block) => block.id)
    )
    if (toolUseIds.size === 0) continue

    const pairedToolUseIds = new Set<string>()
    for (let candidateIndex = index + 1; candidateIndex < messages.length; candidateIndex += 1) {
      const candidateMessage = messages[candidateIndex]
      if (candidateMessage.role !== 'user' || !Array.isArray(candidateMessage.content)) break

      const candidateBlocks = candidateMessage.content as ContentBlock[]
      if (!candidateBlocks.some((block) => block.type === 'tool_result')) break

      for (const block of candidateBlocks) {
        if (block.type !== 'tool_result' || !toolUseIds.has(block.toolUseId)) continue
        pairedToolUseIds.add(block.toolUseId)
        validToolUseIds.add(block.toolUseId)
      }
    }

    pairedToolUseIdsByAssistantIndex.set(index, pairedToolUseIds)
  }

  let changed = false
  const sanitizedMessages: UnifiedMessage[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!Array.isArray(message.content)) {
      sanitizedMessages.push(message)
      continue
    }

    const pairedToolUseIds = pairedToolUseIdsByAssistantIndex.get(index)
    const filteredBlocks = (message.content as ContentBlock[]).filter((block) => {
      if (block.type === 'tool_use') {
        return pairedToolUseIds ? pairedToolUseIds.has(block.id) : true
      }
      if (block.type === 'tool_result') {
        return validToolUseIds.has(block.toolUseId)
      }
      return true
    })

    if (filteredBlocks.length === message.content.length) {
      sanitizedMessages.push(message)
      continue
    }

    changed = true
    if (filteredBlocks.length === 0) continue
    sanitizedMessages.push({ ...message, content: filteredBlocks })
  }

  return changed ? { messages: sanitizedMessages, changed: true } : { messages, changed: false }
}

export function sanitizeToolBlocksForResend(messages: UnifiedMessage[]): {
  messages: UnifiedMessage[]
  changed: boolean
} {
  if (messages.length === 0) {
    return { messages, changed: false }
  }

  const trimmed = stripTrailingAssistantAgentErrors(messages)
  const sanitized = sanitizeToolReplayConsistency(trimmed.messages)

  if (!trimmed.changed && !sanitized.changed) {
    return { messages, changed: false }
  }

  return { messages: sanitized.messages, changed: true }
}
