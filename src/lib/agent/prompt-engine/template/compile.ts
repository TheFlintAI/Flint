import type { Node } from './ast'
import { parse } from './parser'
import type { CompiledTemplate } from './render'

// Compile cache keyed by source. Sections compile once at module load.
const cache = new Map<string, CompiledTemplate>()

export function compile(src: string): CompiledTemplate {
  const cached = cache.get(src)
  if (cached) return cached
  const ast: Node[] = parse(src)
  const compiled: CompiledTemplate = { ast }
  cache.set(src, compiled)
  return compiled
}
