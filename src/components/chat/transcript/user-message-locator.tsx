import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { MessagesSquare } from 'lucide-react'
import type { UnifiedMessage } from '@/lib/api/types'
import type { TranscriptRow, PendingAskQuestion } from './types'
import { USER_LOCATOR_PREVIEW_LIMIT, USER_LOCATOR_SCROLL_OFFSET, USER_LOCATOR_HIGHLIGHT_MS } from './constants'

export type { PendingAskQuestion }

export interface UserMessageLocatorItem {
  id: string
  index: number
  preview: string
  time: string
  position: number
  sortOrder: number
}

export interface UserMessageLocatorSource {
  id: string
  content: UnifiedMessage['content']
  meta?: UnifiedMessage['meta']
  createdAt: number
  sortOrder: number
  source?: UnifiedMessage['source']
}

export interface UserMessageIndexRow {
  id: string
  task_id: string
  role: string
  content: string
  meta: string | null
  created_at: number
  sort_order: number
}

export function normalizeLocatorPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function truncateLocatorPreview(text: string): string {
  if (text.length <= USER_LOCATOR_PREVIEW_LIMIT) return text
  return `${text.slice(0, USER_LOCATOR_PREVIEW_LIMIT - 1).trimEnd()}...`
}

export function isSystemPromptText(text: string): boolean {
  return text.trim().toLowerCase().startsWith('<system')
}

export function getUserMessageText(content: UnifiedMessage['content']): string {
  if (typeof content === 'string') return isSystemPromptText(content) ? '' : content
  return content
    .filter(
      (block) =>
        block.type === 'text' && typeof block.text === 'string' && !isSystemPromptText(block.text)
    )
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

export function countImageBlocks(content: UnifiedMessage['content']): number {
  if (typeof content === 'string') return 0
  return content.filter((block) => block.type === 'image' || block.type === 'image_error').length
}

export function getLocatorMarkerTop(position: number): string {
  const clampedPosition = Math.min(1, Math.max(0, position))
  return `${6 + clampedPosition * 88}%`
}

export function formatLocatorTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function parseLocatorContent(rawContent: string): UnifiedMessage['content'] {
  try {
    const parsed = JSON.parse(rawContent)
    if (typeof parsed === 'string' || Array.isArray(parsed)) return parsed
  } catch {
    return rawContent
  }
  return ''
}

export function parseLocatorMeta(rawMeta: string | null): UnifiedMessage['meta'] {
  if (!rawMeta) return undefined
  try {
    return JSON.parse(rawMeta) as UnifiedMessage['meta']
  } catch {
    return undefined
  }
}

export function buildUserLocatorItem(
  source: UserMessageLocatorSource,
  index: number,
  messageCount: number,
  t: TFunction
): UserMessageLocatorItem | null {
  if (source.source === 'team' || source.meta?.compression) return null

  const textPreview = truncateLocatorPreview(
    normalizeLocatorPreview(getUserMessageText(source.content))
  )
  const imageCount = countImageBlocks(source.content)
  if (!textPreview && imageCount === 0) return null

  const fallbackPreview =
    imageCount > 0
      ? t('messageList.userLocator.imageMessage', {
          count: imageCount,
          defaultValue: imageCount === 1 ? 'Image message' : '{{count}} images'
        })
      : t('messageList.userLocator.emptyMessage', {
          defaultValue: 'Empty message'
        })

  return {
    id: source.id,
    index,
    preview: textPreview || fallbackPreview,
    time: formatLocatorTime(source.createdAt),
    position: messageCount > 1 ? source.sortOrder / (messageCount - 1) : 0,
    sortOrder: source.sortOrder
  }
}

export function findPendingAskUserQuestion(
  rows: TranscriptRow[],
  toolResultsLookup: Map<string, import('./types').ToolResultsLookup>,
  messageLookup: Map<string, UnifiedMessage>
): PendingAskQuestion | null {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex]
    if (row.type !== 'message') continue

    const message = messageLookup.get(row.data.messageId)
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue

    const toolResults = toolResultsLookup.get(row.data.messageId)
    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') continue
      if (toolResults?.has(block.id)) continue
      return { assistantMessageId: row.data.messageId, toolUseId: block.id }
    }
  }

  return null
}

export function UserMessageLocator({
  items,
  activeMessageId,
  onJump
}: {
  items: UserMessageLocatorItem[]
  activeMessageId?: string | null
  onJump: (item: UserMessageLocatorItem) => void
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')

  if (items.length < 2) return null

  return (
    <div className="absolute right-1 top-1/2 z-20 hidden -translate-y-1/2 md:block">
      <div className="group/user-locator relative flex h-[min(52vh,24rem)] items-center justify-end pl-7">
        <div className="relative h-full w-1.5 rounded-full bg-muted-foreground/10 transition-all duration-200 group-hover/user-locator:w-2 group-hover/user-locator:bg-muted-foreground/15 group-hover/user-locator:ring-1 group-hover/user-locator:ring-border/60">
          {items.map((item) => {
            const active = activeMessageId === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-label={t('messageList.userLocator.jumpLabel', {
                  index: item.index,
                  preview: item.preview,
                  defaultValue: 'Jump to user message {{index}}: {{preview}}'
                })}
                title={item.preview}
                className={`absolute right-0 h-1.5 -translate-y-1/2 rounded-full transition-all duration-200 ${
                  active
                    ? 'w-3 bg-foreground/80 ring-1 ring-foreground/10'
                    : 'w-1.5 bg-muted-foreground/30 hover:w-3 hover:bg-foreground/50'
                }`}
                style={{ top: getLocatorMarkerTop(item.position) }}
                onClick={() => onJump(item)}
              />
            )
          })}
        </div>

        <div className="pointer-events-none absolute right-3.5 top-1/2 w-[min(230px,calc(100vw-5rem))] -translate-y-1/2 translate-x-1.5 opacity-0 transition-all duration-200 group-hover/user-locator:pointer-events-auto group-hover/user-locator:translate-x-0 group-hover/user-locator:opacity-100">
          <div className="overflow-hidden rounded-lg border border-border/60 bg-popover/95 text-popover-foreground shadow-lg shadow-black/5 backdrop-blur-xl">
            <div className="flex items-center gap-1.5 px-3 py-2">
              <MessagesSquare className="size-3 text-foreground/70" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {t('messageList.userLocator.title', {
                  defaultValue: 'User messages'
                })}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums leading-none text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="max-h-[min(44vh,18rem)] overflow-y-auto p-1">
              {items.map((item) => {
                const active = activeMessageId === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                    onClick={() => onJump(item)}
                  >
                    <span
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-medium tabular-nums leading-none ${
                        active
                          ? 'bg-foreground text-background'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {item.index}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] leading-4">{item.preview}</span>
                      <span className="block text-[9px] leading-3 text-muted-foreground/65">
                        {item.time}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { USER_LOCATOR_HIGHLIGHT_MS, USER_LOCATOR_SCROLL_OFFSET }
