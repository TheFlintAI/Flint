import { useProviderStore } from '@/stores/provider-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import type { ProviderConfig } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('AutoTitle')
export interface TaskTitleResult {
  title: string
}

export type FriendlyStatus = 'idle' | 'pending' | 'error' | 'streaming' | 'agents' | 'background'

const FRIENDLY_MESSAGES: Record<FriendlyStatus, { zh: string[]; en: string[] }> = {
  idle: {
    zh: [
      '随时准备为你效劳',
      '有什么想法，尽管说',
      '今天也是元气满满的一天',
      '准备就绪，等你发令',
      '万事俱备，只欠你开口',
      '灵感来了就别犹豫',
      '你的专属助手已上线',
      '静候佳音'
    ],
    en: [
      'Ready when you are',
      'What shall we build today?',
      'Standing by for your ideas',
      'All systems go',
      'Your assistant is ready',
      'Inspiration awaits',
      "Let's get things done",
      'At your service'
    ]
  },
  streaming: {
    zh: ['思考中，请稍候', '正在组织回答', '全力运转中', '马上就好', '正在为你解答', '灵感涌来中'],
    en: [
      'Thinking...',
      'Working on it',
      'Almost there',
      'Processing your request',
      'Crafting a response',
      'On it'
    ]
  },
  pending: {
    zh: ['等待你的确认', '需要你看一下', '请审批操作', '操作待确认'],
    en: [
      'Waiting for your approval',
      'Action needs confirmation',
      'Please review',
      'Approval needed'
    ]
  },
  error: {
    zh: ['遇到了一点问题', '出了点小状况', '别担心，我们来看看', '需要你关注一下'],
    en: ['Something went wrong', 'Hit a snag', "Let's take a look", 'Needs your attention']
  },
  agents: {
    zh: ['团队协作中', '多个助手协同工作中', '正在并行处理'],
    en: ['Team is collaborating', 'Working in parallel', 'Agents are on it']
  },
  background: {
    zh: ['后台任务运行中', '命令执行中', '后台进程工作中'],
    en: ['Background tasks running', 'Commands in progress', 'Working in the background']
  }
}

const lastPickIndex: Record<string, number> = {}

export function pickFriendlyMessage(status: FriendlyStatus, language: 'zh' | 'en'): string {
  const pool = FRIENDLY_MESSAGES[status]?.[language] ?? FRIENDLY_MESSAGES.idle[language]
  const key = `${status}_${language}`
  const prevIdx = lastPickIndex[key] ?? -1
  let idx = Math.floor(Math.random() * pool.length)
  if (pool.length > 1 && idx === prevIdx) idx = (idx + 1) % pool.length
  lastPickIndex[key] = idx
  return pool[idx]
}

const stripReasoningBlocks = (value: string): string =>
  value.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/<\/think>/gi, '')

const stripMarkdown = (value: string): string =>
  value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')

const looksLikeReasoning = (value: string): boolean => {
  const markers = [
    /思考过程/,
    /分析.*指令/,
    /\*\*目标\*\*/,
    /步骤\s*\d/,
    /^(?:\d+\.\s)/m,
    /^\s*[-*]\s+\*\*/m
  ]
  return markers.filter((r) => r.test(value)).length >= 2
}

const TITLE_SYSTEM_PROMPT = `You are a JSON title generator. Given a user message, output ONLY a single JSON object with a short title (max 30 chars).

Output format (JSON only, no markdown, no explanation):
{"title":"concise summary here"}`

/**
 * Use the auxiliary model to generate a short task title from a user message or conversation excerpt.
 * Runs in the background — does not block the main chat flow.
 * Returns { title, icon } or null on failure.
 */
export async function generateTaskTitle(
  userMessage: string,
  options?: {
    maxInputChars?: number
  }
): Promise<TaskTitleResult | null> {
  const raw = await requestAuxCompletion({
    systemPrompt: TITLE_SYSTEM_PROMPT,
    userPrompt: userMessage,
    maxTokens: 400,
    temperature: 0.3,
    maxInputChars: options?.maxInputChars ?? 500
  })
  if (!raw) return null
  return extractTitleFromText(raw)
}

export interface AuxCompletionOptions {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
  maxInputChars?: number
}

/**
 * Shared non-streaming call to the auxiliary model. Returns the raw text
 * content, or null when no provider is configured / the request fails.
 */
export async function requestAuxCompletion(
  opts: AuxCompletionOptions
): Promise<string | null> {
  const providerStore = useProviderStore.getState()
  const auxConfig = providerStore.getAuxProviderConfig()
  const activeConfig = !auxConfig ? providerStore.getActiveProviderConfig() : null
  const sourceConfig = auxConfig ?? activeConfig
  if (!sourceConfig) {
    log.warn('No provider config available')
    return null
  }

  const config: ProviderConfig = {
    ...sourceConfig,
    maxTokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.3,
    systemPrompt: opts.systemPrompt
  }

  try {
    const isAnthropic = config.type === 'anthropic'
    const baseUrl = (config.baseUrl || (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'))
      .trim()
      .replace(/\/+$/, '')

    if (isAnthropic) {
      return await requestViaAnthropic(baseUrl, config, opts.userPrompt, opts.maxInputChars)
    }
    return await requestViaOpenAI(baseUrl, config, opts.userPrompt, opts.maxInputChars)
  } catch (err) {
    log.warn('Request failed', err)
    return null
  }
}

async function requestViaOpenAI(
  baseUrl: string,
  config: ProviderConfig,
  userMessage: string,
  maxInputChars?: number
): Promise<string | null> {
  const chatBody: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: config.systemPrompt ?? '' },
      { role: 'user', content: userMessage.slice(0, maxInputChars ?? 500) }
    ],
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
    // Force structured JSON output
    response_format: { type: 'json_object' }
  }

  const response = await tauriCommands.invoke<{
    success: boolean
    statusCode: number
    headers: Record<string, string>
    body: string
  }>('api:request', {
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(chatBody),
    timeout_ms: 15000
  })

  if (!response?.success || response.statusCode !== 200) {
    log.warn('Non-stream request failed', {
      statusCode: response?.statusCode,
      body: response?.body?.slice(0, 500)
    })
    return null
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(response.body)
  } catch {
    log.warn('Failed to parse response JSON')
    return null
  }
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
  return ((choice?.message as Record<string, string> | undefined)?.content ?? '') as string
}

async function requestViaAnthropic(
  baseUrl: string,
  config: ProviderConfig,
  userMessage: string,
  maxInputChars?: number
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'user', content: userMessage.slice(0, maxInputChars ?? 500) }
    ],
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: config.systemPrompt ?? '',
    // Disable extended thinking for auxiliary generation
    thinking: { type: 'disabled' }
  }

  const response = await tauriCommands.invoke<{
    success: boolean
    statusCode: number
    headers: Record<string, string>
    body: string
  }>('api:request', {
    url: `${baseUrl}/v1/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    timeout_ms: 15000
  })

  if (!response?.success || response.statusCode !== 200) {
    log.warn('Anthropic request failed', {
      statusCode: response?.statusCode,
      body: response?.body?.slice(0, 500)
    })
    return null
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(response.body)
  } catch {
    log.warn('Failed to parse Anthropic response JSON')
    return null
  }

  // Anthropic response format: { content: [{ type: "text", text: "..." }] }
  const contentBlocks = data.content as Array<Record<string, unknown>> | undefined
  const textBlock = contentBlocks?.find((b) => b.type === 'text')
  return (textBlock?.text as string) ?? ''
}

export function extractTitleFromText(rawText: string, maxLen = 40): TaskTitleResult | null {
  if (looksLikeReasoning(rawText)) return null

  const cleaned = stripReasoningBlocks(rawText)
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')
    .trim()
  if (!cleaned) return null

  try {
    const jsonMatch =
      cleaned.match(/\{[^{}]*"title"\s*:\s*"[^"]*"[^{}]*\}/) ?? cleaned.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.title) {
        let t = stripMarkdown(stripReasoningBlocks(String(parsed.title)))
          .replace(/^["']|["']$/g, '')
          .replace(/\n+/g, ' ')
          .trim()
        if (t.length > maxLen) t = t.slice(0, maxLen) + '...'
        return { title: t }
      }
    }
  } catch {
    /* fall through to plain-text fallback */
  }

  let plainTitle = stripMarkdown(stripReasoningBlocks(cleaned))
    .replace(/^["']|["']$/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  if (plainTitle.length > maxLen) plainTitle = plainTitle.slice(0, maxLen) + '...'
  return { title: plainTitle }
}
