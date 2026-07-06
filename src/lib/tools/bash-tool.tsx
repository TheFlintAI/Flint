import { toolRegistry } from '../agent/tool-registry'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { encodeBashToolResult } from './bash-output'
import type { ToolContext, ToolHandler, ToolPermission } from './tool-types'
import { useAgentStore } from '@/stores/agent-store'
import { resolveShellExecutable, useSettingsStore } from '@/stores/settings-store'
import { getHostPlatform } from '@/services/tauri-api/runtime'
import type { ToolPanelContext } from './tool-render-types'
import { ToolPanelLead, ToolIcon, Badge } from '@/components/chat/tool-panel/parts'
import { compactWhitespace, getStringInput } from '@/components/chat/tool-panel/utils'
import { BashOutputBlock, bashOutputStats } from '@/components/chat/tool-panel/BashOutputBlock'

const DEFAULT_COMMAND_TIMEOUT_MS = 600_000

let execCounter = 0
const LONG_RUNNING_COMMAND_PATTERNS: RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b/i,
  /\b(next|vite|nuxt|astro)\s+dev\b/i,
  /\b(webpack-dev-server|webpack)\b.*\b(--watch|serve)\b/i,
  /\b(docker\s+compose|docker-compose)\s+up\b/i,
  /\b(kubectl\s+logs)\b.*\s-f\b/i,
  /\b(tail|less)\s+-f\b/i,
  /\b(nodemon|ts-node-dev)\b/i,
  /\b(uvicorn|gunicorn)\b.*\b(--reload|--workers|--bind|--host)\b/i,
  /\bpython\b.*\b-m\s+http\.server\b/i
]
const LIVE_PREVIEW_MAX_LINES = 80
const LIVE_PREVIEW_MAX_CHARS = 4000
const LIVE_ERROR_PREVIEW_MAX_LINES = 24
const ERROR_LIKE_RE =
  /\b(error|failed|exception|traceback|fatal|panic|cannot|unable|undefined reference|syntax error|test(?:s)? failed?)\b/i

// Permission classifier

const ALLOW_PATTERNS: RegExp[] = [
  // File listing / reading
  /\b(ls|dir)(?:\s|$)/,
  /\b(cat|head|tail|less|more|zcat|bzcat)(?:\s|$)/,
  // Path / navigation
  /\b(pwd|which|where|whereis|type|realpath|readlink)(?:\s|$)/,
  // Search / filter / count
  /\b(find|grep|rg|ag|ack|wc|sort|uniq|cut|tr|awk|sed)(?:\s|$)/,
  // System info / diagnostics
  /\b(echo|printenv|env|date|whoami|id|uname|hostname|uptime|df|du|free)(?:\s|$)/,
  // Safe git (read-only operations)
  /\bgit\s+(status|log|diff|branch|show|stash\s+list|remote\s+-v|tag|rev-parse|config|ls-files|blame|shortlog|describe|reflog|worktree\s+list)(?:\s|$)/,
  // Version checks
  /\b(git|node|npm|pnpm|yarn|rustc|cargo|go|python|pip|docker|kubectl|helm|terraform|java|javac|gcc|g\+\+|clang|make|cmake)(?:\s+.*)?\s+(--version|-v|-V|version)(?:\s|$)/,
  // Package listing (read-only)
  /\b(npm|pnpm|yarn)\s+(list|outdated|why|info|view)(?:\s|$)/,
  /\b(pip|pip3)\s+(list|freeze|show|search)(?:\s|$)/,
  /\bcargo\s+(tree|metadata|read-manifest)(?:\s|$)/,
  // Docker read-only
  /\bdocker\s+(ps|images|inspect|stats|info|version|compose\s+ps|compose\s+config|compose\s+logs(?!\s+-f)|system\s+info|system\s+df)(?:\s|$)/,
  // Kubernetes read-only
  /\bkubectl\s+(get|describe|top|explain|api-resources|api-versions|cluster-info|config\s+view|auth\s+can-i|rollout\s+status|rollout\s+history)(?:\s|$)/,
  // Cargo check (read-only compile check)
  /\bcargo\s+check\b/,
  /\btsc\s+.*--noEmit\b/,
]

const DENY_PATTERNS: RegExp[] = [
  // Recursive delete from root / home
  /\brm\s+.*-r.*\s+\/(\*|\s|$)/,
  /\brm\s+.*-r.*\s+~\/(\*|\s|$)/,
  /\brm\s+.*-rf\s+\/\*/,
  // Force push to protected branches
  /\bgit\s+push\s+.*(--force|--force-with-lease|-f).*\b(main|master)\b/,
  // Destructive git reset
  /\bgit\s+reset\s+--hard\b/,
  // Fork bomb
  /:\(\)\s*\{/,
  /\b:\(\)\s*\{\s*:\s*\|/,
  // Disk formatting / device writes
  /\bmkfs\.\w+/,
  /\b(format)\s+[a-zA-Z]:/i,
  /\bdd\s+if=.*of=\/dev\//,
  // Chmod / chown on root
  /\bchmod\s+.*777\s+\//,
  /\bchmod\s+-R\s+777\s+\//,
  /\bchown\s+-R\s+.*\s+\//,
  // Dangerous sudo operations
  /\bsudo\s+rm\s+-rf\s+\//,
  /\bsudo\s+shutdown\b/,
  /\bsudo\s+reboot\b/,
]

export function classifyBashCommand(
  input: Record<string, unknown>,
  _ctx: ToolContext
): ToolPermission {
  const command = String(input.command ?? '').trim()
  if (!command) return 'deny'

  // Check deny patterns first (highest priority)
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(command)) return 'deny'
  }

  // Check allow patterns
  for (const pattern of ALLOW_PATTERNS) {
    if (pattern.test(command)) return 'allow'
  }

  // Default: ask for user approval
  return 'ask'
}

// Shell execution

type ShellStream = 'stdout' | 'stderr'

interface ShellOutputEvent {
  execId: string
  chunk: string
  stream?: ShellStream
}

interface ShellStartedEvent {
  execId: string
  processId?: string
  terminalId?: string
}

interface LiveShellPreview {
  stdout: string
  stderr: string
  errorLines: string[]
  stdoutChars: number
  stderrChars: number
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

function isLikelyLongRunningCommand(command: string): boolean {
  const normalized = command.trim()
  if (!normalized) return false
  return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

function getConfiguredShellExecutable(): string | undefined {
  const settings = useSettingsStore.getState()
  return resolveShellExecutable({
    endpoint: settings.shellExecutionEndpoint,
    customShellExecutable: settings.customShellExecutable,
    platform: getHostPlatform()
  })
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/g, '')
  return getHostPlatform() === 'win32' ? normalized.toLowerCase() : normalized
}

function splitShellPath(value: string): { root: string; parts: string[]; separator: string } {
  const separator = value.includes('\\') ? '\\' : '/'
  const normalized = value.replace(/\\/g, '/')
  const drive = normalized.match(/^[a-zA-Z]:/)
  let root = ''
  let rest = normalized

  if (drive) {
    root = `${drive[0]}/`
    rest = normalized.slice(root.length)
  } else if (normalized.startsWith('/')) {
    root = '/'
    rest = normalized.replace(/^\/+/, '')
  }

  return {
    root,
    parts: rest.split('/').filter(Boolean),
    separator
  }
}

function formatShellPath(root: string, parts: string[], separator: string): string {
  const body = parts.join(separator)
  if (!root) return body || '.'
  const formattedRoot = root.replace(/\//g, separator)
  return body ? `${formattedRoot}${body}` : formattedRoot
}

function resolveShellPath(basePath: string, targetPath: string): string {
  const trimmedTarget = targetPath.trim()
  const absolute =
    /^[a-zA-Z]:[\\/]/.test(trimmedTarget) ||
    trimmedTarget.startsWith('/') ||
    trimmedTarget.startsWith('\\')
  const seed = absolute ? trimmedTarget : `${basePath.replace(/[\\/]+$/, '')}/${trimmedTarget}`
  const parsed = splitShellPath(seed)
  const parts: string[] = []

  for (const part of parsed.parts) {
    if (part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return formatShellPath(parsed.root, parts, parsed.separator)
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const child = `${normalizeComparablePath(childPath)}/`
  const parent = `${normalizeComparablePath(parentPath)}/`
  return child === parent || child.startsWith(parent)
}

function parseStandaloneCdCommand(command: string): string | null {
  const trimmed = command.trim()
  if (!/^cd(?:\s|$)/i.test(trimmed)) return null
  if (/[;&|`\n\r]/.test(trimmed)) return null

  let target = trimmed.replace(/^cd(?:\s+|$)/i, '').trim()
  if (/^\/d\s+/i.test(target)) target = target.replace(/^\/d\s+/i, '').trim()
  if (
    (target.startsWith('"') && target.endsWith('"')) ||
    (target.startsWith("'") && target.endsWith("'"))
  ) {
    target = target.slice(1, -1)
  }
  return target || '.'
}

function getBashWorkingFolder(ctx: ToolContext): string | undefined {
  return ctx.sharedState?.bashCwd || ctx.workingFolder
}

function handlePersistentCd(command: string, ctx: ToolContext): string | null {
  const target = parseStandaloneCdCommand(command)
  if (target === null) return null

  const workspace = ctx.workingFolder?.trim()
  if (!workspace) {
    return encodeBashToolResult({
      exitCode: 1,
      stderr: 'cd requires an active working folder for persistent cwd tracking.'
    })
  }

  const current = getBashWorkingFolder(ctx) || workspace
  const resolved = target === '~' ? workspace : resolveShellPath(current, target)
  if (!isPathInside(resolved, workspace)) {
    if (!ctx.sharedState) ctx.sharedState = {}
    ctx.sharedState.bashCwd = workspace
    return encodeBashToolResult({
      exitCode: 1,
      stderr: `cd target is outside the workspace. Reset cwd to ${workspace}.`,
      cwd: workspace
    })
  }

  if (!ctx.sharedState) ctx.sharedState = {}
  ctx.sharedState.bashCwd = resolved
  return encodeBashToolResult({
    exitCode: 0,
    stdout: `cwd changed to ${resolved}`,
    cwd: resolved
  })
}

function keepLastLines(
  value: string,
  maxLines: number,
  maxChars: number
): {
  text: string
  truncated: boolean
} {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const trimmedLines = lines.length > maxLines ? lines.slice(-maxLines) : lines
  const joined = trimmedLines.join('\n')
  if (joined.length <= maxChars) {
    return {
      text: joined,
      truncated: lines.length > maxLines
    }
  }
  return {
    text: joined.slice(-maxChars),
    truncated: true
  }
}

function collectErrorLines(existing: string[], chunk: string): string[] {
  const next = [...existing]
  for (const line of chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const text = line.trim()
    if (!text || !ERROR_LIKE_RE.test(text)) continue
    if (next.includes(text)) continue
    next.push(text)
    if (next.length > LIVE_ERROR_PREVIEW_MAX_LINES) next.shift()
  }
  return next
}

function appendPreview(
  preview: LiveShellPreview,
  stream: ShellStream,
  chunk: string
): LiveShellPreview {
  const next = { ...preview }
  if (stream === 'stderr') {
    const result = keepLastLines(
      `${next.stderr}${chunk}`,
      LIVE_PREVIEW_MAX_LINES,
      LIVE_PREVIEW_MAX_CHARS
    )
    next.stderr = result.text
    next.stderrTruncated = next.stderrTruncated || result.truncated
    next.stderrChars += chunk.length
    next.errorLines = collectErrorLines(next.errorLines, chunk)
    return next
  }

  const result = keepLastLines(
    `${next.stdout}${chunk}`,
    LIVE_PREVIEW_MAX_LINES,
    LIVE_PREVIEW_MAX_CHARS
  )
  next.stdout = result.text
  next.stdoutTruncated = next.stdoutTruncated || result.truncated
  next.stdoutChars += chunk.length
  next.errorLines = collectErrorLines(next.errorLines, chunk)
  return next
}

function buildLivePreviewPayload(
  preview: LiveShellPreview,
  metadata?: { processId?: string; terminalId?: string }
): string {
  const stderr =
    preview.errorLines.length > 0
      ? `${preview.errorLines.join('\n')}${preview.stderr ? `\n\n[last stderr lines]\n${preview.stderr}` : ''}`
      : preview.stderr
  return encodeBashToolResult({
    stdout: preview.stdout,
    stderr,
    ...(metadata?.processId ? { processId: metadata.processId } : {}),
    ...(metadata?.terminalId ? { terminalId: metadata.terminalId } : {}),
    summary: {
      live: true,
      mode: 'tail',
      noisy: preview.stdoutTruncated || preview.stderrTruncated,
      totalChars: preview.stdoutChars + preview.stderrChars,
      errorLikeLines: preview.errorLines.length
    }
  })
}

// Render

function bashHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, outputText, displayName, t } = ctx
  const command = compactWhitespace(getStringInput(input, ['command', 'command_preview']))
  const description = getStringInput(input, ['description'])
  const stats = bashOutputStats(outputText)

  const badges: React.ReactNode[] = []
  if (stats.exitCode !== null) {
    badges.push(
      <Badge key="exit" tone={stats.exitCode === 0 ? 'green' : 'red'}>
        {t('toolCall.exitCode', { code: stats.exitCode })}
      </Badge>
    )
  }
  if (stats.lines !== null) {
    badges.push(<Badge key="lines" tone="blue">{t('toolCall.outputLineCount', { count: stats.lines })}</Badge>)
  }

  return (
    <ToolPanelLead
      icon={<ToolIcon name="Bash" />}
      title={command || displayName}
      subtitle={command ? description || undefined : undefined}
      badges={badges.length ? <>{badges}</> : null}
      titleAttr={command || displayName}
    />
  )
}

function bashBody(ctx: ToolPanelContext): React.ReactNode {
  return (
    <BashOutputBlock
      output={ctx.outputText ?? ''}
      input={ctx.input}
      toolUseId={ctx.toolUseId ?? ''}
      status={ctx.status}
    />
  )
}

const bashHandler: ToolHandler = {
  definition: {
    name: 'Bash',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (max 3600000, default 600000)'
        },
        run_in_background: {
          type: 'boolean',
          description:
            'Run command in background without blocking; if omitted, long-running commands are auto-detected'
        },
        force_foreground: {
          type: 'boolean',
          description:
            'Force foreground execution for long-running commands (default false; use only when necessary)'
        },
        description: { type: 'string', description: '5-10 word description of the command' }
      },
      required: ['command']
    }
  },
  execute: async (input, ctx) => {
    const command = String(input.command ?? '')
    if (!command.trim()) {
      return encodeBashToolResult({ exitCode: 1, stderr: 'Missing command' })
    }
    const cdResult = handlePersistentCd(command, ctx)
    if (cdResult !== null) return cdResult
    const cwd = getBashWorkingFolder(ctx)

    const explicitBackground =
      typeof input.run_in_background === 'boolean' ? input.run_in_background : undefined
    const isLongRunning = isLikelyLongRunningCommand(command)
    const forceForeground = Boolean(input.force_foreground)
    const autoBackground = isLongRunning && !forceForeground
    const runInBackground = forceForeground
      ? false
      : isLongRunning
        ? true
        : (explicitBackground ?? false)
    const execId = `exec-${Date.now()}-${++execCounter}`
    const toolUseId = ctx.currentToolUseId
    const shell = getConfiguredShellExecutable()

    if (runInBackground) {
      const result = (await ctx.commands.invoke(TAURI_COMMANDS.PROCESS_SPAWN, {
        command,
        cwd,
        ...(shell ? { shell } : {}),
        metadata: {
          source: 'bash-tool',
          taskId: ctx.taskId,
          toolUseId,
          description:
            typeof input.description === 'string'
              ? input.description
              : autoBackground
                ? 'Auto-detected long-running command'
                : undefined
        }
      })) as { id?: string; error?: string }

      if (!result?.id) {
        return encodeBashToolResult({
          exitCode: 1,
          stderr: result?.error ?? 'Failed to start background process'
        })
      }

      useAgentStore.getState().registerBackgroundProcess({
        id: result.id,
        command,
        cwd,
        taskId: ctx.taskId,
        toolUseId,
        source: 'bash-tool',
        description:
          typeof input.description === 'string'
            ? input.description
            : autoBackground
              ? 'Auto-detected long-running command'
              : undefined
      })

      return encodeBashToolResult({
        exitCode: 0,
        background: true,
        autoBackground,
        processId: result.id,
        command,
        taskId: ctx.taskId ?? null,
        cwd,
        stdout: autoBackground
          ? `Auto-background started for long-running command (id=${result.id}). Open Context panel to monitor, stop, or interact.`
          : `Background process started (id=${result.id}). Open Context panel to monitor, stop, or interact.`
      })
    }

    // Listen for streaming output chunks from the native backend
    let preview: LiveShellPreview = {
      stdout: '',
      stderr: '',
      errorLines: [],
      stdoutChars: 0,
      stderrChars: 0,
      stdoutTruncated: false,
      stderrTruncated: false
    }
    let outputTimer: ReturnType<typeof setTimeout> | null = null
    let lastOutputFlush = 0
    let foregroundResultMetadata: { processId?: string; terminalId?: string } | undefined
    const updateLivePreview = (): void => {
      if (!toolUseId) return
      useAgentStore.getState().updateToolCall(
        toolUseId,
        {
          output: buildLivePreviewPayload(preview, foregroundResultMetadata)
        },
        ctx.taskId
      )
    }
    const flushOutput = (): void => {
      outputTimer = null
      lastOutputFlush = Date.now()
      updateLivePreview()
    }

    const cleanupStarted = ctx.commands.on(TAURI_COMMANDS.SHELL_STARTED, (...args: unknown[]) => {
      const data = args[0] as ShellStartedEvent
      if (data.execId !== execId) return
      foregroundResultMetadata = {
        processId: data.processId ?? foregroundResultMetadata?.processId,
        terminalId: data.terminalId ?? foregroundResultMetadata?.terminalId
      }
      flushOutput()
    })

    const cleanup = ctx.commands.on('shell:output', (...args: unknown[]) => {
      const data = args[0] as ShellOutputEvent
      if (data.execId !== execId) return
      preview = appendPreview(preview, data.stream === 'stderr' ? 'stderr' : 'stdout', data.chunk)
      const now = Date.now()
      if (now - lastOutputFlush >= 60) {
        if (outputTimer) {
          clearTimeout(outputTimer)
          outputTimer = null
        }
        flushOutput()
        return
      }
      if (!outputTimer) {
        outputTimer = setTimeout(() => {
          flushOutput()
        }, 60)
      }
    })

    if (toolUseId) {
      useAgentStore.getState().registerForegroundShellExec(toolUseId, execId)
    }

    try {
      const result = (await ctx.commands.invoke(TAURI_COMMANDS.SHELL_EXEC, {
        command,
        timeout: input.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
        cwd,
        execId,
        ...(shell ? { shell } : {})
      })) as { processId?: string; terminalId?: string }
      foregroundResultMetadata = {
        processId: result.processId,
        terminalId: result.terminalId
      }
      flushOutput()
      return encodeBashToolResult(result as Record<string, unknown>)
    } finally {
      if (toolUseId) {
        useAgentStore.getState().clearForegroundShellExec(toolUseId)
      }
      if (outputTimer) {
        clearTimeout(outputTimer)
        outputTimer = null
      }
      flushOutput()
      cleanupStarted()
      cleanup()
    }
  },
  render: { kind: 'native-panel', renderHeader: bashHeader, renderBody: bashBody },
  formatApprovalSummary: (input) => String(input.command ?? ''),
}

export function registerBashTools(): void {
  toolRegistry.add(bashHandler)
}

export const bashToolModule: import('./tool-module').ToolModule = { register: registerBashTools }
