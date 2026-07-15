import { nanoid } from 'nanoid'
import type { CompressionMeta, ProviderConfig, UnifiedMessage } from '../../api/types'
import { runTextRequest } from '@/lib/api/text-request'
import {
  RESPONSES_TASK_SCOPE_CONTEXT_COMPRESSION,
  withAuxiliaryResponsesRequestPolicy,
} from '@/lib/api/responses-task-policy'
import { createLogger } from '@/lib/logger'
import { renderSummarizerPrompt, renderCompressionRequest } from './prompts'
import { serializeForCompression } from './serialize'
import type { CompressionResult } from './threshold'

const log = createLogger('Compression')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether a message is a compression summary (inserted by auto or manual compression). */
export function isCompressionMessage(message: UnifiedMessage): boolean {
  return !!message.meta?.compression
}

/** Extract the plain-text content of a message. */
export function extractMessageText(message?: UnifiedMessage | null): string {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content.trim()
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

async function callSummarizer(
  serialized: string,
  providerConfig: ProviderConfig,
  signal?: AbortSignal,
  focusPrompt?: string,
  onChunk?: (text: string) => void,
): Promise<string> {
  const config: ProviderConfig = {
    ...providerConfig,
    systemPrompt: renderSummarizerPrompt(),
    thinkingEnabled: false,
  }

  const messages: UnifiedMessage[] = [
    {
      id: 'compress-req',
      role: 'user',
      content: renderCompressionRequest(serialized, focusPrompt),
      createdAt: Date.now(),
    },
  ]

  const result = await runTextRequest({
    provider: withAuxiliaryResponsesRequestPolicy(
      config,
      RESPONSES_TASK_SCOPE_CONTEXT_COMPRESSION,
    ),
    messages,
    signal,
    onChunk,
  })

  const trimmed = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!trimmed) {
    throw new Error('Summarization failed: empty result returned')
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createCompressionMessage(args: {
  summary: string
  messagesCompressed: number
  trigger?: CompressionMeta['trigger']
  preTokens?: number
}): UnifiedMessage {
  return {
    id: nanoid(),
    role: 'user',
    content: args.summary,
    createdAt: Date.now(),
    meta: {
      compression: {
        trigger: args.trigger ?? 'manual',
        messagesCompressed: args.messagesCompressed,
        preTokens: args.preTokens,
      },
    },
  }
}

function findOriginalTaskMessage(messages: UnifiedMessage[]): UnifiedMessage | null {
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (message.source === 'team') continue
    if (isCompressionMessage(message)) continue

    if (Array.isArray(message.content)) {
      const hasHumanContent = message.content.some(
        (block) => block.type === 'text' || block.type === 'image',
      )
      if (!hasHumanContent) continue
    }

    return message
  }
  return null
}

export async function compressMessages(
  messages: UnifiedMessage[],
  providerConfig: ProviderConfig,
  signal?: AbortSignal,
  focusPrompt?: string,
  pinnedContext?: string,
  trigger: CompressionMeta['trigger'] = 'manual',
  preTokens = 0,
  onChunk?: (text: string) => void,
): Promise<{ messages: UnifiedMessage[]; result: CompressionResult }> {
  const originalCount = messages.length

  const originalTask = findOriginalTaskMessage(messages)
  const serialized = serializeForCompression(
    messages,
    originalTask?.content,
    pinnedContext,
  )
  const summary = await callSummarizer(serialized, providerConfig, signal, focusPrompt, onChunk)

  if (!summary.trim()) {
    return {
      messages,
      result: { compressed: false, originalCount, newCount: originalCount },
    }
  }

  const compressionMessage = createCompressionMessage({
    summary,
    messagesCompressed: originalCount,
    trigger,
    preTokens,
  })

  return {
    messages: [compressionMessage],
    result: {
      compressed: true,
      originalCount,
      newCount: 1,
      messagesCompressed: originalCount,
    },
  }
}
