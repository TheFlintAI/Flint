/**
 * Layout component adapters — grid, row, col, heading, text.
 */

import * as React from 'react'
import type { VNode } from '@/lib/plugin/vnode-types'
import type { LocalizedString } from '@/lib/localized-string'
import { resolveLocalizedString } from '@/lib/localized-string'
import { Layout } from '../Layout'
import { registerAdapter, type AdapterContext } from './adapter-registry'

function t(text: LocalizedString, language: string): string {
  return resolveLocalizedString(text, language)
}

function renderChildren(node: VNode, ctx: AdapterContext): React.ReactNode {
  const children = node.children
  if (!children || children.length === 0) return null
  return children.map((child, i) => (
    <React.Fragment key={i}>{ctx.renderChild(child)}</React.Fragment>
  ))
}

registerAdapter('grid', {
  render(node: VNode, ctx: AdapterContext) {
    const cols = (node.props as { cols?: number })?.cols ?? 2
    return <Layout type="grid" cols={cols}>{renderChildren(node, ctx)}</Layout>
  },
})

registerAdapter('row', {
  render(node: VNode, ctx: AdapterContext) {
    return <Layout type="row">{renderChildren(node, ctx)}</Layout>
  },
})

registerAdapter('col', {
  render(node: VNode, ctx: AdapterContext) {
    return <Layout type="col">{renderChildren(node, ctx)}</Layout>
  },
})

registerAdapter('heading', {
  render(node: VNode, ctx: AdapterContext) {
    const text = (node.props as { text?: LocalizedString })?.text
    return <Layout type="heading" text={text ? t(text, ctx.language) : ''} />
  },
})

registerAdapter('text', {
  render(node: VNode, ctx: AdapterContext) {
    const text = (node.props as { text?: LocalizedString })?.text
    return <Layout type="text" text={text ? t(text, ctx.language) : ''} />
  },
})
