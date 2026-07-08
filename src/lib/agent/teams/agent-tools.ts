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
