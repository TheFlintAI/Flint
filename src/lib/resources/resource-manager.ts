/**
 * Pure TypeScript resource manager — replaces Rust resources.rs.
 * Uses Tauri fs:* commands for raw I/O; all parsing/logic stays in TS.
 */
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'

// Paths

let _cachedHomeDir: string | null = null

async function getHomeDir(): Promise<string> {
  if (!_cachedHomeDir) {
    _cachedHomeDir = await tauriCommands.invoke<string>(TAURI_COMMANDS.APP_HOMEDIR)
  }
  return _cachedHomeDir
}

async function flintDir(): Promise<string> {
  return `${await getHomeDir()}/.flint`
}

async function resourceDir(kind: string): Promise<string> {
  return `${await flintDir()}/${kind}`
}

function bundledResourceDir(kind: string): string {
  // In Tauri dev mode, resources/ is relative to the current working directory
  return `resources/${kind}`
}

async function skillsRoot(): Promise<string> {
  return `${await flintDir()}/skills`
}

function bundledSkillsDir(): string {
  return 'resources/skills'
}

// Markdown helpers

function markdownFileName(name: string): string {
  const trimmed = name.trim().replace(/\.md$/, '')
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
    throw new Error('invalid resource name')
  }
  return `${trimmed}.md`
}

function summarizeMarkdown(content: string): string {
  const firstLine = content
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('---') && !l.startsWith('#'))
  return (firstLine ?? '').slice(0, 120)
}

function extractFrontmatterString(content: string, key: string): string | undefined {
  let inFrontmatter = false
  for (const line of content.split('\n')) {
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (!inFrontmatter) continue
    const prefix = `${key}:`
    if (line.trim().startsWith(prefix)) {
      return line.trim().slice(prefix.length).trim().replace(/^["']|["']$/g, '')
    }
  }
  return undefined
}

function extractFrontmatterList(content: string, key: string): string[] {
  const raw = extractFrontmatterString(content, key)
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function extractFrontmatterNumber(content: string, key: string): number | undefined {
  const raw = extractFrontmatterString(content, key)
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function extractFrontmatterBool(content: string, key: string): boolean | undefined {
  const raw = extractFrontmatterString(content, key)
  if (!raw) return undefined
  return raw.toLowerCase() === 'true' ? true : raw.toLowerCase() === 'false' ? false : undefined
}

function stripFrontmatter(content: string): string {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return content
  let i = 1
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') break
  }
  return lines.slice(i + 1).join('\n')
}

// File helpers

async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await tauriCommands.invoke<{ exists: boolean }>(TAURI_COMMANDS.FS_STAT_PATH, { path })
    return result?.exists === true
  } catch {
    return false
  }
}

async function readTextFile(path: string): Promise<string> {
  const result = await tauriCommands.invoke<{ content: string }>(TAURI_COMMANDS.FS_READ_FILE, { path })
  return result?.content ?? ''
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, { path, content })
}

async function listDir(path: string): Promise<string[]> {
  try {
    const result = await tauriCommands.invoke<{ entries: Array<{ name: string; is_dir: boolean }> }>(
      TAURI_COMMANDS.FS_LIST_DIR,
      { path }
    )
    return (result?.entries ?? []).map(e => e.name)
  } catch {
    return []
  }
}

async function ensureDir(path: string): Promise<void> {
  await tauriCommands.invoke(TAURI_COMMANDS.FS_MKDIR, { path })
}

async function deletePath(path: string): Promise<void> {
  await tauriCommands.invoke(TAURI_COMMANDS.FS_DELETE, { path })
}

async function copyDirRecursive(source: string, destination: string): Promise<void> {
  await ensureDir(destination)
  const names = await listDir(source)
  for (const name of names) {
    const from = `${source}/${name}`
    const to = `${destination}/${name}`
    try {
      const stat = await tauriCommands.invoke<{ is_dir: boolean }>(TAURI_COMMANDS.FS_STAT_PATH, { path: from })
      if (stat?.is_dir) {
        await copyDirRecursive(from, to)
      } else {
        // Read + write for file copy
        const fileResult = await tauriCommands.invoke<{ content: string }>(TAURI_COMMANDS.FS_READ_FILE, { path: from })
        await writeTextFile(to, fileResult?.content ?? '')
      }
    } catch {
      // Skip files that can't be read (binary, etc.)
    }
  }
}

// Public API

export interface SkillInfo {
  name: string
  description: string
  enabled: boolean
}

export interface AgentInfo {
  name: string
  description: string
  icon?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  maxIterations?: number
  maxTurns?: number
  background?: boolean
  model?: string
  temperature?: number
  initialPrompt?: string
  systemPrompt: string
}

export interface ManagedResourceItem {
  id: string
  name: string
  summary: string
  description: string
  path: string
  source: 'user' | 'bundled'
  editable: boolean
  effective: boolean
}

// Prompts / Commands

async function listMarkdownNames(dir: string): Promise<string[]> {
  const userNames = new Set<string>()
  const bundledPath = bundledResourceDir(dir.split('/').pop() ?? dir)

  // User dir
  try {
    const names = await listDir(dir)
    for (const name of names) {
      if (name.endsWith('.md')) {
        userNames.add(name.replace(/\.md$/, ''))
      }
    }
  } catch { /* dir may not exist */ }

  // Bundled dir
  try {
    const names = await listDir(bundledPath)
    for (const name of names) {
      if (name.endsWith('.md')) {
        userNames.add(name.replace(/\.md$/, ''))
      }
    }
  } catch { /* dir may not exist */ }

  return [...userNames].sort()
}

async function readNamedMarkdown(kind: string, name: string): Promise<string> {
  const fileName = markdownFileName(name)
  const userPath = `${await resourceDir(kind)}/${fileName}`
  const bundledPath = `${bundledResourceDir(kind)}/${fileName}`

  if (await fileExists(userPath)) {
    return readTextFile(userPath)
  }
  return readTextFile(bundledPath)
}

export async function listPrompts(): Promise<string[]> {
  return listMarkdownNames(await resourceDir('prompts'))
}

export async function loadPrompt(name: string): Promise<string> {
  return readNamedMarkdown('prompts', name)
}

export async function listCommands(): Promise<Array<{ name: string; summary: string }>> {
  const names = await listMarkdownNames(await resourceDir('commands'))
  return Promise.all(
    names.map(async name => {
      const content = await readNamedMarkdown('commands', name).catch(() => '')
      return { name, summary: summarizeMarkdown(content) }
    })
  )
}

export async function loadCommand(name: string): Promise<string> {
  return readNamedMarkdown('commands', name)
}

// Managed resources (agents/commands CRUD)

export async function listManagedItems(kind: 'agents' | 'commands'): Promise<ManagedResourceItem[]> {
  const dir = await resourceDir(kind)
  const bundledDir = bundledResourceDir(kind)
  const items: ManagedResourceItem[] = []

  for (const [source, editable, baseDir] of [
    ['user', true, dir],
    ['bundled', false, bundledDir]
  ] as const) {
    try {
      const names = await listDir(baseDir)
      for (const entryName of names) {
        if (!entryName.endsWith('.md')) continue
        const name = entryName.replace(/\.md$/, '')
        const path = `${baseDir}/${entryName}`
        const content = await readTextFile(path).catch(() => '')
        items.push({
          id: `${source}:${path}`,
          name,
          summary: summarizeMarkdown(content),
          description: extractFrontmatterString(content, 'description') ?? summarizeMarkdown(content),
          path,
          source,
          editable,
          effective: true
        })
      }
    } catch { /* dir may not exist */ }
  }

  return items
}

export async function readManagedResource(kind: 'agents' | 'commands', name: string): Promise<string> {
  return readNamedMarkdown(kind, name)
}

export async function createManagedResource(kind: 'agents' | 'commands', name: string, content?: string): Promise<string> {
  const dir = await resourceDir(kind)
  await ensureDir(dir)
  const file = `${dir}/${markdownFileName(name)}`
  const body = content ?? `# ${name}\n`
  await writeTextFile(file, body)
  return file
}

export async function saveManagedResource(kind: 'agents' | 'commands', name: string, content: string): Promise<void> {
  const dir = await resourceDir(kind)
  await ensureDir(dir)
  const file = `${dir}/${markdownFileName(name)}`
  await writeTextFile(file, content)
}

// Agents

export async function listAgents(): Promise<AgentInfo[]> {
  const names = await listMarkdownNames(await resourceDir('agents'))
  const agents: AgentInfo[] = []

  for (const name of names) {
    try {
      const content = await readNamedMarkdown('agents', name)
      agents.push({
        name: extractFrontmatterString(content, 'name') ?? name,
        description: extractFrontmatterString(content, 'description') ?? summarizeMarkdown(content),
        icon: extractFrontmatterString(content, 'icon'),
        allowedTools: extractFrontmatterList(content, 'allowedTools'),
        disallowedTools: extractFrontmatterList(content, 'disallowedTools'),
        maxIterations: extractFrontmatterNumber(content, 'maxIterations'),
        maxTurns: extractFrontmatterNumber(content, 'maxTurns'),
        background: extractFrontmatterBool(content, 'background'),
        model: extractFrontmatterString(content, 'model'),
        temperature: extractFrontmatterNumber(content, 'temperature'),
        initialPrompt: extractFrontmatterString(content, 'initialPrompt'),
        systemPrompt: stripFrontmatter(content).trim()
      })
    } catch {
      // Skip broken files
    }
  }

  return agents
}

// Skills

async function skillDir(name: string): Promise<string> {
  return `${await skillsRoot()}/${name.trim()}`
}

async function skillStatePath(): Promise<string> {
  return `${await skillsRoot()}/_state.json`
}

async function loadSkillStates(): Promise<Record<string, boolean>> {
  try {
    const path = await skillStatePath()
    const content = await readTextFile(path)
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const states: Record<string, boolean> = {}
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'boolean') states[key] = val
      }
      return states
    }
  } catch { /* file missing or corrupt */ }
  return {}
}

export async function saveSkillState(name: string, enabled: boolean): Promise<void> {
  const path = await skillStatePath()
  const states = await loadSkillStates()
  states[name] = enabled
  await writeTextFile(path, JSON.stringify(states, null, 2))
}

function attachEnabledStates(skills: SkillInfo[], states: Record<string, boolean>): SkillInfo[] {
  return skills.map((s) => ({ ...s, enabled: states[s.name] ?? true }))
}

async function scanSkillDir(dir: string, skills: SkillInfo[], seen: Set<string>): Promise<void> {
  try {
    const names = await listDir(dir)
    for (const name of names) {
      if (name === '_state.json') continue
      if (seen.has(name)) continue
      seen.add(name)
      const manifestPath = `${dir}/${name}/SKILL.md`
      try {
        const content = await readTextFile(manifestPath)
        skills.push({
          name,
          description: extractFrontmatterString(content, 'description') ?? summarizeMarkdown(content),
          enabled: true
        })
      } catch {
        // SKILL.md not found
      }
    }
  } catch {
    // dir may not exist
  }
}

export async function listSkills(): Promise<SkillInfo[]> {
  const roots = [await skillsRoot(), bundledSkillsDir()]
  const skills: SkillInfo[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    await scanSkillDir(root, skills, seen)
  }

  const states = await loadSkillStates()
  const cleanStates: Record<string, boolean> = {}
  const skillNames = new Set(skills.map((s) => s.name))
  for (const [name, enabled] of Object.entries(states)) {
    if (skillNames.has(name)) {
      cleanStates[name] = enabled
    }
  }

  // Prune orphaned entries if any were removed
  if (Object.keys(cleanStates).length !== Object.keys(states).length) {
    await writeTextFile(await skillStatePath(), JSON.stringify(cleanStates, null, 2))
  }

  return attachEnabledStates(skills, cleanStates)
}

/**
 * Scan workspace directories for project-level skills.
 * Checks `.claude/skills/` and `.agents/skills/` under the workspace root.
 */
export async function scanWorkspaceSkills(workspacePath: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  const seen = new Set<string>()

  await scanSkillDir(`${workspacePath}/.claude/skills`, skills, seen)
  await scanSkillDir(`${workspacePath}/.agents/skills`, skills, seen)

  return skills.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function readSkill(name: string, workspacePath?: string): Promise<{ content: string; path: string }> {
  // Check workspace directories first when a workspace is set
  if (workspacePath) {
    for (const skillsDir of [`${workspacePath}/.claude/skills`, `${workspacePath}/.agents/skills`]) {
      const wsPath = `${skillsDir}/${name}/SKILL.md`
      if (await fileExists(wsPath)) {
        return { content: await readTextFile(wsPath), path: wsPath }
      }
    }
  }

  const dir = await skillDir(name)
  const userPath = `${dir}/SKILL.md`
  const bundledPath = `${bundledSkillsDir()}/${name}/SKILL.md`

  if (await fileExists(userPath)) {
    return { content: await readTextFile(userPath), path: userPath }
  }
  return { content: await readTextFile(bundledPath), path: bundledPath }
}

export async function deleteSkill(name: string): Promise<void> {
  const dir = await skillDir(name)
  try {
    await deletePath(dir)
  } catch { /* already gone */ }
  // Clean up enabled state
  const states = await loadSkillStates()
  if (name in states) {
    delete states[name]
    await writeTextFile(await skillStatePath(), JSON.stringify(states, null, 2))
  }
}

export async function openSkillFolder(name: string): Promise<void> {
  const dir = await skillDir(name)
  await tauriCommands.invoke('shell:openPath', dir)
}

export async function addSkillFromFolder(sourcePath: string): Promise<{ success: boolean; name: string }> {
  const name = sourcePath.split(/[/\\]/).pop() ?? 'skill'
  const dest = await skillDir(name)
  await copyDirRecursive(sourcePath, dest)
  return { success: true, name }
}

export async function previewSkillFolder(sourcePath: string): Promise<{
  name: string
  description: string
  content: string
}> {
  const manifestPath = `${sourcePath}/SKILL.md`
  const content = await readTextFile(manifestPath).catch(() => '')
  const name = sourcePath.split(/[/\\]/).pop() ?? 'skill'

  return {
    name,
    description: extractFrontmatterString(content, 'description') ?? '',
    content
  }
}
