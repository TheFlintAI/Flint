import type { ToolDefinition } from '../api/types'

type PromptCacheEnvironmentContext = {
  target: string
  operatingSystem: string
  shell: string
  host?: string
  connectionName?: string
  pathStyle?: string
}

type PromptCacheTeamSnapshot = {
  name: string
  permissionMode?: string
  members?: string[]
}

function normalizeUserRules(userRules?: string): string {
  return userRules?.trim() || ''
}

export function stableSerializePromptCacheValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializePromptCacheValue(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerializePromptCacheValue(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildToolDefinitionCacheKey(
  toolDefs: readonly Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>[]
): string {
  return stableSerializePromptCacheValue(
    toolDefs
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  )
}

export function haveSameToolDefinitions(
  left: readonly Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>[],
  right: readonly Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>[]
): boolean {
  if (left.length !== right.length) return false
  return buildToolDefinitionCacheKey(left) === buildToolDefinitionCacheKey(right)
}

export function buildPromptCacheKey(options: {
  language?: string
  userRules?: string
  environmentContext?: PromptCacheEnvironmentContext
  activeTeam?: PromptCacheTeamSnapshot | null
  memorySnapshot?: unknown
}): string {
  return stableSerializePromptCacheValue({
    language: options.language === 'zh' ? 'zh' : 'en',
    userRules: normalizeUserRules(options.userRules),
    memorySnapshot: options.memorySnapshot ?? null,
    environmentContext: options.environmentContext
      ? {
          target: options.environmentContext.target,
          operatingSystem: options.environmentContext.operatingSystem,
          shell: options.environmentContext.shell,
          host: options.environmentContext.host,
          connectionName: options.environmentContext.connectionName,
          pathStyle: options.environmentContext.pathStyle
        }
      : null,
    activeTeam: options.activeTeam
      ? {
          name: options.activeTeam.name,
          permissionMode: options.activeTeam.permissionMode,
          members: options.activeTeam.members ?? []
        }
      : null
  })
}
