import { promptRegistry } from './registry'
import { identitySection } from './sections/identity'
import { principlesSection } from './sections/principles'
import { environmentSection } from './sections/environment'
import { skillsSection } from './sections/skills'
import { agentProtocolSection } from './sections/agent-protocol'
import { toolUsageSection } from './sections/tool-usage'
import { workingFolderSection } from './sections/working-folder'
import { taskManagementSection } from './sections/task-management'
import { teamSection } from './sections/team'
import { workerSection } from './sections/worker'
import { coordinationSection } from './sections/coordination'
import { webSearchSection } from './sections/web-search'
import { memorySection } from './sections/memory'
import { userRulesSection } from './sections/user-rules'

// Stable sections first (cache-friendly prefix), dynamic sections last.
// Role-gated sections (team=main, worker/coordination=worker) are skipped
// automatically for the non-matching role by the registry.

promptRegistry.registerAll([
  identitySection,
  principlesSection,
  environmentSection,
  skillsSection,
  agentProtocolSection,
  toolUsageSection,
  workingFolderSection,
  taskManagementSection,
  teamSection,
  workerSection,
  coordinationSection,
  webSearchSection,
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
