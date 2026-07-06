import type { ToolDefinition, ToolResultContent } from '../api/types'
import type { ToolHandler, ToolContext } from '../tools/tool-types'
import { encodeToolError } from '../tools/tool-result-format'
import { createLogger } from '@/lib/logger'
import { Registry } from './registry'

const log = createLogger('ToolRegistry')

/**
 * Tool Registry — manages tool handlers backed by the generic Registry base.
 * New tools are added by calling register() without modifying core code.
 */
class ToolRegistry extends Registry<ToolHandler> {
  private definitionsCache: ToolDefinition[] | null = []

  protected override invalidate(): void {
    super.invalidate()
    this.definitionsCache = null
  }

  add(handler: ToolHandler): void {
    super.register(handler.definition.name, handler)
    log.info(`[add] tool="${handler.definition.name}" total=${this.items.size}`)
  }

  getDefinitions(): ToolDefinition[] {
    if (!this.definitionsCache) {
      this.definitionsCache = this.getAll().map((t) => t.definition)
      const names = this.getAll().map(t => t.definition.name)
      log.info(`[getDefinitions] cache rebuilt: ${this.definitionsCache.length} tool(s) — ${names.join(', ')}`)
    }
    return this.definitionsCache
  }

  getToolNamesByGroup(group: string): string[] {
    const names: string[] = []
    for (const [name, handler] of this.items) {
      if (handler.groups?.includes(group)) {
        names.push(name)
      }
    }
    return names
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResultContent> {
    const handler = this.items.get(name)
    if (!handler) {
      return encodeToolError(`Unknown tool: ${name}`)
    }
    try {
      return await handler.execute(input, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return encodeToolError(message)
    }
  }

}

export const toolRegistry = new ToolRegistry()
