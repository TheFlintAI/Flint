/**
 * Tool render descriptor types — unified rendering model for ToolHandler.
 *
 * Every tool has a render descriptor that tells ToolPanel how to display it.
 * Two kinds:
 *   - native: React components, zero-overhead, used by built-in tools
 *   - remote: VNode-based, rendered in Web Worker, used by plugins
 */

import type { ReactNode } from 'react'
import type { VNode } from '@/lib/plugin/vnode-types'
import type { LocalizedString } from '@/lib/localized-string'
import type { ToolCallStatus } from '@/lib/agent/types'
import type { ToolResultContent } from '@/lib/api/types'

/** Context passed to every render function. */
export interface ToolPanelContext {
  toolUseId?: string
  name: string
  displayName: string
  input: Record<string, unknown>
  output?: ToolResultContent
  outputText?: string
  status: ToolCallStatus | 'completed'
  error?: string
  startedAt?: number
  completedAt?: number
  t: (key: string, opts?: Record<string, unknown>) => string
}

// Native render (built-in tools)

/** Inline variant: flat chip with no collapsible shell (e.g. Skill). */
export interface NativeInlineRender {
  kind: 'native-inline'
  render: (ctx: ToolPanelContext) => ReactNode
}

/** Panel variant: collapsible card with header + body + optional badges. */
export interface NativePanelRender {
  kind: 'native-panel'
  /** Icon + title + subtitle (no badges). */
  renderHeader: (ctx: ToolPanelContext) => ReactNode
  /** Badges rendered at the far right of the title bar. */
  renderBadges?: (ctx: ToolPanelContext) => ReactNode
  renderBody: (ctx: ToolPanelContext) => ReactNode
  expandWhileActive?: boolean
  expandForImages?: boolean
}

export type NativeToolRender = NativeInlineRender | NativePanelRender

// Remote render (plugin tools)

/** Remote variant: plugin tool with static header VNode. Body renders as raw text by default. */
export interface RemoteToolRender {
  kind: 'remote'
  pluginId: string
  toolName: string
  /** Static header VNode — set at registration time. */
  header: VNode
}

export type ToolRenderDescriptor = NativeToolRender | RemoteToolRender
