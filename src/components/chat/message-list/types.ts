import type { ToolResultContent } from '@/lib/api/types'
import type { ChatRenderableMessageMeta } from '@/lib/chat/transcript-utils'

export type ToolResultsLookup = Map<string, { content: ToolResultContent; isError?: boolean }>

export type MessageListRow =
  | { type: 'pending-assistant'; key: string }
  | { type: 'message'; key: string; data: ChatRenderableMessageMeta }

export type AutoScrollMode = 'off' | 'user' | 'stream'

export interface AskUserQuestionPresence {
  assistantMessageId: string
  toolUseId: string
}

export interface MessageListProps {
  taskId?: string | null
  onRetry?: () => void
  onContinue?: () => void
  onDeleteMessage?: (messageId: string) => void
  onRollbackMessage?: (messageId: string) => void
}
