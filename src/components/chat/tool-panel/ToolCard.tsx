import * as React from 'react'
import { ToolPanelLead, ToolIcon } from './parts'
import { toolRegistry } from '@/lib/agent/tool-registry'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import { usePanelContext } from './use-panel-context'

/**
 * Renders tools with `kind: 'native-card'` render descriptors.
 * Cards own their shell entirely — no collapsible wrapper, no status pill.
 * The card render function receives the full ToolPanelContext.
 */
export function ToolCard({
  toolUseId,
  name,
  input,
  output,
  status,
  error,
  startedAt,
  completedAt,
}: {
  toolUseId?: string
  name: string
  input: Record<string, unknown>
  output?: unknown
  status: string
  error?: string
  startedAt?: number
  completedAt?: number
}): React.JSX.Element | null {
  const ctx = usePanelContext({
    toolUseId,
    name,
    input,
    output: output as any,
    status: status as any,
    error,
    startedAt,
    completedAt,
  })

  const handler = toolRegistry.get(name)
  if (!handler || handler.render.kind !== 'native-card') {
    // Fallback: show basic info if render descriptor is missing
    return (
      <div className="rounded-lg border border-border/40 px-3 py-2 text-[12px] text-muted-foreground">
        <ToolPanelLead
          icon={<ToolIcon name={name} />}
          title={ctx.displayName}
          titleAttr={ctx.displayName}
        />
      </div>
    )
  }

  return <>{handler.render.render(ctx)}</>
}
