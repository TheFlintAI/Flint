/**
 * Agent lifecycle event types — dispatched to plugin Workers during the agent loop.
 */

export type AgentLifecycleEvent =
  | LoopStarted
  | LoopEnded
  | IterationStarted
  | IterationEnded
  | ThinkingDelta
  | TextDelta
  | ToolStarted
  | ToolCompleted
  | TokenUsage
  | ContextCompressed

export interface LoopStarted {
  type: 'loop:start'
  taskId: string
  timestamp: number
}

export interface LoopEnded {
  type: 'loop:end'
  taskId: string
  reason: string
  iterations: number
  timestamp: number
}

export interface IterationStarted {
  type: 'iteration:start'
  taskId: string
  iteration: number
  timestamp: number
}

export interface IterationEnded {
  type: 'iteration:end'
  taskId: string
  iteration: number
  toolCallCount: number
  timestamp: number
}

export interface ThinkingDelta {
  type: 'thinking:delta'
  taskId: string
  timestamp: number
}

export interface TextDelta {
  type: 'text:delta'
  taskId: string
  timestamp: number
}

export interface ToolStarted {
  type: 'tool:start'
  taskId: string
  toolName: string
  toolCallId: string
  timestamp: number
}

export interface ToolCompleted {
  type: 'tool:complete'
  taskId: string
  toolName: string
  toolCallId: string
  duration: number
  isError: boolean
  timestamp: number
}

export interface TokenUsage {
  type: 'token:usage'
  taskId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  timestamp: number
}

export interface ContextCompressed {
  type: 'context:compression'
  taskId: string
  originalCount: number
  newCount: number
  timestamp: number
}
