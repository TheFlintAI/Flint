import type { ToolResultContent } from '@/lib/api/types'
import type { ToolCallStatus } from '@/lib/agent/types'

// Render state for a single tool call (shared with ContentRenderer)
export interface ToolCallRenderState {
  id: string
  toolUseId: string
  name: string
  input: Record<string, unknown>
  output?: ToolResultContent
  status: ToolCallStatus | 'completed'
  error?: string
  startedAt?: number
  completedAt?: number
}

// Props for ToolPanel
export interface ToolPanelProps {
  toolUseId?: string
  name: string
  input: Record<string, unknown>
  output?: ToolResultContent
  status: ToolCallStatus | 'completed'
  error?: string
  startedAt?: number
  completedAt?: number
}
