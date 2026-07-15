import { promptRegistry } from './registry'
import { environmentSection } from './sections/environment'
import { skillsSection } from './sections/skills'
import { agentProtocolSection } from './sections/agent-protocol'
import { toolUsageSection } from './sections/tool-usage'
import { taskManagementSection } from './sections/task-management'
import { teamSection } from './sections/team'
import { workerSection } from './sections/worker'
import { coordinationSection } from './sections/coordination'
import { memorySection } from './sections/memory'
import { userRulesSection } from './sections/user-rules'

// Stable sections first (cache-friendly prefix), dynamic sections last.
// Role-gated sections (team/coordination) are skipped automatically
// for the non-matching role by the registry.

promptRegistry.registerAll([
  environmentSection,
  skillsSection,
  agentProtocolSection,
  toolUsageSection,
  taskManagementSection,
  teamSection,
  workerSection,
  coordinationSection,
  memorySection,
  userRulesSection
])

export { promptRegistry } from './registry'
export type {
  PromptSection,
  SectionContext,
  PromptRole,
  EnvironmentContext,
  WorkerTaskInfo,
  MemoryPromptData,
  MemoryEntryData,
  SkillPromptData
} from './types'
export { buildScope } from './scope'
