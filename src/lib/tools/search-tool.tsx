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

type SearchLimitReason = 'max_results' | 'max_output_bytes' | 'timeout' | null

type SearchBackend = 'local'
type SearchEngine = 'rust_fallback'
type SearchPathStyle = 'absolute' | 'relative_to_search_root'
type GrepOutputMode = 'matches' | 'files_with_matches' | 'count'

/** Fields consumed by the Rust search backend and prompt formatter. */
type SearchMeta = {
  backend: SearchBackend
  engine?: SearchEngine
  searchRoot?: string
  pathStyle: SearchPathStyle
  truncated: boolean
  timedOut: boolean
  limitReason: SearchLimitReason
  pattern: string
  include?: string | null
  exclude?: string | null
  outputMode?: GrepOutputMode
  searchTime?: number
  warnings?: string[]
  maxResults?: number
  maxOutputBytes?: number
  maxLineLength?: number
}

type GlobToolResult = {
  kind: 'glob'
  matches: Array<{ path: string; type?: 'file' | 'directory' }>
  meta: SearchMeta
  error?: string
}

type GrepToolResult = {
  kind: 'grep'
  matches: Array<{
    path: string
    line?: number
    column?: number
    text?: string
    kind?: 'match' | 'context'
    count?: number
  }>
  meta: SearchMeta
  output?: string
  error?: string
}

const PROMPT_SEARCH_MAX_MATCHES = 100
const PROMPT_SEARCH_FETCH_LIMIT = PROMPT_SEARCH_MAX_MATCHES + 1
const PROMPT_SEARCH_MAX_OUTPUT_BYTES = 64 * 1024
const PROMPT_GREP_MAX_LINE_LENGTH = 160
const PROMPT_GREP_MAX_MATCHES = 200
const PROMPT_GREP_MAX_OUTPUT_BYTES = 64 * 1024
const textEncoder = new TextEncoder()

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLimitReason(value: unknown): SearchLimitReason {
  return value === 'max_results' || value === 'max_output_bytes' || value === 'timeout'
    ? value
    : null
}

function normalizeSearchEngine(value: unknown): SearchEngine | undefined {
  return value === 'rust_fallback' ? value : undefined
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalizeGrepOutputMode(value: unknown): GrepOutputMode {
  if (value === 'content') return 'matches'
  return value === 'files_with_matches' || value === 'count' ? value : 'files_with_matches'
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizePathValue(
  rawPath: unknown,
  searchRoot: string | undefined,
  pathStyle: SearchPathStyle
): string | null {
  if (typeof rawPath !== 'string') return null
  const trimmed = rawPath.trim()
  if (!trimmed) return null
  if (isAbsolutePath(trimmed) || pathStyle === 'absolute' || !searchRoot) return trimmed
  return joinFsPath(searchRoot, trimmed)
}

function createBaseMeta(args: {
  backend: SearchBackend
  engine?: SearchEngine
  pattern: string
  include?: string | null
  exclude?: string | null
  outputMode?: GrepOutputMode
  searchRoot?: string
  pathStyle?: SearchPathStyle
  truncated?: boolean
  timedOut?: boolean
  limitReason?: SearchLimitReason
  searchTime?: number
  warnings?: string[]
  maxResults?: number
  maxOutputBytes?: number
  maxLineLength?: number
}): SearchMeta {
  return {
    backend: args.backend,
    engine: args.engine,
    searchRoot: args.searchRoot,
    pathStyle: args.pathStyle ?? 'absolute',
    truncated: args.truncated === true,
    timedOut: args.timedOut === true,
    limitReason: args.limitReason ?? null,
    pattern: args.pattern,
    include: args.include ?? null,
    exclude: args.exclude ?? null,
    outputMode: args.outputMode ?? 'matches',
    searchTime: args.searchTime,
    warnings: args.warnings ?? [],
    maxResults: args.maxResults,
    maxOutputBytes: args.maxOutputBytes,
    maxLineLength: args.maxLineLength
  }
}

// Glob result normalization
// Backend returns { success, paths: string[] } (absolute paths from glob::glob).

function normalizeGlobResult(
  raw: unknown,
  options: {
    backend: SearchBackend
    pattern: string
    searchRoot?: string
  }
): GlobToolResult {
  const fallbackMeta = createBaseMeta({
    backend: options.backend,
    pattern: options.pattern,
    searchRoot: options.searchRoot,
    pathStyle: 'absolute'
  })

  if (Array.isArray(raw)) {
    return {
      kind: 'glob',
      matches: raw
        .map((item) => normalizePathValue(item, options.searchRoot, 'absolute'))
        .filter((item): item is string => !!item)
        .map((path) => ({ path })),
      meta: fallbackMeta
    }
  }

  if (!isRecord(raw)) {
    return {
      kind: 'glob',
      matches: [],
      meta: fallbackMeta,
      error: raw == null ? undefined : String(raw)
    }
  }

  const rawMeta = isRecord(raw.meta) ? raw.meta : null
  const meta = createBaseMeta({
    backend:
      rawMeta?.backend === 'local' ? rawMeta.backend : options.backend,
    engine: normalizeSearchEngine(rawMeta?.engine),
    pattern: typeof rawMeta?.pattern === 'string' ? rawMeta.pattern : options.pattern,
    searchRoot: typeof rawMeta?.searchRoot === 'string' ? rawMeta.searchRoot : options.searchRoot,
    pathStyle:
      rawMeta?.pathStyle === 'relative_to_search_root' ? 'relative_to_search_root' : 'absolute',
    truncated: rawMeta?.truncated === true,
    timedOut: rawMeta?.timedOut === true,
    limitReason: normalizeLimitReason(rawMeta?.limitReason),
    searchTime: typeof rawMeta?.searchTime === 'number' ? rawMeta.searchTime : undefined,
    warnings: normalizeWarnings(rawMeta?.warnings)
  })

  const matchesSource = Array.isArray(raw.paths)
    ? raw.paths
    : Array.isArray(raw.matches)
      ? raw.matches
      : Array.isArray(raw.results)
        ? raw.results
        : []

  const matches = matchesSource
    .map((item) => {
      if (typeof item === 'string') {
        const path = normalizePathValue(item, meta.searchRoot, meta.pathStyle)
        return path ? { path } : null
      }
      if (!isRecord(item)) return null
      const path = normalizePathValue(item.path, meta.searchRoot, meta.pathStyle)
      if (!path) return null
      const type = item.type === 'directory' || item.type === 'file' ? item.type : undefined
      return { path, type }
    })
    .filter((item): item is { path: string; type?: 'file' | 'directory' } => !!item)

  return {
    kind: 'glob',
    matches,
    meta,
    error: typeof raw.error === 'string' ? raw.error : undefined
  }
}

// Grep result normalization
// Backend returns { kind:'grep', matches:[...], meta:{...} } with pathStyle
// 'relative_to_search_root' and display paths relative to the search root.

function normalizeGrepMatchItem(item: unknown): GrepToolResult['matches'][number] | null {
  if (!isRecord(item)) return null
  const rawPath = item.path ?? item.file
  if (typeof rawPath !== 'string') return null
  const path = rawPath.trim()
  if (!path) return null
  return {
    path,
    line: typeof item.line === 'number' ? item.line : undefined,
    column: typeof item.column === 'number' ? item.column : undefined,
    text: typeof item.text === 'string' ? item.text : '',
    kind: item.kind === 'context' ? 'context' : 'match',
    count: typeof item.count === 'number' ? item.count : undefined
  }
}

function normalizeGrepResult(
  raw: unknown,
  options: {
    backend: SearchBackend
    pattern: string
    searchRoot?: string
    include?: string | null
    exclude?: string | null
  }
): GrepToolResult {
  const fallbackMeta = createBaseMeta({
    backend: options.backend,
    pattern: options.pattern,
    include: options.include,
    exclude: options.exclude,
    searchRoot: options.searchRoot,
    pathStyle: 'relative_to_search_root'
  })

  if (Array.isArray(raw)) {
    return {
      kind: 'grep',
      matches: raw
        .map((item) => normalizeGrepMatchItem(item))
        .filter((item): item is GrepToolResult['matches'][number] => !!item),
      meta: fallbackMeta
    }
  }

  if (!isRecord(raw)) {
    return {
      kind: 'grep',
      matches: [],
      meta: fallbackMeta,
      error: raw == null ? undefined : String(raw)
    }
  }

  const rawMeta = isRecord(raw.meta) ? raw.meta : null
  const meta = createBaseMeta({
    backend: rawMeta?.backend === 'local' ? rawMeta.backend : options.backend,
    engine: normalizeSearchEngine(rawMeta?.engine),
    pattern: typeof rawMeta?.pattern === 'string' ? rawMeta.pattern : options.pattern,
    include: typeof rawMeta?.include === 'string' ? rawMeta.include : options.include,
    exclude: typeof rawMeta?.exclude === 'string' ? rawMeta.exclude : options.exclude,
    outputMode: normalizeGrepOutputMode(rawMeta?.outputMode),
    searchRoot: typeof rawMeta?.searchRoot === 'string' ? rawMeta.searchRoot : options.searchRoot,
    pathStyle:
      rawMeta?.pathStyle === 'absolute' ? 'absolute' : 'relative_to_search_root',
    truncated: rawMeta?.truncated === true,
    timedOut: rawMeta?.timedOut === true,
    limitReason: normalizeLimitReason(rawMeta?.limitReason),
    searchTime: typeof rawMeta?.searchTime === 'number' ? rawMeta.searchTime : undefined,
    warnings: normalizeWarnings(rawMeta?.warnings),
    maxResults: normalizeOptionalNumber(rawMeta?.maxResults),
    maxOutputBytes: normalizeOptionalNumber(rawMeta?.maxOutputBytes),
    maxLineLength: normalizeOptionalNumber(rawMeta?.maxLineLength)
  })

  const matchesSource = Array.isArray(raw.matches) ? raw.matches : []

  const matches = matchesSource
    .map((item) => normalizeGrepMatchItem(item))
    .filter((item): item is GrepToolResult['matches'][number] => !!item)

  return {
    kind: 'grep',
    matches,
    meta,
    output: typeof raw.output === 'string' ? raw.output : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined
  }
}

// Prompt formatting

function estimatePromptBytes(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length
}

function normalizePromptGrepText(text: string): string {
  const normalized = text.trim()
  if (normalized.length <= PROMPT_GREP_MAX_LINE_LENGTH) return normalized
  return `${normalized.slice(0, Math.max(0, PROMPT_GREP_MAX_LINE_LENGTH - 3))}...`
}

function limitGlobResultForPrompt(result: GlobToolResult): GlobToolResult {
  const matches: Array<{ path: string; type?: 'file' | 'directory' }> = []
  let totalBytes = 2
  let limitReason: SearchLimitReason = null

  for (const item of result.matches) {
    if (matches.length >= PROMPT_SEARCH_MAX_MATCHES) {
      limitReason = 'max_results'
      break
    }

    const candidateBytes = estimatePromptBytes(item.path) + 1
    if (totalBytes + candidateBytes > PROMPT_SEARCH_MAX_OUTPUT_BYTES) {
      limitReason = 'max_output_bytes'
      break
    }

    matches.push(item)
    totalBytes += candidateBytes
  }

  if (!limitReason) return result
  return {
    ...result,
    matches,
    meta: {
      ...result.meta,
      truncated: true,
      limitReason: result.meta.limitReason ?? limitReason
    }
  }
}

function limitGrepResultForPrompt(result: GrepToolResult): GrepToolResult {
  const matches: GrepToolResult['matches'] = []
  let totalBytes = 2
  let limitReason: SearchLimitReason = null
  const maxMatches = Math.min(
    result.meta.maxResults ?? PROMPT_SEARCH_MAX_MATCHES,
    PROMPT_GREP_MAX_MATCHES
  )
  const maxOutputBytes = Math.min(
    result.meta.maxOutputBytes ?? PROMPT_SEARCH_MAX_OUTPUT_BYTES,
    PROMPT_GREP_MAX_OUTPUT_BYTES
  )

  for (const item of result.matches) {
    if (matches.length >= maxMatches) {
      limitReason = 'max_results'
      break
    }

    const normalizedItem = {
      ...item,
      text: typeof item.text === 'string' ? normalizePromptGrepText(item.text) : item.text
    }
    const candidateBytes =
      estimatePromptBytes({
        file: normalizedItem.path,
        line: normalizedItem.line,
        column: normalizedItem.column,
        text: normalizedItem.text,
        kind: normalizedItem.kind,
        count: normalizedItem.count
      }) + 1
    if (totalBytes + candidateBytes > maxOutputBytes) {
      limitReason = 'max_output_bytes'
      break
    }

    matches.push(normalizedItem)
    totalBytes += candidateBytes
  }

  if (!limitReason && matches.length === result.matches.length) {
    return { ...result, matches }
  }

  return {
    ...result,
    matches,
    meta: {
      ...result.meta,
      truncated: result.meta.truncated || limitReason !== null,
      limitReason: result.meta.limitReason ?? limitReason
    }
  }
}

function shouldUseCompactSearchPayload(meta: SearchMeta, error?: string): boolean {
  return (
    !error &&
    !meta.engine &&
    !meta.truncated &&
    !meta.timedOut &&
    (meta.warnings?.length ?? 0) === 0
  )
}

function formatGlobResultForPrompt(result: GlobToolResult): Record<string, unknown> | unknown[] {
  const limitedResult = limitGlobResultForPrompt(result)

  if (shouldUseCompactSearchPayload(limitedResult.meta, limitedResult.error)) {
    return limitedResult.matches.map((item) => item.path)
  }

  return {
    matches: limitedResult.matches.map((item) => item.path),
    truncated: limitedResult.meta.truncated,
    timedOut: limitedResult.meta.timedOut,
    limitReason: limitedResult.meta.limitReason,
    engine: limitedResult.meta.engine,
    warnings: limitedResult.meta.warnings,
    error: limitedResult.error
  }
}

function formatGrepLine(
  item: GrepToolResult['matches'][number],
  outputMode: GrepOutputMode
): string {
  if (outputMode === 'files_with_matches') {
    return item.path
  }
  if (outputMode === 'count') return `${item.path}:${item.count ?? 0}`
  if (typeof item.line !== 'number') return item.path
  const separator = item.kind === 'context' ? '-' : ':'
  if (typeof item.column === 'number' && item.kind !== 'context') {
    return `${item.path}${separator}${item.line}${separator}${item.column}${separator}${
      item.text ?? ''
    }`
  }
  return `${item.path}${separator}${item.line}${separator}${item.text ?? ''}`
}

function formatGrepOutput(result: GrepToolResult): string {
  const outputMode = result.meta.outputMode ?? 'matches'
  return result.matches.map((item) => formatGrepLine(item, outputMode)).join('\n')
}

function formatGrepResultForPrompt(result: GrepToolResult): string | Record<string, unknown> {
  const limitedResult = limitGrepResultForPrompt(result)
  const output = limitedResult.output ?? formatGrepOutput(limitedResult)

  if (output && shouldUseCompactSearchPayload(limitedResult.meta, limitedResult.error)) {
    return output
  }

  return {
    output,
    matches: limitedResult.matches.map((item) => ({
      file: item.path,
      line: item.line,
      column: item.column,
      text: item.text,
      kind: item.kind,
      count: item.count
    })),
    truncated: limitedResult.meta.truncated,
    timedOut: limitedResult.meta.timedOut,
    limitReason: limitedResult.meta.limitReason,
    engine: limitedResult.meta.engine,
    warnings: limitedResult.meta.warnings,
    error: limitedResult.error
  }
}

// Render helpers

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
  const fileCount = parsed ? new Set(parsed.matches.map((m: any) => m.file)).size : null

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

// Tool handlers

const globHandler: ToolHandler = {
  definition: {
    name: 'Glob',
    description:
      'Find files by glob pattern. Returns up to 100 paths sorted by modification time. Does not respect .gitignore unless respectGitignore=true.',
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
      // Backend GlobArgs reads `cwd`, not `path` — join the search root into cwd.
      ...(resolvedPath ? { cwd: resolvedPath } : {}),
      pattern: input.pattern,
      limit: PROMPT_SEARCH_FETCH_LIMIT
    })
    return encodeStructuredToolResult(
      formatGlobResultForPrompt(
        normalizeGlobResult(result, {
          backend: 'local',
          pattern: String(input.pattern ?? ''),
          searchRoot: resolvedPath
        })
      )
    )
  },
  render: { kind: 'native-panel', renderHeader: globHeader, renderBadges: globBadges, renderBody: globBody },
}

const grepHandler: ToolHandler = {
  definition: {
    name: 'Grep',
    description:
      'Search file contents using regex (or literal strings). Defaults to files_with_matches. Use output_mode="content" for file:line:text output.',
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
        output_mode: {
          type: 'string',
          enum: ['files_with_matches', 'content', 'count'],
          description: 'Output mode. Default files_with_matches.'
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
      output_mode: input.output_mode,
      maxResults: input.maxResults,
      maxLineLength: input.maxLineLength
    })
    const formatted = formatGrepResultForPrompt(
      normalizeGrepResult(result, {
        backend: 'local',
        pattern: String(input.pattern ?? ''),
        searchRoot: resolvedPath,
        include: typeof input.include === 'string' ? input.include : null,
        exclude: typeof input.exclude === 'string' ? input.exclude : null
      })
    )
    return typeof formatted === 'string' ? formatted : encodeStructuredToolResult(formatted)
  },
  render: { kind: 'native-panel', renderHeader: grepHeader, renderBadges: grepBadges, renderBody: grepBody },
}

export function registerSearchTools(): void {
  toolRegistry.add(globHandler)
  toolRegistry.add(grepHandler)
}

export const searchToolModule: import('./tool-module').ToolModule = { register: registerSearchTools }
