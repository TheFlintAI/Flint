import * as React from 'react'
import { toolRegistry } from '../agent/tool-registry'
import {
  loadMemoryEntry,
  searchMemoryEntries,
  writeMemoryEntry,
  deleteMemoryEntry,
} from '../agent/memory-files'
import { normalizeMemoryType } from '@/protocols/memory-types'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import { decodeStructuredToolResult } from './tool-result-format'
import type { ToolHandler } from './tool-types'
import type { ToolPanelContext } from './tool-render-types'
import { ToolPanelLead, ToolIcon, Badge, FieldRow, ErrorBlock, EmptyHint, isToolLive } from '@/components/chat/tool-panel/parts'
import { firstStringInput, enumLabel } from '@/components/chat/tool-panel/utils'
import { MONO_FONT } from '@/lib/utils/fonts'

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// MemoryRead

const readHandler: ToolHandler = {
  definition: {
    name: 'MemoryRead',
    description:
      'Read a specific memory entry by ID. Returns metadata and the markdown body with numbered lines for citation.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: {
          type: 'string',
          description: 'Memory entry ID (e.g. pre_20240614_001) from MemorySearch results'
        }
      },
      required: ['entryId']
    }
  },
  execute: async (input, ctx) => {
    const entryId = asString(input.entryId)
    if (!entryId) return encodeToolError('MemoryRead requires an entryId.')

    const entry = await loadMemoryEntry(ctx.commands, entryId)
    if (!entry) {
      return encodeToolError(`Memory entry "${entryId}" not found. Use MemorySearch to find available entries.`)
    }

    const lines = entry.body.split(/\r?\n/)
    return encodeStructuredToolResult({
      id: entry.id,
      type: entry.type,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      lines: lines.map((text, index) => ({ line: index + 1, text }))
    })
  },
  render: { kind: 'native-panel', renderHeader: memoryHeader, renderBody: memoryBody }
}

// MemorySearch

const searchHandler: ToolHandler = {
  definition: {
    name: 'MemorySearch',
    description:
      'Search memory entries by semantic similarity (vector search) and text matching. Results include entry ID, type, score, and matching lines with line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for semantic + text matching' },
        limit: { type: 'number', description: 'Maximum matches to return, default 20' },
        type: { type: 'string', description: 'Filter by memory type: preference, decision, context, reference' },
      },
      required: ['query']
    }
  },
  execute: async (input, ctx) => {
    const query = asString(input.query)
    if (!query) return encodeToolError('MemorySearch requires a query.')
    const limit =
      typeof input.limit === 'number' && Number.isFinite(input.limit)
        ? Math.max(1, Math.min(100, Math.floor(input.limit)))
        : 20

    const results = await searchMemoryEntries(ctx.commands, {
      query,
      limit,
      type: asString(input.type) || undefined,
    })

    return encodeStructuredToolResult({
      query,
      matches: results.map((r) => ({
        entryId: r.entry.id,
        type: r.entry.type,
        score: Math.round(r.score * 1000) / 1000,
        matchedLines: r.matched_lines.map((ml) => ({ line: ml.line, text: ml.text })),
      })),
    })
  },
  render: { kind: 'native-panel', renderHeader: memoryHeader, renderBody: memoryBody }
}

// MemoryWrite

const writeHandler: ToolHandler = {
  definition: {
    name: 'MemoryWrite',
    description:
      'Create or update a memory entry. Provide entryId to update an existing entry, or type+body to create a new one. Entries are stored in the vector database with semantic embeddings.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: {
          type: 'string',
          description: 'Existing entry ID to update. Omit to create a new entry.'
        },
        type: {
          type: 'string',
          description: 'Memory type: preference, decision, context, reference. Required for new entries.'
        },
        body: {
          type: 'string',
          description: 'Markdown body for the memory entry.'
        }
      },
      required: ['body']
    }
  },
  execute: async (input, ctx) => {
    const body = asString(input.body)
    if (!body) return encodeToolError('MemoryWrite requires a body.')

    const entryId = asString(input.entryId) || undefined
    const rawType = asString(input.type)

    // Validate type for new entries
    if (!entryId) {
      if (!rawType) {
        return encodeToolError('MemoryWrite requires a type for new entries: preference, decision, context, reference.')
      }
      const resolved = normalizeMemoryType(rawType)
      if (!resolved) {
        return encodeToolError(`Invalid memory type "${rawType}". Must be: preference, decision, context, reference.`)
      }
    }

    const result = await writeMemoryEntry(ctx.commands, {
      id: entryId,
      type: rawType || undefined,
      body,
    })

    return encodeStructuredToolResult({
      id: result.id,
      type: result.type,
      action: entryId ? 'updated' : 'created'
    })
  },
  render: { kind: 'native-panel', renderHeader: memoryHeader, renderBody: memoryBody }
}

// MemoryDelete

const deleteHandler: ToolHandler = {
  definition: {
    name: 'MemoryDelete',
    description:
      'Delete a memory entry by ID. Use with caution — this is irreversible.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: {
          type: 'string',
          description: 'Memory entry ID to delete'
        }
      },
      required: ['entryId']
    }
  },
  execute: async (input, ctx) => {
    const entryId = asString(input.entryId)
    if (!entryId) return encodeToolError('MemoryDelete requires an entryId.')

    const success = await deleteMemoryEntry(ctx.commands, entryId)
    if (!success) {
      return encodeToolError(`Failed to delete memory entry "${entryId}". It may not exist.`)
    }

    return encodeStructuredToolResult({ deleted: true, id: entryId })
  },
  render: { kind: 'native-panel', renderHeader: memoryHeader, renderBody: memoryBody }
}

// Render functions

interface MemoryMatch {
  entryId: string
  type: string
  score: number
  matchedLines: Array<{ line: number; text: string }>
}

interface MemoryDetail {
  id: string
  type: string
  createdAt?: number
  updatedAt?: number
  lines: Array<{ line: number; text: string }>
}

type ParsedMemoryOutput =
  | { kind: 'empty' }
  | { kind: 'error'; error: string }
  | { kind: 'detail'; entry: MemoryDetail }
  | { kind: 'search'; query: string; matches: MemoryMatch[] }
  | { kind: 'write'; id: string; type: string; action: string }
  | { kind: 'delete'; id: string }

function parseMemoryOutput(outputText: string | undefined): ParsedMemoryOutput {
  if (!outputText) return { kind: 'empty' }
  const parsed = decodeStructuredToolResult(outputText)
  if (!parsed || Array.isArray(parsed)) return { kind: 'empty' }

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return { kind: 'error', error: parsed.error.trim() }
  }

  if (Array.isArray(parsed.lines) && typeof parsed.id === 'string') {
    return {
      kind: 'detail',
      entry: extractMemoryDetail(parsed)
    }
  }

  if (Array.isArray(parsed.matches)) {
    return {
      kind: 'search',
      query: typeof parsed.query === 'string' ? parsed.query : '',
      matches: (parsed.matches as unknown[]).map(extractMatch)
    }
  }

  if (typeof parsed.action === 'string' && typeof parsed.id === 'string') {
    return {
      kind: 'write',
      id: parsed.id,
      type: typeof parsed.type === 'string' ? parsed.type : '',
      action: parsed.action
    }
  }

  if (parsed.deleted === true && typeof parsed.id === 'string') {
    return { kind: 'delete', id: parsed.id }
  }

  return { kind: 'empty' }
}

function extractMatch(raw: unknown): MemoryMatch {
  const m = raw as Record<string, unknown>
  return {
    entryId: typeof m.entryId === 'string' ? m.entryId : '',
    type: typeof m.type === 'string' ? m.type : '',
    score: typeof m.score === 'number' ? m.score : 0,
    matchedLines: Array.isArray(m.matchedLines)
      ? (m.matchedLines as unknown[]).map((ml) => {
          const l = ml as Record<string, unknown>
          return {
            line: typeof l.line === 'number' ? l.line : 0,
            text: typeof l.text === 'string' ? l.text : ''
          }
        })
      : []
  }
}

function extractMemoryDetail(parsed: Record<string, unknown>): MemoryDetail {
  return {
    id: typeof parsed.id === 'string' ? parsed.id : '',
    type: typeof parsed.type === 'string' ? parsed.type : '',
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    lines: Array.isArray(parsed.lines)
      ? (parsed.lines as unknown[]).map((l) => {
          const o = l as Record<string, unknown>
          return {
            line: typeof o.line === 'number' ? o.line : 0,
            text: typeof o.text === 'string' ? o.text : ''
          }
        })
      : []
  }
}

const TYPE_TONE: Record<string, 'blue' | 'amber' | 'green' | 'default'> = {
  preference: 'amber',
  decision: 'blue',
  context: 'green',
  reference: 'default'
}

function typeTone(type: string): 'blue' | 'amber' | 'green' | 'default' {
  return TYPE_TONE[type] ?? 'default'
}

function typeLabel(ctx: ToolPanelContext, type: string | undefined): string {
  return enumLabel(ctx.t, 'memoryPanel.type', type)
}

function actionLabel(ctx: ToolPanelContext, action: string | undefined): string {
  return enumLabel(ctx.t, 'memoryPanel.action', action)
}

function formatTimestamp(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const HEADER_COVERED: ReadonlySet<string> = new Set([
  'entryId', 'query', 'body', 'type', 'limit'
])

function memoryHeader(ctx: ToolPanelContext): React.ReactNode {
  const { displayName, outputText, status, name } = ctx
  const live = isToolLive(status)
  const parsed = parseMemoryOutput(outputText)

  if (live || parsed.kind === 'empty') {
    return streamingMemoryHeader(ctx)
  }

  if (parsed.kind === 'error') {
    return (
      <ToolPanelLead
        icon={<ToolIcon name={name} />}
        title={displayName}
        subtitle={parsed.error}
        titleAttr={parsed.error || displayName}
      />
    )
  }

  switch (parsed.kind) {
    case 'detail':
      return (
        <ToolPanelLead
          icon={<ToolIcon name={name} />}
          title={ctx.t('toolPanel.title.MemoryRead', { id: parsed.entry.id })}
          subtitle={typeLabel(ctx, parsed.entry.type) || undefined}
          badges={
            <>
              <Badge tone={typeTone(parsed.entry.type)}>{typeLabel(ctx, parsed.entry.type)}</Badge>
            </>
          }
          titleAttr={`${parsed.entry.id}\n${parsed.entry.type}`}
        />
      )
    case 'search':
      return (
        <ToolPanelLead
          icon={<ToolIcon name={name} />}
          title={parsed.query ? ctx.t('toolPanel.title.MemorySearch', { query: parsed.query }) : displayName}
          badges={
            <Badge tone={parsed.matches.length > 0 ? 'amber' : 'default'}>
              {ctx.t('memoryPanel.matchCount', { count: parsed.matches.length })}
            </Badge>
          }
          titleAttr={parsed.query || displayName}
        />
      )
    case 'write':
      return (
        <ToolPanelLead
          icon={<ToolIcon name={name} />}
          title={
            parsed.action === 'created'
              ? ctx.t('toolPanel.title.MemoryWrite', { id: parsed.id })
              : ctx.t('toolPanel.title.MemoryWriteUpdated', { id: parsed.id })
          }
          subtitle={typeLabel(ctx, parsed.type) || undefined}
          badges={
            <>
              <Badge tone={typeTone(parsed.type)}>{typeLabel(ctx, parsed.type)}</Badge>
            </>
          }
          titleAttr={`${parsed.action}: ${parsed.id}`}
        />
      )
    case 'delete':
      return (
        <ToolPanelLead
          icon={<ToolIcon name={name} />}
          title={ctx.t('toolPanel.title.MemoryDelete', { id: parsed.id })}
          subtitle={ctx.t('memoryPanel.action.deleted')}
          badges={<Badge tone="red">{ctx.t('memoryPanel.action.deleted')}</Badge>}
          titleAttr={`deleted: ${parsed.id}`}
        />
      )
  }
}

function streamingMemoryHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, displayName, name } = ctx

  const entryId = firstStringInput(input, ['entryId'])
  if (entryId) {
    const title =
      name === 'MemoryRead' ? ctx.t('toolPanel.title.MemoryRead', { id: entryId }) :
      name === 'MemoryWrite' ? ctx.t('toolPanel.title.MemoryWrite', { id: entryId }) :
      name === 'MemoryDelete' ? ctx.t('toolPanel.title.MemoryDelete', { id: entryId }) :
      entryId
    return (
      <ToolPanelLead
        icon={<ToolIcon name={name} />}
        title={title}
        titleAttr={entryId}
      />
    )
  }

  const query = firstStringInput(input, ['query'])
  if (query) {
    return (
      <ToolPanelLead
        icon={<ToolIcon name={name} />}
        title={ctx.t('toolPanel.title.MemorySearch', { query })}
        titleAttr={query}
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

function memoryBody(ctx: ToolPanelContext): React.ReactNode {
  const { input, outputText, error, status } = ctx
  const parsed = parseMemoryOutput(outputText)

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
            const mono = typeof value === 'number' || Array.isArray(value)
            const text = typeof value === 'string' ? value : JSON.stringify(value)
            return <FieldRow key={key} label={key} value={text} mono={mono} />
          })}
        </div>
      )}

      {parsed.kind === 'detail' && (
        <div
          className={
            uncovered.length > 0
              ? 'space-y-2 border-t border-border/30 pt-2'
              : 'space-y-2'
          }
        >
          <div className="space-y-0.5">
            {parsed.entry.createdAt && (
              <FieldRow label="created" value={formatTimestamp(parsed.entry.createdAt)} />
            )}
            {parsed.entry.updatedAt && (
              <FieldRow label="updated" value={formatTimestamp(parsed.entry.updatedAt)} />
            )}
          </div>

          {parsed.entry.lines.length > 0 && (
            <pre
              className="max-h-64 overflow-auto rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs leading-5 text-foreground/80"
              style={{ fontFamily: MONO_FONT }}
            >
              {parsed.entry.lines.map((l) => (
                <span key={l.line} className="block">
                  <span className="mr-3 select-none text-muted-foreground/40">
                    {String(l.line).padStart(3, ' ')}
                  </span>
                  {l.text}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}

      {parsed.kind === 'search' && (
        <div
          className={
            uncovered.length > 0
              ? 'space-y-1 border-t border-border/30 pt-2'
              : 'space-y-1'
          }
        >
          {parsed.matches.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {ctx.t('memoryPanel.noMatches')}
            </span>
          ) : (
            parsed.matches.map((match, i) => (
              <div
                key={`${match.entryId}-${i}`}
                className="rounded-md border border-border/40 bg-muted/20 px-3 py-2"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-foreground/80">
                    {match.entryId}
                  </span>
                  <Badge tone={typeTone(match.type)}>{typeLabel(ctx, match.type)}</Badge>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                    {ctx.t('memoryPanel.score')}: {match.score.toFixed(3)}
                  </span>
                </div>
                {match.matchedLines.length > 0 && (
                  <pre
                    className="max-h-24 overflow-auto rounded bg-muted/40 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {match.matchedLines.map((ml) => (
                      <span key={ml.line} className="block">
                        <span className="mr-2 select-none text-muted-foreground/40">
                          {String(ml.line).padStart(3, ' ')}
                        </span>
                        {ml.text}
                      </span>
                    ))}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {parsed.kind === 'write' && (
        <div
          className={
            uncovered.length > 0
              ? 'space-y-0.5 border-t border-border/30 pt-2'
              : 'space-y-0.5'
          }
        >
          <FieldRow label="id" value={parsed.id} mono />
          <FieldRow label="type" value={typeLabel(ctx, parsed.type)} />
          <FieldRow label="action" value={actionLabel(ctx, parsed.action)} />
        </div>
      )}

      {parsed.kind === 'delete' && (
        <div
          className={
            uncovered.length > 0
              ? 'space-y-0.5 border-t border-border/30 pt-2'
              : 'space-y-0.5'
          }
        >
          <FieldRow label="id" value={parsed.id} mono />
          <FieldRow label="status" value={actionLabel(ctx, 'deleted')} />
        </div>
      )}

      {parsed.kind === 'empty' && uncovered.length === 0 && !displayError && (
        <EmptyHint ctx={ctx} />
      )}

      {displayError && <ErrorBlock text={displayError} />}
    </div>
  )
}

export function registerMemoryTools(): void {
  toolRegistry.add(readHandler)
  toolRegistry.add(searchHandler)
  toolRegistry.add(writeHandler)
  toolRegistry.add(deleteHandler)
}

export const memoryToolModule: import('./tool-module').ToolModule = { register: registerMemoryTools }
