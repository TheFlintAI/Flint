import { compile, render } from './template'
import { buildScope } from './scope'
import { toolRegistry } from '../tool-registry'
import type { SectionContext } from './types'

/**
 * Compile a template once and return a render function bound to a section
 * context. Use at module load so each section pays the parse cost exactly once.
 */
export function tpl(src: string): (ctx: SectionContext) => string {
  const compiled = compile(src)
  return (ctx: SectionContext) => render(compiled, buildScope(ctx))
}

/** True when any tool in the given group is available for this agent. */
export function hasToolGroup(ctx: SectionContext, group: string): boolean {
  return toolRegistry.getToolNamesByGroup(group).some((name) => ctx.toolNames.includes(name))
}
