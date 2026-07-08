/**
 * Renders a VNode tree into React components using the adapter registry.
 *
 * Each VNode type has a registered adapter that handles localization,
 * type assertion, and component rendering. Error boundaries prevent
 * one bad component from crashing the entire tree.
 */

import * as React from 'react'
import type { VNode, FormActionData } from '@/lib/plugin/vnode-types'
import { getAdapter, type AdapterContext } from './adapters/adapter-registry'

// Import adapters (self-registering side effects)
import './adapters/display'
import './adapters/chart'
import './adapters/layout'
import './adapters/inputs'

interface VNodeRendererProps {
  node: VNode
  language: string
  /** Called when a form action is triggered (button click inside a form). */
  onFormAction?: (data: FormActionData) => void
}

// Error boundary — catches render errors in individual VNode components

interface ErrorBoundaryProps {
  type: string
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class VNodeErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[VNodeRenderer] Error rendering "${this.props.type}":`, error, info)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

// Main renderer

export const VNodeRenderer = React.memo(function VNodeRenderer({ node, language, onFormAction }: VNodeRendererProps): React.JSX.Element | null {
  if (!node || !node.type) return null

  const adapter = getAdapter(node.type)
  if (!adapter) {
    console.warn(`[VNodeRenderer] Unknown VNode type: "${node.type}"`)
    return null
  }

  const ctx: AdapterContext = {
    language,
    onFormAction,
    renderChild: (child: VNode) => (
      <VNodeRenderer node={child} language={language} onFormAction={onFormAction} />
    ),
  }

  return (
    <VNodeErrorBoundary type={node.type}>
      {adapter.render(node, ctx)}
    </VNodeErrorBoundary>
  )
})
