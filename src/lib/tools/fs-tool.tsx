import * as React from 'react'
import { toolRegistry } from '../agent/tool-registry'
import { joinFsPath } from '../agent/project-memory'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import type { FileReadSnapshot, ToolHandler, ToolContext } from './tool-types'
import type { ToolPanelContext } from './tool-render-types'
import { ToolPanelLead, ToolIcon, Badge, ImageOutputBlock, ErrorBlock, EmptyHint, isToolLive } from '@/components/chat/tool-panel/parts'
import {
  getStringInput,
  pathFileName,
  pathParent,
  compactPath,
  lineRangeBadge,
  getReadOutputLineCount,
  hasImageBlocks,
  fileToolPath,
  compactToolPathSummary,
  deriveOutputError
} from '@/components/chat/tool-panel/utils'
import { ReadOutputBlock } from '@/components/chat/tool-panel/ReadOutputBlock'
import { LazySyntaxHighlighter } from '@/components/chat/LazySyntaxHighlighter'
import { LSOutputBlock, parseLsEntries } from '@/components/chat/tool-panel/LsOutputBlock'
import { detectLang } from '@/lib/utils/detect-lang'
import { truncateContent } from '@/lib/utils/truncation'
import { DiffFallback } from '@/components/ui/lazy-fallback'

const CodeDiffViewer = React.lazy(() =>
  import('@/components/chat/CodeDiffViewer').then(m => ({ default: m.CodeDiffViewer }))
)
import { MONO_FONT } from '@/lib/utils/fonts'

type EolStyle = '\n' | '\r\n' | null
type TextWriteToolName = 'Write' | 'Edit'

type LsEntry = { name: string; type: string; path: string }
type LsLimitReason = 'max_results' | 'max_output_bytes' | null

const LS_PROMPT_MAX_ITEMS = 100
const LS_BACKEND_FETCH_LIMIT = LS_PROMPT_MAX_ITEMS + 1
const LS_PROMPT_MAX_OUTPUT_BYTES = 8 * 1024
const textEncoder = new TextEncoder()

function countOccurrences(content: string, value: string): number {
  if (!value) return 0
  return content.split(value).length - 1
}

function detectEolStyle(value: string): EolStyle {
  if (value.includes('\r\n')) return '\r\n'
  if (value.includes('\n')) return '\n'
  return null
}

function detectDominantEolStyle(value: string): EolStyle {
  let crlf = 0
  let lf = 0

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\r' && value[index + 1] === '\n') {
      crlf += 1
      index += 1
    } else if (value[index] === '\n') {
      lf += 1
    }
  }

  if (crlf === 0 && lf === 0) return null
  return crlf >= lf ? '\r\n' : '\n'
}

function normalizeToLf(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function applyEolStyle(value: string, style: EolStyle): string {
  if (!style) return value
  const normalized = normalizeToLf(value)
  return style === '\n' ? normalized : normalized.replace(/\n/g, '\r\n')
}

function buildOldStringVariants(
  oldStr: string,
  fileContent: string
): Array<{ text: string; eol: EolStyle }> {
  const variants: Array<{ text: string; eol: EolStyle }> = []
  const seen = new Set<string>()
  const addVariant = (text: string, eol: EolStyle): void => {
    if (seen.has(text)) return
    seen.add(text)
    variants.push({ text, eol })
  }

  addVariant(oldStr, detectEolStyle(oldStr))

  if (oldStr.includes('\n')) {
    const lfText = normalizeToLf(oldStr)
    addVariant(lfText, '\n')
    if (fileContent.includes('\r\n')) {
      addVariant(lfText.replace(/\n/g, '\r\n'), '\r\n')
    }
  }

  return variants
}

function getReplacementEolStyle(
  matchedOldString: { eol: EolStyle },
  fileContent: string
): EolStyle {
  return matchedOldString.eol ?? detectDominantEolStyle(fileContent)
}

function normalizeReadHistoryPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function isFileReadSnapshot(value: unknown): value is FileReadSnapshot {
  return !!value && typeof value === 'object' && 'exists' in value
}

function isSameReadSnapshot(left: FileReadSnapshot, right: FileReadSnapshot): boolean {
  if (left.exists !== right.exists) return false
  if (!left.exists && !right.exists) return true
  return (
    (left.type ?? null) === (right.type ?? null) &&
    (left.size ?? null) === (right.size ?? null) &&
    (left.mtimeMs ?? null) === (right.mtimeMs ?? null)
  )
}

async function captureReadSnapshot(
  ctx: ToolContext,
  filePath: string
): Promise<FileReadSnapshot | { error: string }> {
  const channel = TAURI_COMMANDS.FS_STAT_PATH
  const args = { path: filePath }
  const result = await ctx.commands.invoke(channel, args)
  if (isErrorResult(result)) return { error: result.error }
  const stat = (result as Record<string, unknown>)?.stat ?? result
  if (!isFileReadSnapshot(stat)) return { error: 'stat did not return a file snapshot' }
  return stat
}

async function recordRead(ctx: ToolContext, filePath: string): Promise<void> {
  const snapshot = await captureReadSnapshot(ctx, filePath)
  if ('error' in snapshot) return
  if (!ctx.readFileHistory) ctx.readFileHistory = new Map<string, FileReadSnapshot>()
  ctx.readFileHistory.set(normalizeReadHistoryPath(filePath), snapshot)
}

async function assertCurrentFileMatchesLastRead(args: {
  ctx: ToolContext
  filePath: string
  toolName: TextWriteToolName
  allowMissingFile: boolean
}): Promise<string | null> {
  const current = await captureReadSnapshot(args.ctx, args.filePath)
  if ('error' in current) return `Could not stat file before ${args.toolName}: ${current.error}`
  if (!current.exists && args.allowMissingFile) return null

  const previous = args.ctx.readFileHistory?.get(normalizeReadHistoryPath(args.filePath))
  if (!previous) {
    return `${args.toolName} requires the file to be read in this agent turn first. Call Read on ${args.filePath} and retry.`
  }

  if (!isSameReadSnapshot(previous, current)) {
    return `${args.toolName} refused to edit because the file changed since it was last read in this turn. Call Read on ${args.filePath} again and retry.`
  }

  return null
}

type ReadFileTextResult =
  | { content: string; truncated?: boolean; totalLines?: number }
  | { error: string }

// Record type for the raw Rust response which may carry truncation metadata.
interface ReadFileRawResponse {
  content: string
  path?: string
  truncated?: boolean
  totalLines?: number
  notFound?: boolean
  format?: string
  totalPages?: number
}

// Single source of truth for parsing an fs:read-file response.
// Returns the file text or a fail-fast error — never coerces the raw
// response object to a string (which would yield "[object Object]").
async function readFileText(
  ctx: ToolContext,
  resolvedPath: string,
  options?: { offset?: unknown; limit?: unknown; pages?: unknown }
): Promise<ReadFileTextResult> {
  const result = await ctx.commands.invoke(TAURI_COMMANDS.FS_READ_FILE, {
    path: resolvedPath,
    offset: options?.offset,
    limit: options?.limit,
    pages: options?.pages
  })
  if (isErrorResult(result)) return { error: `Read failed: ${result.error}` }

  const obj = result as ReadFileRawResponse | undefined
  if (obj && obj.notFound === true) {
    return { error: `Read failed: file not found: ${resolvedPath}` }
  }
  if (!obj || typeof obj.content !== 'string') {
    return { error: 'Read failed: unexpected fs:read-file response' }
  }
  return {
    content: obj.content,
    truncated: obj.truncated,
    totalLines: obj.totalLines,
  }
}

function applyExactReplacement(args: {
  content: string
  oldStr: string
  newStr: string
  replaceAll: boolean
}): { updated: string; occurrences: number } | { error: string } {
  if (!args.oldStr) {
    return { error: 'old_string must be non-empty' }
  }

  if (args.oldStr === args.newStr) {
    return { error: 'new_string must be different from old_string' }
  }

  const oldStringVariants = buildOldStringVariants(args.oldStr, args.content)
  const matchedVariant = oldStringVariants.find(
    (variant) => variant.text.length > 0 && args.content.includes(variant.text)
  )

  if (!matchedVariant) {
    return { error: `String to replace not found in file.\nString: ${args.oldStr}` }
  }

  const occurrences = countOccurrences(args.content, matchedVariant.text)
  if (!args.replaceAll && occurrences > 1) {
    return {
      error: `Found ${occurrences} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more surrounding context.\nString: ${args.oldStr}`
    }
  }

  const replacementText = applyEolStyle(
    args.newStr,
    getReplacementEolStyle(matchedVariant, args.content)
  )
  const updated = args.replaceAll
    ? args.content.split(matchedVariant.text).join(replacementText)
    : args.content.replace(matchedVariant.text, replacementText)

  return { updated, occurrences }
}

// ── Path helpers ──

export function isAbsolutePath(p: string): boolean {
  if (!p) return false
  if (p.startsWith('/') || p.startsWith('\\')) return true
  return /^[a-zA-Z]:[\\/]/.test(p)
}

export function resolveToolPath(inputPath: unknown, workingFolder?: string): string {
  const raw = typeof inputPath === 'string' ? inputPath.trim() : ''
  const base = workingFolder?.trim()
  if (!raw || raw === '.') {
    return base && base.length > 0 ? base : '.'
  }
  if (isAbsolutePath(raw)) return raw
  if (base && base.length > 0) return joinFsPath(base, raw)
  return raw
}

function getFileToolInputPath(input: Record<string, unknown>): string {
  const filePath = typeof input.file_path === 'string' ? input.file_path.trim() : ''
  if (filePath) return filePath
  const path = typeof input.path === 'string' ? input.path.trim() : ''
  return path
}

function estimatePromptBytes(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length
}

function normalizeLsEntries(raw: unknown): { items: LsEntry[]; hasMore: boolean } {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown[] }).entries)
      ? (raw as { entries: unknown[] }).entries
      : []
  const hasMore = !!(
    raw &&
    typeof raw === 'object' &&
    (raw as { hasMore?: unknown }).hasMore === true
  )

  return {
    items: source
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const record = item as { name?: unknown; type?: unknown; path?: unknown; is_dir?: unknown; is_file?: unknown }
        const name = record.name
        const path = record.path
        if (typeof name !== 'string' || typeof path !== 'string') return null
        const type =
          typeof record.type === 'string'
            ? record.type
            : record.is_dir
              ? 'directory'
              : record.is_file
                ? 'file'
                : 'other'
        return { name, type, path }
      })
      .filter((item): item is LsEntry => !!item),
    hasMore
  }
}

function formatLsResultForPrompt(raw: unknown): LsEntry[] | Record<string, unknown> {
  if (isErrorResult(raw)) return raw

  const { items, hasMore } = normalizeLsEntries(raw)
  const limitedItems: LsEntry[] = []
  let totalBytes = 2
  let limitReason: LsLimitReason = hasMore ? 'max_results' : null

  for (const item of items) {
    if (limitedItems.length >= LS_PROMPT_MAX_ITEMS) {
      limitReason = 'max_results'
      break
    }

    const candidateBytes = estimatePromptBytes(item) + 1
    if (totalBytes + candidateBytes > LS_PROMPT_MAX_OUTPUT_BYTES) {
      limitReason = 'max_output_bytes'
      break
    }

    limitedItems.push(item)
    totalBytes += candidateBytes
  }

  if (!limitReason) return limitedItems
  return {
    items: limitedItems,
    truncated: true,
    limitReason
  }
}


// ── Render helpers ──

function readStringField(input: Record<string, unknown>, key: string, previewKey: string): string {
  if (typeof input[key] === 'string') return input[key] as string
  if (typeof input[previewKey] === 'string') return input[previewKey] as string
  return ''
}

function readHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, output, displayName, t } = ctx
  const filePath = getStringInput(input, ['file_path', 'path'])
  const fileName = pathFileName(filePath)

  return (
    <ToolPanelLead
      icon={<ToolIcon name="Read" />}
      title={filePath ? t('toolPanel.title.Read', { file: fileName }) : displayName}
      subtitle={filePath ? pathParent(filePath) || compactPath(filePath, 2) : undefined}
      titleAttr={filePath || displayName}
    />
  )
}

function readBadges(ctx: ToolPanelContext): React.ReactNode {
  const { input, outputText, output, t } = ctx
  const filePath = getStringInput(input, ['file_path', 'path'])
  const lines = getReadOutputLineCount(outputText)
  const range = lineRangeBadge(input, t)

  const badges: React.ReactNode[] = []
  if (lines !== null) badges.push(<Badge key="lines" tone="blue">{t('toolCall.lineCount', { count: lines })}</Badge>)
  if (range) badges.push(<Badge key="range">{range}</Badge>)
  if (output && hasImageBlocks(output)) badges.push(<Badge key="img" tone="blue">{t('toolCall.imageFile')}</Badge>)
  return badges.length ? <>{badges}</> : null
}

function readBody(ctx: ToolPanelContext): React.ReactNode {
  const filePath = getStringInput(ctx.input, ['file_path', 'path'])
  if (ctx.output && hasImageBlocks(ctx.output)) return <ImageOutputBlock output={ctx.output} />
  if (ctx.output && ctx.outputText) return <ReadOutputBlock output={ctx.outputText} filePath={filePath} />
  return null
}

function fileHeader(ctx: ToolPanelContext): React.ReactNode {
  const targetPath = fileToolPath(ctx.input)
  const summary = compactToolPathSummary(targetPath)
  const fileName = summary.primary || '…'

  const title = ctx.t(`toolPanel.title.${ctx.name}`, { file: fileName })

  return (
    <ToolPanelLead
      icon={<ToolIcon name={ctx.name} />}
      title={title}
      subtitle={summary.secondary}
      titleAttr={targetPath || ctx.displayName}
    />
  )
}

function writeBody(ctx: ToolPanelContext): React.ReactNode {
  const live = isToolLive(ctx.status)
  const content = readStringField(ctx.input, 'content', 'content_preview')
  const targetPath = fileToolPath(ctx.input)
  const lang = detectLang(targetPath)
  const displayError = ctx.error || (ctx.status === 'error' ? deriveOutputError(ctx.outputText) : null)

  if (!content && live) return <EmptyHint ctx={ctx} pulse />

  return (
    <div className="space-y-2.5">
      {content ? (
        <LazySyntaxHighlighter
          language={lang}
          showLineNumbers
          customStyle={{ margin: 0, padding: '0.5rem', fontSize: '11px', maxHeight: '320px', overflow: 'auto', fontFamily: MONO_FONT }}
          codeTagProps={{ style: { fontFamily: 'inherit' } }}
        >
          {content}
        </LazySyntaxHighlighter>
      ) : null}
      {displayError ? <ErrorBlock text={displayError} /> : null}
    </div>
  )
}

function editBody(ctx: ToolPanelContext): React.ReactNode {
  const live = isToolLive(ctx.status)
  const oldStr = readStringField(ctx.input, 'old_string', 'old_string_preview')
  const newStr = readStringField(ctx.input, 'new_string', 'new_string_preview')
  const hasContent = oldStr.length > 0 || newStr.length > 0
  const displayError = ctx.error || (ctx.status === 'error' ? deriveOutputError(ctx.outputText) : null)

  if (!hasContent && live) return <EmptyHint ctx={ctx} pulse />

  return (
    <div className="space-y-2.5">
      {hasContent ? (
        <React.Suspense fallback={<DiffFallback />}>
          <CodeDiffViewer beforeText={oldStr} afterText={newStr} />
        </React.Suspense>
      ) : null}
      {displayError ? <ErrorBlock text={displayError} /> : null}
    </div>
  )
}

function deleteBody(ctx: ToolPanelContext): React.ReactNode {
  const live = isToolLive(ctx.status)
  const displayError = ctx.error || (ctx.status === 'error' ? deriveOutputError(ctx.outputText) : null)

  return (
    <div className="space-y-2.5">
      {live ? (
        <div className="flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
          <span className="size-1.5 rounded-full bg-destructive animate-pulse" />
          <span className="text-[11px] text-destructive/80">{ctx.t('fileChange.fileWillBeDeleted')}</span>
        </div>
      ) : null}
      {displayError ? <ErrorBlock text={displayError} /> : null}
    </div>
  )
}

function lsHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, displayName, t } = ctx
  const path = getStringInput(input, ['path'])
  const compact = compactPath(path, 3)

  return (
    <ToolPanelLead
      icon={<ToolIcon name="LS" />}
      title={path ? t('toolPanel.title.LS', { path: compact }) : displayName}
      subtitle={path && compact !== path ? path : undefined}
      titleAttr={path || displayName}
    />
  )
}

function lsBadges(ctx: ToolPanelContext): React.ReactNode {
  const { outputText, t } = ctx
  const parsed = parseLsEntries(outputText)
  const dirs = parsed?.filter((e: any) => e.type === 'directory').length ?? null
  const files = parsed?.filter((e: any) => e.type === 'file').length ?? null

  if (dirs === null || files === null) return null
  return (
    <Badge key="count">{t('toolCall.foldersAndFiles', { folders: dirs, files })}</Badge>
  )
}

function lsBody(ctx: ToolPanelContext): React.ReactNode {
  if (!ctx.output || !ctx.outputText) return null
  return <LSOutputBlock output={ctx.outputText} />
}


const readHandler: ToolHandler = {
  definition: {
    name: 'Read',
    description:
      'Reads a file from the filesystem.\n\n' +
      '- Text files (code, config, markdown, etc.): supports offset/limit for line ranges.\n' +
      '- Documents (PDF, DOCX, XLSX, PPTX): extracts text content. Use `pages` for PDF page ranges (e.g. "1-5", "1,3,7").\n' +
      '- Images (PNG, JPEG, GIF, WEBP): returned as visual attachments.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        offset: { type: 'number', description: 'Start line (1-indexed, text files only)' },
        limit: { type: 'number', description: 'Number of lines to read (text files only)' },
        pages: { type: 'string', description: 'Page range for PDF (e.g. "1-5", "1,3,7"). Ignored for other formats.' }
      },
      required: ['file_path']
    }
  },
  execute: async (input, ctx) => {
    const inputPath = getFileToolInputPath(input)
    if (!inputPath) {
      throw new Error('Read requires a non-empty "file_path" string')
    }
    const resolvedPath = resolveToolPath(inputPath, ctx.workingFolder)
    const result = await readFileText(ctx, resolvedPath, {
      offset: input.offset,
      limit: input.limit,
      pages: input.pages
    })
    if ('error' in result) throw new Error(result.error)
    await recordRead(ctx, resolvedPath)

    // Apply unified byte-level truncation with friendly notice.
    // Even with offset/limit, the Rust side may truncate at MAX_OUTPUT_BYTES;
    // this ensures the AI never receives more than MAX_CONTENT_BYTES.
    const truncated = truncateContent(result.content)
    return truncated.content
  },
  render: { kind: 'native-panel', renderHeader: readHeader, renderBadges: readBadges, renderBody: readBody, expandForImages: true },
}

const writeHandler: ToolHandler = {
  definition: {
    name: 'Write',
    description:
      "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.",
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        content: { type: 'string', description: 'The content to write to the file' }
      },
      required: ['file_path', 'content']
    }
  },
  execute: async (input, ctx) => {
    const inputPath = getFileToolInputPath(input)
    if (!inputPath) {
      throw new Error('Write requires a non-empty "file_path" string')
    }
    if (typeof input.content !== 'string') {
      throw new Error('Write requires a "content" string')
    }

    const resolvedPath = resolveToolPath(inputPath, ctx.workingFolder)
    const guardError = await assertCurrentFileMatchesLastRead({
      ctx,
      filePath: resolvedPath,
      toolName: 'Write',
      allowMissingFile: true
    })
    if (guardError) throw new Error(guardError)

    const result = await ctx.commands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, {
      path: resolvedPath,
      content: input.content
    })
    if (isErrorResult(result)) {
      throw new Error(`Write failed: ${result.error}`)
    }
    await recordRead(ctx, resolvedPath)

    return encodeStructuredToolResult({ success: true, path: resolvedPath })
  },
  render: { kind: 'native-panel', renderHeader: fileHeader, renderBody: writeBody },
}

const editHandler: ToolHandler = {
  definition: {
    name: 'Edit',
    description:
      'Performs exact string replacements in files. \n\nUsage:\n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`. \n- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        old_string: {
          type: 'string',
          description: 'The text to replace'
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with (must be different from old_string)'
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurences of old_string (default false)'
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  execute: async (input, ctx) => {
    const inputPath = getFileToolInputPath(input)
    if (!inputPath) {
      return encodeToolError('Edit requires a non-empty "file_path" string')
    }
    const resolvedPath = resolveToolPath(inputPath, ctx.workingFolder)
    const oldStr = String(input.old_string ?? '')
    const newStr = String(input.new_string ?? '')
    const replaceAll = Boolean(input.replace_all)

    if (!oldStr) {
      return encodeToolError('old_string must be non-empty')
    }

    if (oldStr === newStr) {
      return encodeToolError('new_string must be different from old_string')
    }

    const guardError = await assertCurrentFileMatchesLastRead({
      ctx,
      filePath: resolvedPath,
      toolName: 'Edit',
      allowMissingFile: false
    })
    if (guardError) return encodeToolError(guardError)

    const readResult = await readFileText(ctx, resolvedPath)
    if ('error' in readResult) return encodeToolError(readResult.error)

    const content = readResult.content
    const editResult = applyExactReplacement({ content, oldStr, newStr, replaceAll })
    if ('error' in editResult) return encodeToolError(editResult.error)
    const updated = editResult.updated

    const writeCh = TAURI_COMMANDS.FS_WRITE_FILE
    const writeResult = await ctx.commands.invoke(writeCh, {
      path: resolvedPath,
      content: updated
    })
    if (isErrorResult(writeResult)) {
      return encodeToolError(`Write failed: ${writeResult.error}`)
    }

    await recordRead(ctx, resolvedPath)
    return encodeStructuredToolResult({
      success: true,
      path: resolvedPath,
      replaceAll
    })
  },
  render: { kind: 'native-panel', renderHeader: fileHeader, renderBody: editBody },
}

const lsHandler: ToolHandler = {
  definition: {
    name: 'LS',
    description: 'List files and directories in a given path',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or relative to the working folder' },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to ignore'
        }
      },
      required: []
    }
  },
  execute: async (input, ctx) => {
    const rawPath = typeof input.path === 'string' ? input.path.trim() : ''
    if ((!rawPath || rawPath === '.') && !ctx.workingFolder?.trim()) {
      return encodeToolError(
        'LS requires an active working folder when path is omitted or set to `.`'
      )
    }

    const resolvedPath = resolveToolPath(input.path, ctx.workingFolder)
    const result = await ctx.commands.invoke(TAURI_COMMANDS.FS_LIST_DIR, {
      path: resolvedPath,
      ignore: input.ignore,
      limit: LS_BACKEND_FETCH_LIMIT
    })
    return encodeStructuredToolResult(formatLsResultForPrompt(result))
  },
  render: { kind: 'native-panel', renderHeader: lsHeader, renderBadges: lsBadges, renderBody: lsBody },
}

const deleteHandler: ToolHandler = {
  definition: {
    name: 'Delete',
    description:
      'Deletes a file or directory from the local filesystem. Directories are removed recursively. Prefer editing over deleting; only delete when the file is genuinely obsolete.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        }
      },
      required: ['file_path']
    }
  },
  execute: async (input, ctx) => {
    const inputPath = getFileToolInputPath(input)
    if (!inputPath) {
      throw new Error('Delete requires a non-empty "file_path" string')
    }
    const resolvedPath = resolveToolPath(inputPath, ctx.workingFolder)
    const result = await ctx.commands.invoke(TAURI_COMMANDS.FS_DELETE, {
      path: resolvedPath
    })
    if (isErrorResult(result)) {
      throw new Error(`Delete failed: ${result.error}`)
    }
    return encodeStructuredToolResult({ success: true, path: resolvedPath })
  },
  render: { kind: 'native-panel', renderHeader: fileHeader, renderBody: deleteBody },
}

export function registerFsTools(): void {
  toolRegistry.add(readHandler)
  toolRegistry.add(writeHandler)
  toolRegistry.add(editHandler)
  toolRegistry.add(deleteHandler)
  toolRegistry.add(lsHandler)
}

function isErrorResult(value: unknown): value is { error: string } {
  if (!value || typeof value !== 'object') return false
  const error = (value as { error?: unknown }).error
  return typeof error === 'string' && error.length > 0
}

export const fsToolModule: import('./tool-module').ToolModule = { register: registerFsTools }
