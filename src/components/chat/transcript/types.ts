import type { ToolResultContent } from '@/lib/api/types'
import type { ChatRenderableMessageMeta } from '@/lib/chat/transcript-utils'

export type ToolResultsLookup = Map<string, { content: ToolResultContent; isError?: boolean }>

export type TranscriptRow =
  | { type: 'pending-assistant'; key: string }
  | { type: 'message'; key: string; data: ChatRenderableMessageMeta }

export interface PendingAskQuestion {
  assistantMessageId: string
  toolUseId: string
}

export interface TranscriptScrollerProps {
  taskId?: string | null
  onRetry?: () => void
  onContinue?: () => void
  onDeleteMessage?: (messageId: string) => void
  onRollbackMessage?: (messageId: string) => void
}
