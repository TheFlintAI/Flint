/**
 * Comprehensive command router — intercepts ALL non-native Tauri commands
 * and routes them to TypeScript handlers instead of Rust.
 *
 * Only true native capabilities (fs, shell, process, terminal,
 * api, desktop, image, clipboard, git, plugin, window)
 * still go to Rust.
 */
import {
  initDb, listTable, createRow, updateRow, deleteRow,
  upsertRow, deleteByField, listByField, getByField
} from '@/lib/db/json-store'
import { tauriCommands } from './command-client'
import * as rm from '@/lib/resources/resource-manager'
import type {
  CreateTeamRuntimeArgs, TeamRuntimeCreateResult,
  DeleteTeamRuntimeArgs,
  AppendTeamRuntimeMessageArgs,
  TeamRuntimeMessageRecord,
  ConsumeTeamRuntimeMessagesArgs
} from '@/protocols/team-runtime-types'

// Lazy init
let _initialized = false
async function ensureInit(): Promise<void> {
  if (!_initialized) {
    await initDb()
    _initialized = true
  }
}

// Public API

export function isNonNativeCommand(channel: string): boolean {
  return (
    channel.startsWith('db:') ||
    channel.startsWith('agent:changes:') ||
    channel.startsWith('agent:prompt:') ||
    channel.startsWith('team-runtime:') ||
    channel.startsWith('skills:') ||
    channel.startsWith('agents:') ||
    channel.startsWith('commands:') ||
    channel.startsWith('prompts:')
  )
}

export async function handleNonNativeCommand(
  channel: string,
  args: unknown[]
): Promise<unknown> {
  await ensureInit()

  // db:* commands
  if (channel.startsWith('db:')) return handleDbCommand(channel, args)

  // agent:changes:* commands
  if (channel.startsWith('agent:changes:')) return handleAgentChanges(channel, args)

  // agent:prompt:* commands (already handled in TS, but route anyway)
  if (channel.startsWith('agent:prompt:')) {
    throw new Error('agent:prompt commands should be called directly from system-prompt.ts, not via Tauri')
  }

  // team-runtime:* commands
  if (channel.startsWith('team-runtime:')) {
    return handleTeamCommand(channel, args)
  }

  // skills:*, agents:*, commands:*, prompts:* resource commands
  if (channel.startsWith('skills:') || channel.startsWith('agents:') ||
      channel.startsWith('commands:') || channel.startsWith('prompts:')) {
    return handleResourceCommand(channel, args)
  }

  throw new Error(`Unknown non-native command: ${channel}`)
}

// DB Commands

async function handleDbCommand(channel: string, args: unknown[]): Promise<unknown> {
  const a0 = args[0] as Record<string, unknown> | undefined
  const str0 = typeof args[0] === 'string' ? args[0] : ''

  switch (channel) {
    case 'db:tasks:list': return listTable('tasks')
    case 'db:tasks:create': { await createRow('tasks', a0 ?? {}); return { success: true } }
    case 'db:tasks:update': { await updateRow('tasks', (a0?.id ?? '') as string, (a0?.patch ?? {}) as Record<string, unknown>); return { success: true } }
    case 'db:tasks:delete': { await deleteRow('tasks', str0 || (a0?.id as string) || ''); return { success: true } }
    case 'db:tasks:delete-by-task': { const n = await deleteByField('tasks', 'task_id', str0); return { success: true, deleted: n } }
    case 'db:tasks:list-by-task': return listByField('tasks', 'task_id', str0)
    case 'db:tasks:clear-all': {
      const rows = await listTable('tasks'); let d = 0
      for (const r of rows) { if (!r.plugin_id) { await deleteRow('tasks', r.id as string); d++ } }
      return { success: true, deleted: d }
    }
    case 'db:tasks:get': {
      const task = await getByField('tasks', 'id', str0)
      if (!task) return null
      const msgs = await listByField('messages', 'task_id', str0)
      msgs.sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0))
      return { task, messages: msgs }
    }
    case 'db:messages:add': { await createRow('messages', a0 ?? {}); return { success: true } }
    case 'db:messages:add-batch': {
      const rows = (args[0] as Array<Record<string, unknown>>) ?? []
      for (const r of rows) await createRow('messages', r)
      return { success: true }
    }
    case 'db:messages:upsert': { await upsertRow('messages', a0 ?? {}); return { success: true } }
    case 'db:messages:update': { await updateRow('messages', (a0?.id ?? '') as string, (a0?.patch ?? {}) as Record<string, unknown>); return { success: true } }
    case 'db:messages:list': { const rows = await listByField('messages', 'task_id', str0); return sortMessages(rows) }
    case 'db:messages:list-user': { const rows = await listByField('messages', 'task_id', str0); return sortMessages(rows.filter(r => r.role === 'user')) }
    case 'db:messages:list-page': {
      const taskId = a0?.taskId as string; const limit = (a0?.limit as number) ?? 200; const offset = (a0?.offset as number) ?? 0
      return sortMessages(await listByField('messages', 'task_id', taskId)).slice(offset, offset + limit)
    }
    case 'db:messages:count': return (await listByField('messages', 'task_id', str0)).length
    case 'db:messages:clear': { const n = await deleteByField('messages', 'task_id', str0); return { success: true, deleted: n } }
    case 'db:messages:truncate-from': {
      const taskId = a0?.taskId as string; const from = (a0?.fromSortOrder as number) ?? Number.MAX_SAFE_INTEGER
      const rows = await listByField('messages', 'task_id', taskId); let d = 0
      for (const r of rows) { if (((r.sort_order as number) ?? 0) >= from) { await deleteRow('messages', r.id as string); d++ } }
      return { success: true, deleted: d }
    }
    case 'db:messages:replace': {
      const taskId = a0?.taskId as string; const msgs = (a0?.messages as Array<Record<string, unknown>>) ?? []
      await deleteByField('messages', 'task_id', taskId)
      for (const m of msgs) { m.task_id = taskId; await createRow('messages', m) }
      return { success: true }
    }
    case 'db:plans:list': return listTable('plans')
    case 'db:plans:create': { await createRow('plans', a0 ?? {}); return { success: true } }
    case 'db:plans:update': { await updateRow('plans', (a0?.id ?? '') as string, (a0?.patch ?? {}) as Record<string, unknown>); return { success: true } }
    case 'db:plans:delete': { await deleteRow('plans', str0 || (a0?.id as string) || ''); return { success: true } }
    case 'db:plans:get-by-task': return getByField('plans', 'task_id', str0)
    default: throw new Error(`Unknown DB command: ${channel}`)
  }
}

function sortMessages(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const sa = (a.sort_order as number) ?? 0; const sb = (b.sort_order as number) ?? 0
    if (sa !== sb) return sa - sb
    return ((a.created_at as number) ?? 0) - ((b.created_at as number) ?? 0)
  })
}

// Agent Changes Commands

type FileOp = 'create' | 'modify' | 'delete'

function parseSnapshot(json: string | undefined): { fullText?: string } | null {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

function snapshotLineCount(text: string): number {
  if (!text) return 0
  return text.replace(/\r\n/g, '\n').split('\n').length
}

// Reconstructs a FileSnapshot from the persisted fullText + op side.
// fullText undefined => the snapshot was text-omitted (large/binary file).
function snapshotFromDb(op: FileOp, side: 'before' | 'after', fullText: string | undefined): {
  exists: boolean
  text?: string
  textOmitted?: boolean
  hash: string | null
  size: number
  lineCount?: number
} {
  const isCreate = op === 'create'
  const isDelete = op === 'delete'
  const exists =
    side === 'before' ? !isCreate : !isDelete
  if (!exists) return { exists: false, hash: null, size: 0 }
  if (fullText === undefined) {
    return { exists: true, textOmitted: true, hash: null, size: 0 }
  }
  return {
    exists: true,
    text: fullText,
    hash: null,
    size: fullText.length,
    lineCount: snapshotLineCount(fullText)
  }
}

async function buildRunChangeSet(runId: string): Promise<{
  runId: string
  taskId?: string
  assistantMessageId: string
  status: string
  changes: unknown[]
  createdAt: unknown
  updatedAt: unknown
} | null> {
  const changeSets = await listByField('agent_change_sets', 'run_id', runId)
  const changes = await listByField('agent_file_changes', 'run_id', runId)
  const set = changeSets[0]
  if (!set && changes.length === 0) return null

  const runChanges = changes
    .map(c => {
      const op = (c.op as FileOp) ?? 'modify'
      const beforeText = parseSnapshot(c.before_json as string)?.fullText
      const afterText = parseSnapshot(c.after_json as string)?.fullText
      return {
        id: c.id,
        runId: c.run_id,
        taskId: c.task_id ?? undefined,
        toolUseId: c.tool_use_id ?? undefined,
        toolName: c.tool_name ?? undefined,
        filePath: c.file_path,
        transport: (c.transport as 'local' | 'ssh') ?? 'local',
        connectionId: c.connection_id ?? undefined,
        op,
        status: c.status,
        before: snapshotFromDb(op, 'before', beforeText),
        after: snapshotFromDb(op, 'after', afterText),
        sortOrder: c.sort_order,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        revertedAt: c.reverted_at ?? undefined
      }
    })
    .sort((a, b) => ((a.sortOrder as number) ?? 0) - ((b.sortOrder as number) ?? 0))

  return {
    runId,
    taskId: (set?.task_id as string | undefined) ?? (changes[0]?.task_id as string | undefined),
    assistantMessageId: (set?.assistant_message_id as string | undefined) ?? runId,
    status: (set?.status as string | undefined) ?? (runChanges.every(c => c.status === 'reverted') ? 'reverted' : 'open'),
    changes: runChanges,
    createdAt: set?.created_at,
    updatedAt: set?.updated_at
  }
}

async function handleAgentChanges(channel: string, args: unknown[]): Promise<unknown> {
  const a0 = args[0] as Record<string, unknown> | undefined

  switch (channel) {
    case 'agent:changes:list-task': {
      const taskId = (a0?.taskId ?? a0?.task_id) as string
      if (!taskId) return []
      const changeSets = await listByField('agent_change_sets', 'task_id', taskId)
      const changes = await listByField('agent_file_changes', 'task_id', taskId)
      // Build unique run IDs
      const runIds = [...new Set([
        ...changeSets.map(r => r.run_id as string),
        ...changes.map(r => r.run_id as string)
      ])]
      return runIds.map(runId => {
        const set = changeSets.find(s => s.run_id === runId)
        const runChanges = changes
          .filter(c => c.run_id === runId)
          .map(c => {
            const op = (c.op as FileOp) ?? 'modify'
            const beforeText = parseSnapshot(c.before_json as string)?.fullText
            const afterText = parseSnapshot(c.after_json as string)?.fullText
            return {
              id: c.id,
              runId: c.run_id,
              taskId: c.task_id ?? undefined,
              toolUseId: c.tool_use_id ?? undefined,
              toolName: c.tool_name ?? undefined,
              filePath: c.file_path,
              transport: (c.transport as 'local' | 'ssh') ?? 'local',
              connectionId: c.connection_id ?? undefined,
              op,
              status: c.status,
              before: snapshotFromDb(op, 'before', beforeText),
              after: snapshotFromDb(op, 'after', afterText),
              sortOrder: c.sort_order,
              createdAt: c.created_at,
              updatedAt: c.updated_at,
              revertedAt: c.reverted_at ?? undefined
            }
          })
          .sort((a, b) => ((a.sortOrder as number) ?? 0) - ((b.sortOrder as number) ?? 0))
        return {
          runId,
          taskId: set?.task_id ?? taskId,
          assistantMessageId: set?.assistant_message_id ?? runId,
          status: set?.status ?? 'open',
          changes: runChanges,
          createdAt: set?.created_at,
          updatedAt: set?.updated_at
        }
      })
    }
    case 'agent:changes:diff-content': {
      const changeId = a0?.changeId as string
      const change = (await listByField('agent_file_changes', 'id', changeId))[0]
      if (!change) return null
      const beforeText = parseSnapshot(change.before_json as string)?.fullText ?? ''
      const afterText = parseSnapshot(change.after_json as string)?.fullText ?? ''
      return { beforeText, afterText }
    }
    case 'agent:changes:undo-run': {
      const runId = a0?.runId as string
      if (!runId) return { success: false, revertedCount: 0, failureCount: 0, failures: [], changeset: null }
      const changes = (await listByField('agent_file_changes', 'run_id', runId))
        .filter(c => c.status !== 'reverted')
        .reverse()
      let reverted = 0; const failures: unknown[] = []
      for (const c of changes) {
        try {
          await revertFileChange(c)
          await updateRow('agent_file_changes', c.id as string, { status: 'reverted', reverted_at: Date.now() })
          reverted++
        } catch (e) {
          failures.push({ changeId: c.id, filePath: c.file_path, reason: String(e) })
        }
      }
      const changeset = await buildRunChangeSet(runId)
      return { success: failures.length === 0, revertedCount: reverted, failureCount: failures.length, failures, changeset }
    }
    case 'agent:changes:undo-file': {
      const changeId = a0?.changeId as string
      const runId = a0?.runId as string
      const change = (await listByField('agent_file_changes', 'id', changeId))[0]
      if (!change || change.status === 'reverted') return { success: true, changeset: null }
      try {
        await revertFileChange(change)
        await updateRow('agent_file_changes', change.id as string, { status: 'reverted', reverted_at: Date.now() })
        const changeset = await buildRunChangeSet(runId)
        return { success: true, changeset }
      } catch (e) {
        return { success: false, reason: String(e), changeset: null }
      }
    }
    default: throw new Error(`Unknown agent changes command: ${channel}`)
  }
}

// Reverts a single file change according to its op:
// create -> delete the file; delete -> restore after text; modify -> restore before text.
async function revertFileChange(c: Record<string, unknown>): Promise<void> {
  const op = (c.op as FileOp) ?? 'modify'
  const filePath = c.file_path as string | undefined
  if (!filePath) return
  if (op === 'create') {
    await tauriCommands.invoke('fs:delete', { path: filePath })
    return
  }
  const restoreText = parseSnapshot(
    (op === 'delete' ? c.after_json : c.before_json) as string
  )?.fullText
  if (restoreText !== undefined) {
    await tauriCommands.invoke('fs:write-file', { path: filePath, content: restoreText })
  }
}

// Team Commands

let _cachedHomeDir: string | null = null
async function getHomeDir(): Promise<string> {
  if (!_cachedHomeDir) _cachedHomeDir = await tauriCommands.invoke<string>('app:homedir')
  return _cachedHomeDir!
}
async function teamsDir(): Promise<string> { return `${await getHomeDir()}/.flint/teams` }
function sanitizeTeamName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\s]/g, '-').split('-').filter(Boolean).join('-')
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const result = await tauriCommands.invoke<{ content: string }>('fs:read-file', { path })
    const content = result?.content
    if (!content) return fallback
    const parsed: unknown = JSON.parse(content)
    // Guard against type mismatches — the parsed JSON must match the fallback shape
    if (fallback !== null && typeof parsed !== typeof fallback) return fallback
    if (Array.isArray(fallback) !== Array.isArray(parsed)) return fallback
    return parsed as T
  } catch { return fallback }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const dir = path.split('/').slice(0, -1).join('/')
  try { await tauriCommands.invoke('fs:mkdir', { path: dir }) } catch { /* exists */ }
  await tauriCommands.invoke('fs:write-file', { path, content: JSON.stringify(data, null, 2) })
}

// Each team command is a typed function whose return is enforced against
// TeamRuntimeCommandMap. Errors throw (fail-fast) so the tool layer reports
// them instead of silently treating a malformed result as success.

async function handleTeamCreate(args: CreateTeamRuntimeArgs): Promise<TeamRuntimeCreateResult> {
  const teamName = sanitizeTeamName(args.teamName)
  if (!teamName) throw new Error('Invalid team name')
  const runtimePath = `${await teamsDir()}/${teamName}`
  const now = Date.now()
  const leadAgentId = `team-lead@${teamName}-${now}`
  const teamAllowedPaths = args.workingFolder ? [args.workingFolder] : []
  // The on-disk runtime is ONLY an append-only message inbox. Member/task/meta
  // state lives in the in-memory store and is never written here, so there is
  // no manifest to diverge from. We (re)create an empty inbox; any stale
  // messages from a prior run are discarded. The one-team-at-a-time
  // precondition is enforced by the tool layer against the live store.
  await writeJsonFile(`${runtimePath}/messages.json`, [])
  return {
    teamName,
    runtimePath,
    leadAgentId,
    createdAt: now,
    permissionMode: 'default',
    teamAllowedPaths
  }
}

async function handleTeamDelete(args: DeleteTeamRuntimeArgs): Promise<{ success: true }> {
  const teamName = sanitizeTeamName(args.teamName)
  if (!teamName) throw new Error('Invalid team name')
  try { await tauriCommands.invoke('fs:delete', { path: `${await teamsDir()}/${teamName}` }) } catch { /* already gone */ }
  return { success: true }
}

async function handleTeamMessageAppend(args: AppendTeamRuntimeMessageArgs): Promise<{ success: true }> {
  const teamName = sanitizeTeamName(args.teamName)
  if (!teamName) throw new Error('Invalid team name')
  const msgPath = `${await teamsDir()}/${teamName}/messages.json`
  const messages = await readJsonFile<TeamRuntimeMessageRecord[]>(msgPath, [])
  messages.push(args.message)
  await writeJsonFile(msgPath, messages)
  return { success: true }
}

async function handleTeamMessagesConsume(args: ConsumeTeamRuntimeMessagesArgs): Promise<TeamRuntimeMessageRecord[]> {
  const teamName = sanitizeTeamName(args.teamName)
  if (!teamName) throw new Error('Invalid team name')
  const msgPath = `${await teamsDir()}/${teamName}/messages.json`
  const all = await readJsonFile<TeamRuntimeMessageRecord[]>(msgPath, [])
  const since = args.afterTimestamp ?? 0
  let consumed = all.filter((m) => m.timestamp > since)
  if (args.recipient) {
    consumed = consumed.filter((m) => m.to === args.recipient || (args.includeBroadcast && m.to === 'all'))
  } else if (args.includeBroadcast) {
    consumed = consumed.filter((m) => m.to === 'all')
  }
  const limit = args.limit ?? consumed.length
  return consumed.slice(-limit)
}

async function handleTeamCommand(channel: string, args: unknown[]): Promise<unknown> {
  const a = args[0]
  switch (channel) {
    case 'team-runtime:create': return handleTeamCreate(a as CreateTeamRuntimeArgs)
    case 'team-runtime:delete': return handleTeamDelete(a as DeleteTeamRuntimeArgs)
    case 'team-runtime:message:append': return handleTeamMessageAppend(a as AppendTeamRuntimeMessageArgs)
    case 'team-runtime:messages:consume': return handleTeamMessagesConsume(a as ConsumeTeamRuntimeMessagesArgs)
    default: throw new Error(`Unknown team command: ${channel}`)
  }
}

// Resource Commands

async function handleResourceCommand(channel: string, args: unknown[]): Promise<unknown> {
  const a0 = args[0] as Record<string, unknown> | undefined
  const str0 = typeof args[0] === 'string' ? args[0] : (a0?.name as string) ?? ''

  switch (channel) {
    case 'prompts:list': return rm.listPrompts()
    case 'prompts:load': { const content = await rm.loadPrompt(str0); return { content } }
    case 'commands:list': return rm.listCommands()
    case 'commands:load': { const content = await rm.loadCommand(str0); return { content } }
    case 'commands:manage-list': return rm.listManagedItems('commands')
    case 'commands:manage-read': { const content = await rm.readManagedResource('commands', str0); return { content } }
    case 'commands:manage-create': { const path = await rm.createManagedResource('commands', str0, a0?.content as string); return { success: true, path } }
    case 'commands:manage-save': { await rm.saveManagedResource('commands', str0, (a0?.content as string) ?? ''); return { success: true } }
    case 'agents:list': return rm.listAgents()
    case 'agents:manage-list': return rm.listManagedItems('agents')
    case 'agents:manage-read': { const content = await rm.readManagedResource('agents', str0); return { content } }
    case 'agents:manage-save': { await rm.saveManagedResource('agents', str0, (a0?.content as string) ?? ''); return { success: true } }
    case 'skills:list': return rm.listSkills()
    case 'skills:load': {
      const result = await rm.readSkill(str0, a0?.workspace as string | undefined)
      const workingDirectory = result.path.replace(/\/SKILL\.md$/, '')
      return { content: result.content, workingDirectory }
    }
    case 'skills:delete': { await rm.deleteSkill(str0); return { success: true } }
    case 'skills:set-enabled': { await rm.saveSkillState(str0, a0?.enabled === true); return { success: true } }
    case 'skills:open-folder': { await rm.openSkillFolder(str0); return { success: true } }
    case 'skills:add-from-folder': return rm.addSkillFromFolder(a0?.sourcePath as string)
    case 'skills:preview': return rm.previewSkillFolder(a0?.sourcePath as string)
    case 'skills:scan-workspace': return rm.scanWorkspaceSkills(str0)
    default: throw new Error(`Unknown resource command: ${channel}`)
  }
}
