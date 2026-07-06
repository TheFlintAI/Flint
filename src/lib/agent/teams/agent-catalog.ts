import { tauriCommands } from '@/services/tauri-api/command-client'
import { resolveAgentMaxTurns } from './agent-limits'
import { agentRegistry } from './agent-registry'
import type { AgentDefinition } from './types'
import { createLogger } from '@/lib/logger'
import { toonEncode } from '@/lib/tools/tool-result-format'
import { createSpawnAgentTool } from './tools/spawn-agent'
import { toolRegistry } from '../tool-registry'

const log = createLogger('AgentCatalog')

export interface AgentInfo {
  name: string
  description: string
  icon?: string
  tools?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  maxTurns?: number
  maxIterations?: number
  initialPrompt?: string
  background?: boolean
  model?: string
  temperature?: number
  systemPrompt: string
}

export type AgentRegistryRefreshStatus = 'changed' | 'unchanged' | 'failed'

let registeredAgentSignature = ''

function toDefinition(info: AgentInfo): AgentDefinition {
  return {
    name: info.name,
    description: info.description,
    icon: info.icon,
    tools: info.tools ?? info.allowedTools ?? ['Read', 'Glob', 'Grep', 'LS', 'Bash'],
    disallowedTools: info.disallowedTools ?? [],
    maxTurns: resolveAgentMaxTurns(info.maxTurns ?? info.maxIterations),
    initialPrompt: info.initialPrompt,
    background: info.background,
    model: info.model,
    temperature: info.temperature,
    systemPrompt: info.systemPrompt
  }
}

function normalizeStringList(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => item.trim()).filter(Boolean)
}

function normalizeAgentInfos(agents: AgentInfo[]): AgentInfo[] {
  return agents
    .filter((agent) => agent.name?.trim() && agent.description?.trim())
    .map((agent) => ({
      ...agent,
      name: agent.name.trim(),
      description: agent.description.trim(),
      tools: normalizeStringList(agent.tools),
      allowedTools: normalizeStringList(agent.allowedTools),
      disallowedTools: normalizeStringList(agent.disallowedTools)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

function buildAgentSignature(agents: AgentInfo[]): string {
  return toonEncode(
    agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      tools: agent.tools,
      allowedTools: agent.allowedTools,
      disallowedTools: agent.disallowedTools,
      maxTurns: agent.maxTurns,
      maxIterations: agent.maxIterations,
      initialPrompt: agent.initialPrompt,
      background: agent.background,
      model: agent.model,
      temperature: agent.temperature,
      systemPrompt: agent.systemPrompt
    }))
  )
}

async function loadAgentInfos(): Promise<AgentInfo[] | null> {
  try {
    const agents = (await tauriCommands.invoke('agents:list')) as AgentInfo[]
    return Array.isArray(agents) ? agents : []
  } catch (err) {
    log.error('Failed to load agents from TAURI_COMMANDS:', err)
    return null
  }
}

function syncAgentRegistry(agents: AgentInfo[]): void {
  const definitions = agents.map(toDefinition)
  const nextNames = new Set(definitions.map((definition) => definition.name))

  for (const currentName of agentRegistry.getNames()) {
    if (!nextNames.has(currentName)) {
      agentRegistry.unregister(currentName)
    }
  }

  for (const definition of definitions) {
    agentRegistry.register(definition.name, definition)
  }
}

export async function refreshAgentRegistry(): Promise<AgentRegistryRefreshStatus> {
  const agents = await loadAgentInfos()
  if (!agents) return 'failed'

  const normalizedAgents = normalizeAgentInfos(agents)
  const nextSignature = buildAgentSignature(normalizedAgents)
  if (nextSignature === registeredAgentSignature) return 'unchanged'

  syncAgentRegistry(normalizedAgents)
  registeredAgentSignature = nextSignature
  return 'changed'
}

// SpawnAgent tool wiring

const SPAWN_AGENT_TOOL_NAME = 'SpawnAgent'

export async function refreshAgentTools(): Promise<void> {
  const refreshStatus = await refreshAgentRegistry()
  if (refreshStatus === 'failed' && toolRegistry.has(SPAWN_AGENT_TOOL_NAME)) return
  if (refreshStatus === 'unchanged' && toolRegistry.has(SPAWN_AGENT_TOOL_NAME)) return

  toolRegistry.add(createSpawnAgentTool())
}
