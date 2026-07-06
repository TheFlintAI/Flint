import type { Node } from './ast'
import { hasHelper, callHelper, isTruthy } from './helpers'

// Compiled template + partials

export interface CompiledTemplate {
  readonly ast: Node[]
}

const partials = new Map<string, CompiledTemplate>()

export function registerPartial(name: string, template: CompiledTemplate): void {
  partials.set(name, template)
}

// Expression evaluation

/** Split an expression into tokens, respecting single/double quoted strings. */
function tokenizeExpr(expr: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      let str = ''
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === '\\' && j + 1 < expr.length) {
          str += expr[j + 1]
          j += 2
        } else {
          str += expr[j]
          j += 1
        }
      }
      tokens.push(quote + str + quote)
      i = j + 1
      continue
    }
    // Bare token until whitespace.
    let j = i
    while (j < expr.length && expr[j] !== ' ' && expr[j] !== '\t') j += 1
    tokens.push(expr.slice(i, j))
    i = j
  }
  return tokens
}

function resolveArg(tok: string, data: Record<string, unknown>): unknown {
  if (tok === 'true') return true
  if (tok === 'false') return false
  if (tok === 'null') return null
  if (tok === 'undefined') return undefined
  const first = tok[0]
  if (first === '"' || first === "'") {
    return tok.slice(1, -1)
  }
  if (first !== '@' && /^-?\d+(\.\d+)?$/.test(tok)) {
    return Number(tok)
  }
  return lookupPath(tok, data)
}

/** Resolve a dotted path against the merged data scope. */
function lookupPath(path: string, data: Record<string, unknown>): unknown {
  if (path === 'this') return data['this']
  const parts = path.split('.')
  let cur: unknown = data
  for (const part of parts) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function evalExpr(expr: string, data: Record<string, unknown>): unknown {
  const tokens = tokenizeExpr(expr)
  if (tokens.length === 0) return undefined
  // Helper call: first token is a known helper and there are arguments.
  if (tokens.length >= 2 && hasHelper(tokens[0])) {
    const args = tokens.slice(1).map((t) => resolveArg(t, data))
    return callHelper(tokens[0], args)
  }
  // Single-token helper with no args is not supported; treat as path.
  return lookupPath(tokens[0], data)
}

function stringify(v: unknown): string {
  if (v == null || typeof v === 'boolean') return ''
  if (typeof v === 'object') return ''
  return String(v)
}

// AST walk

function renderNodes(nodes: Node[], data: Record<string, unknown>): string {
  let out = ''
  for (const node of nodes) {
    out += renderNode(node, data)
  }
  return out
}

function renderNode(node: Node, data: Record<string, unknown>): string {
  switch (node.type) {
    case 'text':
      return node.value
    case 'comment':
      return ''
    case 'interpolation':
      return stringify(evalExpr(node.expr, data))
    case 'partial': {
      const partial = partials.get(node.name)
      if (!partial) return ''
      return renderNodes(partial.ast, data)
    }
    case 'if': {
      const value = isTruthy(evalExpr(node.expr, data))
      const branch = node.inverted ? !value : value
      return renderNodes(branch ? node.body : node.elseBody, data)
    }
    case 'each': {
      const collection = evalExpr(node.expr, data)
      if (!Array.isArray(collection) || collection.length === 0) {
        return renderNodes(node.elseBody, data)
      }
      let out = ''
      const last = collection.length - 1
      collection.forEach((item, index) => {
        const child: Record<string, unknown> = {
          ...data,
          this: item,
          '@index': index,
          '@first': index === 0,
          '@last': index === last
        }
        out += renderNodes(node.body, child)
      })
      return out
    }
    case 'with': {
      const value = evalExpr(node.expr, data)
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return ''
      }
      const child = { ...data, ...(value as Record<string, unknown>) }
      return renderNodes(node.body, child)
    }
    default:
      return ''
  }
}

export function render(template: CompiledTemplate, scope: Record<string, unknown>): string {
  return renderNodes(template.ast, scope)
}
