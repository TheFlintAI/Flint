export const DEFAULT_AGENT_MAX_TURNS = 12

/**
 * Default sampling temperature for sub-agents. Sub-agents do tool use and code
 * edits where reliability matters more than creativity, so default low.
 */
export const DEFAULT_AGENT_TEMPERATURE = 0.2

export function resolveAgentMaxTurns(maxTurns?: number | null): number {
  if (typeof maxTurns === 'number' && Number.isFinite(maxTurns) && maxTurns > 0) {
    return Math.floor(maxTurns)
  }
  return DEFAULT_AGENT_MAX_TURNS
}

export function resolveAgentTemperature(temperature?: number | null): number {
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    return temperature
  }
  return DEFAULT_AGENT_TEMPERATURE
}
