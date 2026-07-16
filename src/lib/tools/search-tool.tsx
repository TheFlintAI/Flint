import * as React from 'react'
import { toolRegistry } from '../agent/tool-registry'
import { joinFsPath } from '../agent/project-memory'
import { isAbsolutePath } from './fs-tool'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { encodeStructuredToolResult } from './tool-result-format'
import type { ToolHandler } from './tool-types'
import type { ToolPanelContext } from './tool-render-types'
import { ToolPanelLead, ToolIcon, Badge } from '@/components/chat/tool-panel/parts'
import { getStringInput, compactPath, searchScopeText } from '@/components/chat/tool-panel/utils'
import {
  GrepOutputBlock,
  GlobOutputBlock,
  parseGrepOutput,
  parseGlobOutput,
  getSearchVisualState,
  SearchStateBadge
} from '@/components/chat/tool-panel/SearchOutputBlocks'

const PROMPT_SEARCH_MAX_MATCHES = 100
const PROMPT_SEARCH_FETCH_LIMIT = PROMPT_SEARCH_MAX_MATCHES + 1
const PROMPT_SEARCH_MAX_OUTPUT_BYTES = 64 * 1024
const PROMPT_GREP_MAX_LINE_LENGTH = 160
const PROMPT_GREP_MAX_MATCHES = 200
const PROMPT_GREP_MAX_OUTPUT_BYTES = 64 * 1024
const textEncoder = new TextEncoder()

// ── Path resolution ──────────────────────────────────────────────────

function resolveSearchPath(inputPath: unknown, workingFolder?: string): string | undefined {
  const raw = typeof inputPath === 'string' ? inputPath.trim() : ''
  const base = workingFolder?.trim()
  if (!raw || raw === '.') {
    return base && base.length > 0 ? base : undefined
  }
  if (isAbsolutePath(raw)) return raw
  if (base && base.length > 0) return joinFsPath(base, raw)
  return raw
}

// ── Prompt byte capping ──────────────────────────────────────────────

function estimatePromptBytes(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length
}

function limitGlobPathsForPrompt(paths: string[]): {
  matches: string[]
  truncated: boolean
  limitReason: string | null
} {
  const matches: string[] = []
  let totalBytes = 2
  for (const p of paths) {
    if (matches.length >= PROMPT_SEARCH_MAX_MATCHES) {
      return { matches, truncated: true, limitReason: 'maxResults' }
    }
    const candidateBytes = estimatePromptBytes(p) + 1
    if (totalBytes + candidateBytes > PROMPT_SEARCH_MAX_OUTPUT_BYTES) {
      return { matches, truncated: true, limitReason: 'maxOutputBytes' }
    }
    matches.push(p)
    totalBytes += candidateBytes
  }
  return { matches: paths, truncated: false, limitReason: null }
}

type GrepMatchItem = {
  path: string
  line?: number
  column?: number
  text?: string
  kind?: 'match' | 'context'
  count?: number
}

function limitGrepMatchesForPrompt(raw: GrepMatchItem[]): {
  matches: GrepMatchItem[]
  truncated: boolean
  limitReason: string | null
} {
  const matches: GrepMatchItem[] = []
  let totalBytes = 2
  for (const item of raw) {
    if (matches.length >= PROMPT_GREP_MAX_MATCHES) {
      return { matches, truncated: true, limitReason: 'maxResults' }
    }
    const text = typeof item.text === 'string'
      ? item.text.length > PROMPT_GREP_MAX_LINE_LENGTH
        ? `${item.text.slice(0, PROMPT_GREP_MAX_LINE_LENGTH - 3)}...`
        : item.text
      : item.text
    const candidateBytes = estimatePromptBytes({
      file: item.path,
      line: item.line,
      column: item.column,
      text,
      kind: item.kind,
      count: item.count
    }) + 1
    if (totalBytes + candidateBytes > PROMPT_GREP_MAX_OUTPUT_BYTES) {
      return { matches, truncated: true, limitReason: 'maxOutputBytes' }
    }
    matches.push(text !== item.text ? { ...item, text } : item)
    totalBytes += candidateBytes
  }
  return { matches: raw, truncated: false, limitReason: null }
}

// ── Prompt formatting ────────────────────────────────────────────────

function formatGlobResultForPrompt(raw: { matches?: string[] } | string[]): Record<string, unknown> | unknown[] {
  const paths: string[] = Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === 'string')
    : Array.isArray(raw?.matches)
      ? raw.matches.filter((p): p is string => typeof p === 'string')
      : []
  const limited = limitGlobPathsForPrompt(paths)
  if (!limited.truncated) return limited.matches
  return {
    matches: limited.matches,
    truncated: true,
    limitReason: limited.limitReason
  }
}

function formatGrepLine(item: GrepMatchItem, outputMode?: string): string {
  if (outputMode === 'filesWithMatches') return item.path
  if (outputMode === 'count') return `${item.path}:${item.count ?? 0}`
  if (typeof item.line !== 'number') return item.path
  const sep = item.kind === 'context' ? '-' : ':'
  if (typeof item.column === 'number' && item.kind !== 'context') {
    return `${item.path}${sep}${item.line}${sep}${item.column}${sep}${item.text ?? ''}`
  }
  return `${item.path}${sep}${item.line}${sep}${item.text ?? ''}`
}

function formatGrepResultForPrompt(
  result: Record<string, unknown>
): string | Record<string, unknown> {
  const matches: GrepMatchItem[] = Array.isArray(result.matches) ? result.matches : []
  const outputMode = typeof result.outputMode === 'string' ? result.outputMode : undefined
  const limited = limitGrepMatchesForPrompt(matches)
  const meta = result.meta && typeof result.meta === 'object' ? result.meta as Record<string, unknown> : {}
  const truncated = limited.truncated || meta.truncated === true
  const limitReason = limited.limitReason ?? (typeof meta.limitReason === 'string' ? meta.limitReason : null)
  const warnings: string[] = Array.isArray(meta.warnings) ? meta.warnings.filter((w): w is string => typeof w === 'string') : []
  const filesSkipped = typeof meta.filesSkipped === 'number' ? meta.filesSkipped : undefined

  const output = limited.matches.map(m => formatGrepLine(m, outputMode)).join('\n')

  // Use compact form (plain text) when there are no issues to report
  const hasIssues = truncated || (warnings.length > 0) || filesSkipped
  if (!hasIssues && output) return output

  return {
    output,
    matches: limited.matches.map(m => ({
      file: m.path,
      line: m.line,
      column: m.column,
      text: m.text,
      kind: m.kind,
      count: m.count
    })),
    truncated,
    limitReason,
    warnings,
    filesSkipped
  }
}

// ── Render helpers ───────────────────────────────────────────────────

function grepHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, displayName, t } = ctx
  const pattern = getStringInput(input, ['pattern'])
  return (
    <ToolPanelLead
      icon={<ToolIcon name="Grep" />}
      title={pattern ? t('toolPanel.title.Grep', { pattern }) : displayName}
      subtitle={searchScopeText(input, t) || undefined}
      titleAttr={[pattern || '', searchScopeText(input, t)].filter(Boolean).join('\n') || displayName}
    />
  )
}

function grepBadges(ctx: ToolPanelContext): React.ReactNode {
  const { outputText, t } = ctx
  const parsed = outputText ? parseGrepOutput(outputText) : null
  const matchCount = parsed?.matches.length ?? null
  const fileCount = parsed ? new Set(parsed.matches.map(m => m.file)).size : null
  const badges: React.ReactNode[] = []
  if (parsed) badges.push(<SearchStateBadge key="state" state={getSearchVisualState(parsed.meta, parsed.matches.length)} />)
  if (matchCount !== null && fileCount !== null) {
    badges.push(
      <Badge key="count" tone={matchCount > 0 ? 'amber' : 'default'}>
        {t('toolCall.matchesInFiles', { matches: matchCount, files: fileCount })}
      </Badge>
    )
  }
  return badges.length ? <>{badges}</> : null
}

function grepBody(ctx: ToolPanelContext): React.ReactNode {
  if (!ctx.output || !ctx.outputText) return null
  return <GrepOutputBlock output={ctx.outputText} pattern={getStringInput(ctx.input, ['pattern'])} />
}

function globHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, displayName, t } = ctx
  const pattern = getStringInput(input, ['pattern'])
  const path = getStringInput(input, ['path'])
  return (
    <ToolPanelLead
      icon={<ToolIcon name="Glob" />}
      title={pattern ? t('toolPanel.title.Glob', { pattern }) : displayName}
      subtitle={path ? t('toolCall.searchInPath', { path: compactPath(path, 3) }) : undefined}
      titleAttr={[pattern, path].filter(Boolean).join('\n') || displayName}
    />
  )
}

function globBadges(ctx: ToolPanelContext): React.ReactNode {
  const { outputText, t } = ctx
  const parsed = outputText ? parseGlobOutput(outputText) : null
  const badges: React.ReactNode[] = []
  if (parsed) {
    badges.push(<SearchStateBadge key="state" state={getSearchVisualState(parsed.meta, parsed.matches.length)} />)
    badges.push(
      <Badge key="count" tone={parsed.matches.length > 0 ? 'green' : 'default'}>
        {t('toolCall.pathCount', { count: parsed.matches.length })}
      </Badge>
    )
  }
  return badges.length ? <>{badges}</> : null
}

function globBody(ctx: ToolPanelContext): React.ReactNode {
  if (!ctx.output || !ctx.outputText) return null
  return <GlobOutputBlock output={ctx.outputText} />
}

// ── Tool handlers ────────────────────────────────────────────────────

const globHandler: ToolHandler = {
  definition: {
    name: 'Glob',
    description:
      'Find files by glob pattern. Returns up to 100 paths sorted by modification time. Respects .gitignore.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match files' },
        path: {
          type: 'string',
          description: 'Optional search directory (absolute or relative to the working folder)'
        }
      },
      required: ['pattern']
    }
  },
  execute: async (input, ctx) => {
    const resolvedPath = resolveSearchPath(input.path, ctx.workingFolder)
    const result = await ctx.commands.invoke(TAURI_COMMANDS.FS_GLOB, {
      cwd: resolvedPath,
      pattern: input.pattern,
      limit: PROMPT_SEARCH_FETCH_LIMIT
    })
    return encodeStructuredToolResult(formatGlobResultForPrompt(result as Record<string, unknown> | string[]))
  },
  render: { kind: 'native-panel', renderHeader: globHeader, renderBadges: globBadges, renderBody: globBody }
}

const grepHandler: ToolHandler = {
  definition: {
    name: 'Grep',
    description:
      'Search file contents using regex (or literal strings). Respects .gitignore. Use outputMode="content" for file:line:text output. Handles non-UTF-8 files gracefully.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: {
          type: 'string',
          description: 'Directory to search in (absolute or relative to the working folder)'
        },
        include: {
          type: 'string',
          description: 'Comma-separated file globs to include, e.g. *.ts,*.tsx'
        },
        exclude: { type: 'string', description: 'Comma-separated file globs to exclude' },
        ignoreCase: { type: 'boolean', description: 'Use case-insensitive matching' },
        caseSensitive: { type: 'boolean', description: 'Use case-sensitive matching' },
        literal: { type: 'boolean', description: 'Treat pattern as a literal string' },
        outputMode: {
          type: 'string',
          enum: ['filesWithMatches', 'content', 'count'],
          description: 'Output mode. Default filesWithMatches.'
        },
        maxResults: { type: 'number', description: 'Maximum result rows to return' },
        maxLineLength: { type: 'number', description: 'Maximum text length per result line' }
      },
      required: ['pattern']
    }
  },
  execute: async (input, ctx) => {
    const resolvedPath = resolveSearchPath(input.path, ctx.workingFolder)
    const result = await ctx.commands.invoke(TAURI_COMMANDS.FS_GREP, {
      pattern: input.pattern,
      ...(resolvedPath ? { path: resolvedPath } : {}),
      include: input.include,
      exclude: input.exclude,
      ignoreCase: input.ignoreCase,
      caseSensitive: input.caseSensitive,
      literal: input.literal,
      outputMode: input.outputMode,
      maxResults: input.maxResults,
      maxLineLength: input.maxLineLength
    })
    const formatted = formatGrepResultForPrompt(result as Record<string, unknown>)
    return typeof formatted === 'string' ? formatted : encodeStructuredToolResult(formatted)
  },
  render: { kind: 'native-panel', renderHeader: grepHeader, renderBadges: grepBadges, renderBody: grepBody }
}

export function registerSearchTools(): void {
  toolRegistry.add(globHandler)
  toolRegistry.add(grepHandler)
}

export const searchToolModule: import('./tool-module').ToolModule = { register: registerSearchTools }
