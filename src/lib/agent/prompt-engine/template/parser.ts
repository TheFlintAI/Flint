import type { Node, BlockNode, IfNode, EachNode, WithNode } from './ast'

// Tokens

interface TextToken {
  kind: 'text'
  value: string
}

interface TagToken {
  kind: 'tag'
  trimLeft: boolean
  trimRight: boolean
  /** Inner content between the braces, already trimmed of surrounding whitespace. */
  inner: string
}

type Token = TextToken | TagToken

const OPEN = '{{'
const CLOSE = '}}'

/**
 * Scan source into text/tag tokens. Handles escaped `\{{`, whitespace-trim
 * markers `{{~` / `~}}`, and `{{!-- ... --}}` comments (which may span lines
 * and contain `}}`).
 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let pendingTrimRight = false
  let buf = ''

  const flushText = (): void => {
    if (!buf) return
    let value = buf
    buf = ''
    if (pendingTrimRight) {
      value = value.replace(/^\s+/, '')
      pendingTrimRight = false
    }
    if (value) tokens.push({ kind: 'text', value })
  }

  while (i < src.length) {
    // Escaped mustache → literal text.
    if (src[i] === '\\' && src.startsWith(OPEN, i + 1)) {
      buf += OPEN
      i += OPEN.length + 1
      continue
    }
    if (!src.startsWith(OPEN, i)) {
      buf += src[i]
      i += 1
      continue
    }

    flushText()
    i += OPEN.length

    const trimLeft = src[i] === '~'
    if (trimLeft) i += 1

    // Comment: {{!-- ... --}} (optional trim markers on either side).
    if (src.startsWith('!--', i)) {
      let end: number
      let trimRightComment = false
      const tildeClose = src.indexOf('--~}}', i)
      const plainClose = src.indexOf('--}}', i)
      if (tildeClose !== -1 && (plainClose === -1 || tildeClose <= plainClose)) {
        end = tildeClose
        trimRightComment = true
        i = tildeClose + '--~}}'.length
      } else if (plainClose !== -1) {
        end = plainClose
        i = plainClose + '--}}'.length
      } else {
        // Unterminated comment — consume the rest.
        end = src.length
        i = end
      }
      void end
      if (trimLeft && tokens.length > 0) trimTrailingText(tokens)
      if (trimRightComment) pendingTrimRight = true
      continue
    }

    // Find closing `}}` (with optional `~}}`).
    let closeIdx = -1
    let trimRight = false
    for (let j = i; j < src.length - 1; j++) {
      if (src[j] === '~' && src.startsWith(CLOSE, j + 1)) {
        closeIdx = j
        trimRight = true
        break
      }
      if (src.startsWith(CLOSE, j)) {
        closeIdx = j
        break
      }
    }
    if (closeIdx === -1) {
      // No closing braces — emit as literal text.
      buf += OPEN
      continue
    }

    const inner = src.slice(i, closeIdx).trim()
    i = closeIdx + (trimRight ? 1 : 0) + CLOSE.length

    if (trimLeft && tokens.length > 0) trimTrailingText(tokens)
    if (trimRight) pendingTrimRight = true

    tokens.push({ kind: 'tag', trimLeft, trimRight, inner })
  }

  flushText()
  return tokens
}

function trimTrailingText(tokens: Token[]): void {
  for (let k = tokens.length - 1; k >= 0; k--) {
    const tok = tokens[k]
    if (tok.kind !== 'text') break
    const trimmed = tok.value.replace(/\s+$/, '')
    if (trimmed === '') {
      tokens.pop()
    } else {
      tok.value = trimmed
      break
    }
  }
}

// Parser

interface Frame {
  node: BlockNode
  inElse: boolean
}

class Parser {
  private tokens: Token[]
  private pos = 0
  private stack: Frame[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): Node[] {
    return this.parseBody()
  }

  private parseBody(): Node[] {
    const nodes: Node[] = []
    while (this.pos < this.tokens.length) {
      const tok = this.tokens[this.pos]
      if (tok.kind === 'text') {
        nodes.push({ type: 'text', value: tok.value })
        this.pos += 1
        continue
      }

      const head = tok.inner[0]
      if (head === '!') {
        // Comment tag {{!...}}.
        nodes.push({ type: 'comment' })
        this.pos += 1
        continue
      }
      if (head === '>') {
        nodes.push({ type: 'partial', name: tok.inner.slice(1).trim() })
        this.pos += 1
        continue
      }
      if (head === '/') {
        // Block close — handled by caller; signal end of this body.
        return nodes
      }
      if (head === '#') {
        this.pos += 1
        nodes.push(this.parseBlock(tok.inner))
        continue
      }
      const inner = tok.inner
      if (inner === 'else' || inner === '^') {
        // else marker — signal end of main body to caller.
        return nodes
      }

      nodes.push({ type: 'interpolation', expr: inner })
      this.pos += 1
    }
    return nodes
  }

  private parseBlock(inner: string): Node {
    const spaceIdx = inner.indexOf(' ')
    const tag = spaceIdx === -1 ? inner.slice(1) : inner.slice(1, spaceIdx)
    const expr = spaceIdx === -1 ? '' : inner.slice(spaceIdx + 1).trim()

    if (tag === 'if') {
      const body = this.parseBody()
      const elseBody = this.consumeElse()
      return this.closeBlock({ type: 'if', inverted: false, expr, body, elseBody }) as IfNode
    }
    if (tag === 'unless') {
      const body = this.parseBody()
      const elseBody = this.consumeElse()
      return this.closeBlock({ type: 'if', inverted: true, expr, body, elseBody }) as IfNode
    }
    if (tag === 'each') {
      const body = this.parseBody()
      const elseBody = this.consumeElse()
      return this.closeBlock({ type: 'each', expr, body, elseBody }) as EachNode
    }
    if (tag === 'with') {
      const body = this.parseBody()
      return this.closeBlock({ type: 'with', expr, body }) as WithNode
    }
    throw new Error(`Unknown block tag: #${tag}`)
  }

  /** After parsing a main body, peek for `else` and parse the else body. */
  private consumeElse(): Node[] {
    const tok = this.tokens[this.pos]
    if (!tok || tok.kind !== 'tag' || (tok.inner !== 'else' && tok.inner !== '^')) {
      return []
    }
    this.pos += 1
    return this.parseBody()
  }

  /** Pop the closing `/tag` token; validate it matches. */
  private closeBlock<T extends BlockNode>(node: T): T {
    const tok = this.tokens[this.pos]
    if (!tok || tok.kind !== 'tag' || tok.inner[0] !== '/') {
      throw new Error(`Unclosed block: expected closing tag for ${node.type}`)
    }
    this.pos += 1
    return node
  }
}

export function parse(src: string): Node[] {
  return new Parser(tokenize(src)).parse()
}
