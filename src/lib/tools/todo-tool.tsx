import * as React from 'react'
import { nanoid } from 'nanoid'
import { toolRegistry } from '../agent/tool-registry'
import { useTodoStore, type TodoItem } from '@/stores/todo-store'
import { useTeamStore } from '@/stores/team-store'
import { teamEvents } from '../agent/teams/events'
import type { TeamTask } from '../agent/teams/types'
import { encodeStructuredToolResult } from './tool-result-format'
import { decodeStructuredToolResult } from './tool-result-format'
import type { ToolHandler } from './tool-types'
import type { ToolPanelContext } from './tool-render-types'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint, isToolLive } from '@/components/chat/tool-panel/parts'
import { firstStringInput, formatStructuredInputValue, enumLabel } from '@/components/chat/tool-panel/utils'

// Helpers: dual-mode (standalone vs. team)

function hasActiveTeam(taskId?: string): boolean {
  return taskId ? !!useTeamStore.getState().activeTeams[taskId] : false
}

function getTeamTasks(taskId?: string): TeamTask[] {
  return taskId ? (useTeamStore.getState().activeTeams[taskId]?.tasks ?? []) : []
}

function getStandaloneTasks(taskId?: string): TodoItem[] {
  const store = useTodoStore.getState()
  return taskId ? store.getPlanItemsByTask(taskId) : store.getPlanItems()
}

function getStandaloneTask(ctxTaskId: string | undefined, taskId: string): TodoItem | undefined {
  // Scoped lookup when chat task context is available
  if (ctxTaskId) {
    const found = getStandaloneTasks(ctxTaskId).find((t) => t.id === taskId)
    if (found) return found
  }
  // Fallback: search all in-memory tasks
  return useTodoStore.getState().getPlanItem(taskId)
}

function normalizeTaskTitlePart(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function resolveTaskTitle(input: Record<string, unknown>, fallbackTitle = ''): string {
  const title = normalizeTaskTitlePart(input.title)
  return title || normalizeTaskTitlePart(fallbackTitle)
}

function hasTaskTitlePatch(input: Record<string, unknown>): boolean {
  return input.title !== undefined
}

function toTaskSnapshot(
  task: Pick<TodoItem, 'id' | 'subject' | 'activeForm' | 'status' | 'owner'>
): {
  id: string
  title: string
  subject: string
  activeForm?: string
  status: TodoItem['status']
  owner?: string | null
} {
  return {
    id: task.id,
    title: task.subject,
    subject: task.subject,
    activeForm: task.activeForm,
    status: task.status,
    owner: task.owner
  }
}

function buildStandaloneTaskSnapshot(taskId?: string): {
  total: number
  completed: number
  tasks: Array<ReturnType<typeof toTaskSnapshot>>
} {
  const tasks = getStandaloneTasks(taskId)
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    tasks: tasks.map(toTaskSnapshot)
  }
}

// TaskCreate

const taskCreateHandler: ToolHandler = {
  definition: {
    name: 'TaskCreate',
    description:
      'Create a task for the current taskItem. Use this to track progress on complex multi-step work. Tasks are displayed in the Steps panel.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'A detailed task title with enough context that no separate description is needed'
        },
        activeForm: {
          type: 'string',
          description:
            'Present continuous form shown in spinner when in_progress (e.g., "Running tests")'
        },
        metadata: {
          type: 'object',
          description: 'Arbitrary metadata to attach to the task'
        }
      },
      required: ['title']
    }
  },
  execute: async (input, ctx) => {
    const subject = resolveTaskTitle(input)
    if (!subject) {
      return encodeStructuredToolResult({ error: 'TaskCreate requires a non-empty title.' })
    }
    const activeForm = input.activeForm ? String(input.activeForm) : undefined
    const metadata = input.metadata as Record<string, unknown> | undefined
    const id = nanoid(5)

    if (hasActiveTeam(ctx.taskId)) {
      // Team mode: check for duplicate, then emit team event
      const existing = getTeamTasks(ctx.taskId).find((t) => t.subject === subject)
      if (existing) {
        return encodeStructuredToolResult({
          success: true,
          task_id: existing.id,
          title: existing.subject,
          subject: existing.subject,
          note: 'Task with this title already exists, returning existing task.'
        })
      }
      const task: TeamTask = {
        id,
        subject,
        description: '',
        status: 'pending',
        owner: null,
        dependsOn: [],
        activeForm
      }
      teamEvents.emit({ type: 'team_task_add', task })
      return encodeStructuredToolResult({ success: true, task_id: id, title: subject, subject })
    }

    // Standalone mode: add to plan-item-store
    if (!ctx.taskId) {
      return encodeStructuredToolResult({ error: 'No active task context for TaskCreate.' })
    }

    const task: TodoItem = {
      id,
      taskId: ctx.taskId,
      subject,
      description: '',
      activeForm,
      status: 'pending',
      owner: null,
      blocks: [],
      blockedBy: [],
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    useTodoStore.getState().addPlanItem(task)
    return encodeStructuredToolResult({
      success: true,
      task_id: id,
      title: subject,
      subject,
      task: toTaskSnapshot(task),
      ...buildStandaloneTaskSnapshot(ctx.taskId)
    })
  },
  groups: ['task-management'],
  render: { kind: 'native-panel', renderHeader: taskHeader, renderBadges: taskBadges, renderBody: taskBody },
}

// TaskGet

const taskGetHandler: ToolHandler = {
  definition: {
    name: 'TaskGet',
    description:
      'Retrieve a task by its ID to inspect its title, status, ownership, and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to retrieve'
        }
      },
      required: ['taskId']
    }
  },
  execute: async (input, ctx) => {
    const taskId = String(input.taskId)

    if (hasActiveTeam(ctx.taskId)) {
      const task = getTeamTasks(ctx.taskId).find((t) => t.id === taskId)
      if (!task) return encodeStructuredToolResult({ error: `Task "${taskId}" not found` })
      return encodeStructuredToolResult({
        id: task.id,
        title: task.subject,
        subject: task.subject,
        status: task.status,
        owner: task.owner,
        activeForm: task.activeForm,
        dependsOn: task.dependsOn
      })
    }

    const task = getStandaloneTask(ctx.taskId, taskId)
    if (!task) return encodeStructuredToolResult({ error: `Task "${taskId}" not found` })

    return encodeStructuredToolResult({
      id: task.id,
      title: task.subject,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      activeForm: task.activeForm,
      blocks: task.blocks,
      blockedBy: task.blockedBy,
      metadata: task.metadata
    })
  },
  groups: ['task-management'],
  render: { kind: 'native-panel', renderHeader: taskHeader, renderBadges: taskBadges, renderBody: taskBody },
}

// TaskUpdate

const taskUpdateHandler: ToolHandler = {
  definition: {
    name: 'TaskUpdate',
    description:
      'Update a task: change status, title, owner, or manage dependencies. Set status to "deleted" to permanently remove a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to update' },
        title: {
          type: 'string',
          description:
            'New detailed title for the task. Include enough detail that no description is needed.'
        },
        activeForm: {
          type: 'string',
          description:
            'Present continuous form shown in spinner when in_progress (e.g., "Running tests")'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'deleted'],
          description: 'New status for the task'
        },
        addBlocks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that this task blocks'
        },
        addBlockedBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that block this task'
        },
        owner: { type: 'string', description: 'New owner for the task' },
        metadata: {
          type: 'object',
          description: 'Metadata keys to merge into the task. Set a key to null to delete it.'
        }
      },
      required: ['taskId']
    }
  },
  execute: async (input, ctx) => {
    const taskId = String(input.taskId)
    const newStatus = input.status ? String(input.status) : undefined

    // --- Team mode ---
    if (hasActiveTeam(ctx.taskId)) {
      const team = useTeamStore.getState().activeTeams[ctx.taskId!]!
      const task = team.tasks.find((t) => t.id === taskId)
      if (!task) return encodeStructuredToolResult({ error: `Task "${taskId}" not found` })

      if (newStatus === 'deleted') {
        // Team tasks don't support delete natively; mark completed with note
        teamEvents.emit({
          type: 'team_task_update',
          taskId,
          patch: { status: 'completed', report: '[deleted]' }
        })
        return encodeStructuredToolResult({ success: true, task_id: taskId, deleted: true })
      }

      const patch: Record<string, unknown> = {}
      if (newStatus && ['pending', 'in_progress', 'completed'].includes(newStatus)) {
        if (task.status === 'completed' && newStatus !== 'completed') {
          return encodeStructuredToolResult({
            error: `Task "${taskId}" is already completed and cannot be reverted.`
          })
        }
        patch.status = newStatus
      }
      if (hasTaskTitlePatch(input)) {
        const nextTitle = resolveTaskTitle(input, task.subject)
        if (nextTitle && nextTitle !== task.subject) patch.subject = nextTitle
      }
      if (input.activeForm !== undefined) patch.activeForm = String(input.activeForm)
      if (input.owner !== undefined) patch.owner = String(input.owner)
      if (input.report !== undefined && patch.status === 'completed') {
        patch.report = String(input.report)
      }

      teamEvents.emit({ type: 'team_task_update', taskId, patch })
      return encodeStructuredToolResult({ success: true, task_id: taskId, updated: patch })
    }

    // --- Standalone mode ---
    const store = useTodoStore.getState()
    const task = getStandaloneTask(ctx.taskId, taskId)
    if (!task) return encodeStructuredToolResult({ error: `Task "${taskId}" not found` })

    if (newStatus === 'deleted') {
      store.deletePlanItem(taskId)
      return encodeStructuredToolResult({ success: true, task_id: taskId, deleted: true })
    }

    const patch: Partial<TodoItem> = {}
    if (newStatus && ['pending', 'in_progress', 'completed'].includes(newStatus)) {
      patch.status = newStatus as TodoItem['status']
    }
    if (hasTaskTitlePatch(input)) {
      const nextTitle = resolveTaskTitle(input, task.subject)
      if (nextTitle && nextTitle !== task.subject) patch.subject = nextTitle
    }
    if (input.activeForm !== undefined) patch.activeForm = String(input.activeForm)
    if (input.owner !== undefined) patch.owner = String(input.owner)

    // Dependency management
    if (Array.isArray(input.addBlocks)) {
      const newBlocks = input.addBlocks.map(String)
      patch.blocks = [...new Set([...task.blocks, ...newBlocks])]
      // Also add this task to the blockedBy list of the target tasks
      for (const blockedId of newBlocks) {
        const blocked = getStandaloneTask(ctx.taskId, blockedId)
        if (blocked) {
          store.updatePlanItem(blockedId, {
            blockedBy: [...new Set([...blocked.blockedBy, taskId])]
          })
        }
      }
    }
    if (Array.isArray(input.addBlockedBy)) {
      const newBlockedBy = input.addBlockedBy.map(String)
      patch.blockedBy = [...new Set([...task.blockedBy, ...newBlockedBy])]
      // Also add this task to the blocks list of the dependency tasks
      for (const depId of newBlockedBy) {
        const dep = getStandaloneTask(ctx.taskId, depId)
        if (dep) {
          store.updatePlanItem(depId, {
            blocks: [...new Set([...dep.blocks, taskId])]
          })
        }
      }
    }

    // Metadata merge
    if (input.metadata && typeof input.metadata === 'object') {
      const merged = { ...(task.metadata ?? {}) }
      for (const [k, v] of Object.entries(input.metadata as Record<string, unknown>)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      patch.metadata = merged
    }

    const updatedTask = store.updatePlanItem(taskId, patch)
    return encodeStructuredToolResult({
      success: true,
      task_id: taskId,
      updated: patch,
      task: updatedTask ? toTaskSnapshot(updatedTask) : undefined,
      ...buildStandaloneTaskSnapshot(ctx.taskId)
    })
  },
  groups: ['task-management'],
  render: { kind: 'native-panel', renderHeader: taskHeader, renderBadges: taskBadges, renderBody: taskBody },
}

// TaskList

const taskListHandler: ToolHandler = {
  definition: {
    name: 'TaskList',
    description:
      'List all tasks in the current task with their detailed titles, status, owner, and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  execute: async (_input, ctx) => {
    if (hasActiveTeam(ctx.taskId)) {
      const team = useTeamStore.getState().activeTeams[ctx.taskId!]!
      const tasks = team.tasks
      return encodeStructuredToolResult({
        mode: 'team',
        team_name: team.name,
        total: tasks.length,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.subject,
          subject: t.subject,
          status: t.status,
          owner: t.owner,
          dependsOn: t.dependsOn
        }))
      })
    }

    const tasks = getStandaloneTasks(ctx.taskId)

    return encodeStructuredToolResult({
      mode: 'standalone',
      total: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.subject,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy.filter(
          (bid) => getStandaloneTask(ctx.taskId, bid)?.status !== 'completed'
        )
      }))
    })
  },
  groups: ['task-management'],
  render: { kind: 'native-panel', renderHeader: taskHeader, renderBadges: taskBadges, renderBody: taskBody },
}

// Render functions

interface TaskSnapshot {
  id?: string
  title?: string
  subject?: string
  status?: string
  activeForm?: string
  owner?: string | null
  dependsOn?: string[]
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

type ParsedTaskOutput =
  | { kind: 'empty' }
  | { kind: 'error'; error: string }
  | { kind: 'list'; tasks: TaskSnapshot[]; total?: number; mode?: string }
  | { kind: 'single'; task: TaskSnapshot; updated?: Record<string, unknown> }

function parseTaskOutput(outputText: string | undefined): ParsedTaskOutput {
  if (!outputText) return { kind: 'empty' }
  const parsed = decodeStructuredToolResult(outputText)
  if (!parsed || Array.isArray(parsed)) return { kind: 'empty' }

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return { kind: 'error', error: parsed.error.trim() }
  }

  if (Array.isArray(parsed.tasks)) {
    return {
      kind: 'list',
      tasks: parsed.tasks as TaskSnapshot[],
      total: typeof parsed.total === 'number' ? parsed.total : undefined,
      mode: typeof parsed.mode === 'string' ? parsed.mode : undefined
    }
  }

  let task: TaskSnapshot | undefined

  if (parsed.task && typeof parsed.task === 'object' && !Array.isArray(parsed.task)) {
    task = parsed.task as TaskSnapshot
  } else if (typeof parsed.id === 'string') {
    // Build task from flat fields instead of casting the whole object,
    // since parsed is Record<string, unknown> and doesn't overlap with TaskSnapshot.
    task = {
      id: parsed.id,
      subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      status: typeof parsed.status === 'string' ? parsed.status : undefined,
      activeForm: typeof parsed.activeForm === 'string' ? parsed.activeForm : undefined,
      owner: typeof parsed.owner === 'string' ? parsed.owner : null,
    }
  }

  if (!task?.subject && typeof parsed.subject === 'string') {
    task = { ...task, subject: parsed.subject, title: typeof parsed.title === 'string' ? parsed.title : undefined }
  }
  if (task && !task.id && typeof parsed.task_id === 'string') {
    task = { ...task, id: parsed.task_id }
  }

  if (!task) return { kind: 'empty' }

  return {
    kind: 'single',
    task,
    updated: parsed.updated as Record<string, unknown> | undefined
  }
}

function resolveTaskSubject(taskId: string): string | null {
  const allTeams = Object.values(useTeamStore.getState().activeTeams)
  for (const team of allTeams) {
    const teamTask = team.tasks.find((t) => t.id === taskId)
    if (teamTask?.subject) return teamTask.subject
  }
  const standalone = useTodoStore.getState().getPlanItem(taskId)
  if (standalone?.subject) return standalone.subject
  return null
}

const STATUS_TONE: Record<string, 'blue' | 'amber' | 'green'> = {
  pending: 'blue',
  in_progress: 'amber',
  completed: 'green'
}

function statusBadgeTone(status: string): 'blue' | 'amber' | 'green' | 'default' {
  return STATUS_TONE[status] ?? 'default'
}

function statusLabel(ctx: ToolPanelContext, status: string | undefined): string {
  return enumLabel(ctx.t, 'taskPanel.status', status)
}

function renderDependencyRow(
  ctx: ToolPanelContext,
  label: string,
  value: string[] | undefined
): React.ReactNode {
  if (!Array.isArray(value) || value.length === 0) return null
  return <FieldRow label={label} value={value.join(', ')} mono />
}

const HEADER_COVERED: ReadonlySet<string> = new Set([
  'title', 'subject', 'name', 'content',
  'taskId', 'task_id', 'id',
  'status', 'state'
])

function taskHeader(ctx: ToolPanelContext): React.ReactNode {
  const { outputText, status } = ctx
  const parsed = parseTaskOutput(outputText)

  if (isToolLive(status) || parsed.kind === 'empty') {
    return streamingHeader(ctx)
  }

  switch (parsed.kind) {
    case 'error':
      return errorHeader(ctx, parsed.error)
    case 'list':
      return taskListHeader(ctx, parsed)
    case 'single':
      return singleTaskHeader(ctx, parsed)
  }
}

function streamingHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, displayName, name } = ctx

  if (name === 'TaskList') {
    return (
      <ToolPanelLead
        icon={<ToolIcon name={name} />}
        title={displayName}
        titleAttr={displayName}
      />
    )
  }

  const inputTitle = firstStringInput(input, ['title', 'subject'])
  const inputId = firstStringInput(input, ['taskId', 'task_id', 'id'])

  if (inputTitle) {
    return (
      <ToolPanelLead
        icon={<ToolIcon name={name} />}
        title={ctx.t('toolPanel.title.TaskCreate', { title: inputTitle })}
        titleAttr={inputTitle}
      />
    )
  }

  if (inputId) {
    const memTitle = resolveTaskSubject(inputId)
    const display = memTitle || inputId
    const titleKey = name === 'TaskUpdate' ? 'toolPanel.title.TaskUpdate' : 'toolPanel.title.TaskGet'
    return (
      <ToolPanelLead
        icon={<ToolIcon name={name} />}
        title={ctx.t(titleKey, { title: display })}
        titleAttr={memTitle ? `${memTitle}\n#${inputId}` : `#${inputId}`}
      />
    )
  }

  return (
    <ToolPanelLead
      icon={<ToolIcon name={name} />}
      title={displayName}
      titleAttr={displayName}
    />
  )
}

function errorHeader(ctx: ToolPanelContext, error: string): React.ReactNode {
  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={ctx.displayName}
      subtitle={error}
      titleAttr={error || ctx.displayName}
    />
  )
}

function taskListHeader(
  ctx: ToolPanelContext,
  parsed: Extract<ParsedTaskOutput, { kind: 'list' }>
): React.ReactNode {
  const total = parsed.total ?? parsed.tasks.length
  const completed = parsed.tasks.filter((t) => t.status === 'completed').length

  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={ctx.t('toolPanel.title.TaskList', { total })}
      subtitle={
        completed > 0
          ? ctx.t('taskPanel.taskListProgress', { completed, total })
          : undefined
      }
      titleAttr={ctx.displayName}
    />
  )
}

function singleTaskHeader(
  ctx: ToolPanelContext,
  parsed: Extract<ParsedTaskOutput, { kind: 'single' }>
): React.ReactNode {
  const task = parsed.task
  const displayTitle = task.subject || task.title || ''
  const titleKey = `toolPanel.title.${ctx.name}`
  const primaryTitle = ctx.t(titleKey, { title: displayTitle })

  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={displayTitle ? primaryTitle : ctx.displayName}
      subtitle={task.status ? statusLabel(ctx, task.status) : undefined}
      titleAttr={[task.subject, task.title, task.id].filter(Boolean).join('\n') || ctx.displayName}
    />
  )
}

function taskBadges(ctx: ToolPanelContext): React.ReactNode {
  const { outputText, status } = ctx
  if (isToolLive(status)) return null
  const parsed = parseTaskOutput(outputText)
  if (!parsed || parsed.kind === 'empty' || parsed.kind === 'error') return null

  if (parsed.kind === 'list') {
    const total = parsed.total ?? parsed.tasks.length
    const completed = parsed.tasks.filter((t) => t.status === 'completed').length
    if (completed <= 0) return null
    return (
      <Badge tone="green">
        {completed}/{total}
      </Badge>
    )
  }

  if (parsed.kind === 'single') {
    const task = parsed.task
    if (!task.status) return null
    return (
      <Badge tone={statusBadgeTone(task.status)}>
        {statusLabel(ctx, task.status)}
      </Badge>
    )
  }

  return null
}

function taskBody(ctx: ToolPanelContext): React.ReactNode {
  const { input, outputText, error, status } = ctx
  const parsed = parseTaskOutput(outputText)

  const uncovered = Object.entries(input).filter(
    ([k, v]) => !HEADER_COVERED.has(k) && v != null && v !== ''
  )

  const displayError =
    error ||
    (status === 'error' && parsed.kind === 'error' ? parsed.error : null)

  return (
    <div className="space-y-2">
      {uncovered.length > 0 && (
        <div className="space-y-0.5">
          {uncovered.map(([key, value]) => {
            const formatted = formatStructuredInputValue(value)
            return (
              <FieldRow
                key={key}
                label={key}
                value={formatted.text}
                mono={formatted.mono}
              />
            )
          })}
        </div>
      )}

      {parsed.kind === 'single' && (
        <div
          className={
            uncovered.length > 0
              ? 'space-y-0.5 border-t border-border/30 pt-2'
              : 'space-y-0.5'
          }
        >
          {parsed.updated && (
            <FieldRow
              label="updated"
              value={Object.keys(parsed.updated).join(', ')}
              mono
            />
          )}
          {parsed.task.id && <FieldRow label="id" value={parsed.task.id} mono />}
          {parsed.task.owner && (
            <FieldRow label="owner" value={parsed.task.owner} />
          )}
          {parsed.task.activeForm && (
            <FieldRow label="activeForm" value={parsed.task.activeForm} />
          )}
          {renderDependencyRow(ctx, 'dependsOn', parsed.task.dependsOn)}
          {renderDependencyRow(ctx, 'blocks', parsed.task.blocks)}
          {renderDependencyRow(ctx, 'blockedBy', parsed.task.blockedBy)}
          {parsed.task.metadata &&
            Object.keys(parsed.task.metadata).length > 0 &&
            Object.entries(parsed.task.metadata).map(([key, value]) => {
              const formatted = formatStructuredInputValue(value)
              return (
                <FieldRow
                  key={`meta-${key}`}
                  label={ctx.t('taskPanel.metadataPrefix', { key })}
                  value={formatted.text}
                  mono={formatted.mono}
                />
              )
            })}
        </div>
      )}

      {parsed.kind === 'list' && parsed.tasks.length > 0 && (
        <div
          className={
            uncovered.length > 0
              ? 'space-y-1 border-t border-border/30 pt-2'
              : 'space-y-1'
          }
        >
          {parsed.tasks.map((task, i) => (
            <div
              key={task.id || i}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/40"
            >
              <Badge tone={statusBadgeTone(task.status || 'pending')}>
                {statusLabel(ctx, task.status || 'pending')}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {task.subject || task.title || task.id}
              </span>
              {task.owner ? (
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {task.owner}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {parsed.kind === 'empty' && uncovered.length === 0 && !displayError && (
        <EmptyHint ctx={ctx} />
      )}

      {displayError && <ErrorBlock text={displayError} />}
    </div>
  )
}

// Registration

export function registerTaskTools(): void {
  toolRegistry.add(taskCreateHandler)
  toolRegistry.add(taskGetHandler)
  toolRegistry.add(taskUpdateHandler)
  toolRegistry.add(taskListHandler)
}

export const todoToolModule: import('./tool-module').ToolModule = { register: registerTaskTools }
