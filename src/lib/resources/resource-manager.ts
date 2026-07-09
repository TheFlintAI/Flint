/**
 * Pure TypeScript resource manager — replaces Rust resources.rs.
 * Uses Tauri fs:* commands for raw I/O; all parsing/logic stays in TS.
 */
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { resourceDir as tauriResourceDir } from '@tauri-apps/api/path'

// Paths

let _cachedHomeDir: string | null = null
let _cachedResourceDir: string | null = null

async function getHomeDir(): Promise<string> {
  if (!_cachedHomeDir) {
    _cachedHomeDir = await tauriCommands.invoke<string>(TAURI_COMMANDS.APP_HOMEDIR)
  }
  return _cachedHomeDir
}

async function getResourceDir(): Promise<string> {
  if (!_cachedResourceDir) {
    _cachedResourceDir = await tauriResourceDir()
  }
  return _cachedResourceDir
}

async function flintDir(): Promise<string> {
  return `${await getHomeDir()}/.flint`
}

async function resourceDir(kind: string): Promise<string> {
  return `${await flintDir()}/${kind}`
}

async function bundledResourceDir(kind: string): Promise<string> {
  return `${await getResourceDir()}/${kind}`
}

async function skillsRoot(): Promise<string> {
  return `${await flintDir()}/skills`
}

async function bundledSkillsDir(): Promise<string> {
  return `${await getResourceDir()}/skills`
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
    const result = await tauriCommands.invoke<{ stat: { exists: boolean } }>(TAURI_COMMANDS.FS_STAT_PATH, { path })
    return result?.stat?.exists === true
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

// Prompts

async function listMarkdownNames(dir: string): Promise<string[]> {
  const userNames = new Set<string>()
  const bundledPath = await bundledResourceDir(dir.split('/').pop() ?? dir)

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
  const bundledPath = `${await bundledResourceDir(kind)}/${fileName}`

  if (await fileExists(userPath)) {
    return readTextFile(userPath)
  }
  if (await fileExists(bundledPath)) {
    return readTextFile(bundledPath)
  }
  throw new Error(`Resource not found: ${kind}/${fileName}`)
}

export async function listPrompts(): Promise<string[]> {
  return listMarkdownNames(await resourceDir('prompts'))
}

export async function loadPrompt(name: string): Promise<string> {
  return readNamedMarkdown('prompts', name)
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
  const roots = [await skillsRoot(), await bundledSkillsDir()]
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

/** Merge global + workspace skills; workspace overrides global by name. */
export function mergeSkills(global: SkillInfo[], workspace: SkillInfo[]): SkillInfo[] {
  const wsNames = new Set(workspace.map(s => s.name))
  return [...workspace, ...global.filter(s => !wsNames.has(s.name))]
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
        const content = await readTextFile(wsPath)
        if (content) return { content, path: wsPath }
      }
    }
  }

  const dir = await skillDir(name)
  const userPath = `${dir}/SKILL.md`
  if (await fileExists(userPath)) {
    const content = await readTextFile(userPath)
    if (content) return { content, path: userPath }
  }

  const bundledPath = `${await bundledSkillsDir()}/${name}/SKILL.md`
  if (await fileExists(bundledPath)) {
    const content = await readTextFile(bundledPath)
    if (content) return { content, path: bundledPath }
  }

  throw new Error(`SKILL.md not found for skill "${name}"`)
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
