import type { ToolDefinition } from '@/lib/api/types'
import type { AgentDefinition } from './types'

const DEFAULT_AGENT_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'Skill']
export const MANDATORY_AGENT_DISALLOWED_TOOLS = ['AskUserQuestion'] as const

/**
 * Tools available only to the lead coordinator. Removed from every teammate's
 * toolset so workers cannot create teams, delete teams, create tasks, or spawn
 * nested teammates (no recursion).
 */
export const LEAD_ONLY_TOOLS = new Set(['TeamCreate', 'TeamDelete', 'TaskCreate', 'SpawnAgent'])

/**
 * Tools available only to worker/sub-agents. Removed from the main agent's
 * toolset. `CompleteWork` is the worker completion signal — the lead talks to
 * the user directly and never needs it.
 */
export const WORKER_ONLY_TOOLS = new Set(['CompleteWork'])

export function getEffectiveAgentDisallowedTools(disallowedTools: readonly string[] = []): string[] {
  return [...new Set([...MANDATORY_AGENT_DISALLOWED_TOOLS, ...disallowedTools])]
}

export interface ResolvedAgentTools {
  tools: ToolDefinition[]
  invalidTools: string[]
}

export function resolveAgentTools(
  definition: Pick<AgentDefinition, 'tools' | 'disallowedTools'>,
  allTools: ToolDefinition[]
): ResolvedAgentTools {
  const requestedTools = definition.tools.length > 0 ? definition.tools : DEFAULT_AGENT_TOOLS
  const requestedSet = new Set(requestedTools)
  const disallowedSet = new Set(getEffectiveAgentDisallowedTools(definition.disallowedTools))
  const allowAll = requestedSet.has('*')

  const availableNames = new Set(allTools.map((tool) => tool.name))
  const invalidTools = requestedTools.filter(
    (toolName) => toolName !== '*' && !availableNames.has(toolName)
  )

  const resolved = allTools.filter((tool) => {
    if (disallowedSet.has(tool.name)) return false
    if (allowAll) return true
    return requestedSet.has(tool.name)
  })

  if (!disallowedSet.has('Skill') && !resolved.some((tool) => tool.name === 'Skill')) {
    const skillTool = allTools.find((tool) => tool.name === 'Skill')
    if (skillTool && (allowAll || requestedSet.has('Skill'))) {
      resolved.push(skillTool)
    }
  }

  return {
    tools: resolved,
    invalidTools
  }
}
