import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toolRegistry } from '@/lib/agent/tool-registry'
import type {
  ToolPanelContext,
  NativePanelRender,
  RemoteToolRender,
} from '@/lib/tools/tool-render-types'
import type { ToolPanelProps } from './types'
import { ToolShell } from './ToolShell'
import {
  areToolPanelPropsEqual
} from './utils'
import { VNodeRenderer } from '@/components/plugins/ui-renderer/VNodeRenderer'
import type { VNode } from '@/lib/plugin/vnode-types'
import { getWorkerManager } from '@/stores/plugin-store'
import { usePanelContext } from './use-panel-context'
import { TrailingStatus } from './TrailingStatus'

function ToolPanelInner(props: ToolPanelProps): React.JSX.Element | null {
  const ctx = usePanelContext(props)
  const handler = toolRegistry.get(props.name)

  if (!handler) {
    return <UnknownToolPanel ctx={ctx} />
  }

  const { render } = handler

  if (render.kind === 'native-inline') {
    return <div className="my-1.5 min-w-0 overflow-hidden">{render.render(ctx)}</div>
  }

  if (render.kind === 'native-panel') {
    return <NativePanelShell ctx={ctx} render={render} status={props.status} />
  }

  if (render.kind === 'native-card') {
    // Card tools render via ToolCard, not ToolPanel
    return <UnknownToolPanel ctx={ctx} />
  }

  // render.kind === 'remote'
  return <RemotePanelShell ctx={ctx} render={render} status={props.status} />
}

function NativePanelShell({
  ctx,
  render,
  status,
}: {
  ctx: ToolPanelContext
  render: NativePanelRender
  status: ToolPanelProps['status']
}): React.JSX.Element {
  const { output } = ctx
  const isProcessing = status === 'streaming' || status === 'running'
  const isActive = isProcessing

  return (
    <ToolShell
      isActive={isActive}
      isProcessing={isProcessing}
      output={output}
      expandWhileActive={render.expandWhileActive}
      expandForImages={render.expandForImages}
      header={render.renderHeader(ctx)}
      body={render.renderBody(ctx)}
      trailing={(open) => (
        <TrailingStatus
          status={ctx.status}
          error={ctx.error}
          startedAt={ctx.startedAt}
          completedAt={ctx.completedAt}
          open={open}
          toolName={ctx.name}
        />
      )}
    />
  )
}

function RemotePanelShell({
  ctx,
  render,
  status,
}: {
  ctx: ToolPanelContext
  render: RemoteToolRender
  status: ToolPanelProps['status']
}): React.JSX.Element {
  const [bodyVNode, setBodyVNode] = React.useState<VNode | null>(null)
  const { i18n } = useTranslation()
  const isProcessing = status === 'streaming' || status === 'running'
  const isActive = isProcessing

  // Fetch body VNode from plugin Worker when output/status changes
  React.useEffect(() => {
    let cancelled = false
    const wm = getWorkerManager()
    if (!wm) return

    wm.sendRequest(render.pluginId, 'tool.renderBody', {
      name: render.toolName,
      ctx: {
        input: ctx.input,
        output: ctx.output,
        outputText: ctx.outputText,
        status: ctx.status,
        error: ctx.error,
      },
    }).then((result) => {
      if (!cancelled && result) setBodyVNode(result as VNode)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [render.pluginId, render.toolName, ctx.output, ctx.status, ctx.outputText, ctx.error, ctx.input])

  return (
    <ToolShell
      isActive={isActive}
      isProcessing={isProcessing}
      header={<VNodeRenderer node={render.header} language={i18n.language} />}
      body={
        bodyVNode
          ? <VNodeRenderer node={bodyVNode} language={i18n.language} />
          : <DefaultBody ctx={ctx} />
      }
      trailing={(open) => (
        <TrailingStatus
          status={ctx.status}
          error={ctx.error}
          startedAt={ctx.startedAt}
          completedAt={ctx.completedAt}
          open={open}
          toolName={ctx.name}
        />
      )}
    />
  )
}

function UnknownToolPanel({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  return (
    <div className="my-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[12px] text-muted-foreground">
      <span className="font-medium">{ctx.displayName}</span>
    </div>
  )
}

function DefaultBody({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  if (!ctx.outputText && !ctx.error) {
    return <span className="text-[11px]">{ctx.t('toolCall.noOutputYet')}</span>
  }
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground/80">
      {ctx.error || ctx.outputText || ''}
    </pre>
  )
}

export const ToolPanel = React.memo(ToolPanelInner, areToolPanelPropsEqual)
ToolPanel.displayName = 'ToolPanel'
