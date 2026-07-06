import type { AgentDefinition } from './types'
import { Registry } from '../registry'

class AgentRegistry extends Registry<AgentDefinition> {}

export const agentRegistry = new AgentRegistry()
