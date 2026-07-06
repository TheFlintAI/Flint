import type { ContentBlock } from '../../api/types'
import { toonDecode } from '../../tools/tool-result-format'

export function appendThinkingToBlocks(blocks: ContentBlock[], thinking: string): void {
  const last = blocks[blocks.length - 1]
  if (last && last.type === 'thinking') {
    last.thinking += thinking
  } else {
    blocks.push({ type: 'thinking', thinking })
  }
}

export function appendThinkingEncryptedToBlocks(
  blocks: ContentBlock[],
  encryptedContent: string,
  provider: 'anthropic' | 'openai-responses' | 'google'
): void {
  if (!encryptedContent) return

  let target: Extract<ContentBlock, { type: 'thinking' }> | null = null
  let providerMatchedTarget: Extract<ContentBlock, { type: 'thinking' }> | null = null
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type !== 'thinking') continue

    if (!block.encryptedContent) {
      target = block
      break
    }

    if (!providerMatchedTarget && block.encryptedContentProvider === provider) {
      providerMatchedTarget = block
    }
  }

  if (!target && providerMatchedTarget) {
    target = providerMatchedTarget
  }

  if (target) {
    target.encryptedContent = encryptedContent
    target.encryptedContentProvider = provider
    return
  }

  blocks.push({
    type: 'thinking',
    thinking: '',
    encryptedContent,
    encryptedContentProvider: provider
  })
}

export function appendTextToBlocks(blocks: ContentBlock[], text: string): void {
  const last = blocks[blocks.length - 1]
  if (last && last.type === 'text') {
    last.text += text
  } else {
    blocks.push({ type: 'text', text })
  }
}

export function safeParseToolInput(str: string): Record<string, unknown> {
  // Try TOON first (internal format)
  try {
    const parsed = toonDecode(str)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to JSON
  }

  // Fall back to JSON (LLM API boundary — providers still emit JSON for tool calls)
  try {
    const parsed = JSON.parse(str)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}
