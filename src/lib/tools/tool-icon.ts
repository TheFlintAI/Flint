import type { LucideIcon } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Database,
  Download,
  FileCode,
  FileText,
  FolderTree,
  Globe,
  HelpCircle,
  Hourglass,
  ListTodo,
  Puzzle,
  Search,
  Send,
  SquareTerminal,
  Trash2,
  Users,
  Zap,
} from 'lucide-react'

/** Tool icons keyed by exact name (built-in tools). */
const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: BookOpen,
  Write: FileCode,
  Edit: FileCode,
  Delete: Trash2,
  Bash: SquareTerminal,
  Grep: Search,
  Glob: Search,
  LS: FolderTree,
  TaskCreate: ListTodo,
  TaskGet: ListTodo,
  TaskUpdate: ListTodo,
  TaskList: ListTodo,
  SpawnAgent: Users,
  TeamCreate: Users,
  TeamStatus: Activity,
  TeamDelete: Trash2,
  SendMessage: Send,
  Wait: Hourglass,
  CompleteWork: CheckCircle2,
  AskUserQuestion: HelpCircle,
  MemoryRead: Database,
  MemorySearch: Database,
  MemoryWrite: Database,
  MemoryDelete: Database,
  Skill: Zap,
  InstallSkill: Download,
  WebSearch: Globe,
  WebFetch: FileText,
}

/**
 * Module-namespace imports don't expose an index signature, so dynamic icon
 * lookup requires a record cast. `lucide-react` exports only LucideIcon
 * components at runtime — type-only exports like the `LucideIcon` *type* are
 * erased and resolve to undefined, which resolveLucideIcon handles via the
 * Puzzle fallback.
 */
const lucideRecord = LucideIcons as unknown as Record<string, LucideIcon>

/** Plugin tool icons — registered at runtime. */
const pluginToolIcons = new Map<string, LucideIcon>()

/** Resolve a Lucide icon by name. Falls back to Puzzle if not found. */
export function resolveLucideIcon(name?: string): LucideIcon {
  if (!name) return Puzzle
  const icon = lucideRecord[name]
  return icon ?? Puzzle
}

/**
 * Register an icon for a plugin tool.
 * `iconName` should be a valid Lucide icon name, or omitted to use Puzzle.
 */
export function registerToolIcon(name: string, iconName?: string): void {
  pluginToolIcons.set(name, resolveLucideIcon(iconName))
}

/** Unregister a plugin tool icon. */
export function unregisterToolIcon(name: string): void {
  pluginToolIcons.delete(name)
}

/**
 * Returns the icon for a tool. Checks built-in icons first, then plugin icons.
 * Throws if no icon is found — fail-fast, no silent fallback.
 */
export function getToolIcon(name: string): LucideIcon {
  // Exact match
  const builtin = TOOL_ICONS[name]
  if (builtin) return builtin

  // Plugin tool
  const plugin = pluginToolIcons.get(name)
  if (plugin) return plugin

  // Family-level patterns for tools not in TOOL_ICONS
  if (name.startsWith('Task')) return ListTodo
  if (name.startsWith('Memory')) return Database

  throw new Error(
    `[tool-icon] No icon defined for tool "${name}". ` +
    'Add it to TOOL_ICONS in src/lib/tools/tool-icon.ts or register via registerToolIcon().'
  )
}
