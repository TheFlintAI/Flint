import type {
  UnifiedMessage,
  ToolDefinition
} from '@/lib/api/types'

export interface TaskPromptSnapshot {
  systemPrompt: string
  toolDefs: ToolDefinition[]
  workingFolder?: string
  sshConnectionId?: string | null
  contextCacheKey?: string
}

export interface Task {
  id: string
  title: string
  messages: UnifiedMessage[]
  messageCount: number
  messagesLoaded: boolean
  loadedRangeStart: number
  loadedRangeEnd: number
  lastKnownMessageCount?: number
  createdAt: number
  updatedAt: number
  workingFolder?: string
  sshConnectionId?: string
  planId?: string
  pinned?: boolean
  /** Bound provider ID (null = use global active provider) */
  providerId?: string
  /** Bound model ID (null = use global active model) */
  modelId?: string
  /** In-memory prompt snapshot reused within the current app task */
  promptSnapshot?: TaskPromptSnapshot
}

export interface ImageGenerationTiming {
  startedAt: number
  completedAt?: number
}

export interface CreateTaskOptions {
  planId?: string | null
}
