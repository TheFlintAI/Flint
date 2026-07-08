/**
 * VNode adapter registry — maps VNode type strings to adapter render functions.
 *
 * Each adapter handles localization + type assertion + component rendering
 * for one or more VNode types. Adding a new component = register one adapter.
 */

import * as React from 'react'
import type { VNode, FormActionData } from '@/lib/plugin/vnode-types'

export interface AdapterContext {
  language: string
  onFormAction?: (data: FormActionData) => void
  renderChild: (node: VNode) => React.ReactNode
}

export interface VNodeAdapter {
  render(node: VNode, ctx: AdapterContext): React.ReactNode
}

// Registry

const adapters = new Map<string, VNodeAdapter>()

export function registerAdapter(type: string, adapter: VNodeAdapter): void {
  adapters.set(type, adapter)
}

export function getAdapter(type: string): VNodeAdapter | undefined {
  return adapters.get(type)
}
