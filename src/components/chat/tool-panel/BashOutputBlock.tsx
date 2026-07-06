import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONO_FONT } from '@/lib/utils/fonts'
import { decodeStructuredToolResult } from '@/lib/tools/tool-result-format'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { useAgentStore } from '@/stores/agent-store'
import { Button } from '@/components/ui/button'
import type { ToolCallStatus } from '@/lib/agent/types'
import { getBashInputTerminalId, lineCount } from './utils'
import { CopyButton } from './parts'
import { TerminalFallback } from '@/components/ui/lazy-fallback'

const LocalTerminal = React.lazy(() =>
  import('@/components/terminal/LocalTerminal').then(m => ({ default: m.LocalTerminal }))
)

export interface ShellOutputSummary {
  live?: boolean
  mode?: 'full' | 'compact' | 'tail'
  noisy?: boolean
  totalChars?: number
  totalLines?: number
  stdoutLines?: number
  stderrLines?: number
  errorLikeLines?: number
  warningLikeLines?: number
  totalMs?: number
  spawnMs?: number
  firstChunkMs?: number
  shell?: string
  executionEngine?: 'tauri' | 'sidecar' | 'ssh'
  timedOut?: boolean
  aborted?: boolean
}

type LiveShellStream = 'stdout' | 'stderr'

export interface LiveShellOutputState {
  execId: string | null
  stdout: string
  stderr: string
}

const LIVE_SHELL_OUTPUT_MAX_CHARS = 12_000
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

export function normalizeLiveShellChunk(chunk: string): string {
  return chunk.replace(ANSI_ESCAPE_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function clampLiveShellText(text: string): string {
  if (text.length <= LIVE_SHELL_OUTPUT_MAX_CHARS) return text
  return text.slice(-LIVE_SHELL_OUTPUT_MAX_CHARS)
}

export function appendLiveShellOutput(
  state: LiveShellOutputState,
  execId: string,
  stream: LiveShellStream,
  chunk: string
): LiveShellOutputState {
  const base =
    state.execId === execId
      ? state
      : {
          execId,
          stdout: '',
          stderr: ''
        }
  const text = normalizeLiveShellChunk(chunk)
  if (!text) return base
  if (stream === 'stderr') {
    return {
      ...base,
      stderr: clampLiveShellText(`${base.stderr}${text}`)
    }
  }
  return {
    ...base,
    stdout: clampLiveShellText(`${base.stdout}${text}`)
  }
}

export function ShellTextPane({
  title,
  text,
  expanded,
  tone = 'default'
}: {
  title: string
  text: string
  expanded: boolean
  tone?: 'default' | 'error'
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  if (!text) return null
  const isLong = text.length > 1000
  const displayed = isLong && !expanded ? `...\n${text.slice(-1000)}` : text
  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border',
        tone === 'error'
          ? 'border-destructive/20 bg-destructive/[0.035]'
          : 'border-border/70 bg-muted/30'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-b px-3 py-1.5',
          tone === 'error'
            ? 'border-destructive/15 bg-destructive/[0.04]'
            : 'border-border/70 bg-muted/40'
        )}
      >
        <span
          className={cn(
            'text-[10px] font-medium uppercase tracking-[0.12em]',
            tone === 'error' ? 'text-destructive/80' : 'text-muted-foreground/80'
          )}
        >
          {title}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          {t('toolCall.lineCount', { count: lineCount(text) })}
        </span>
      </div>
      <pre
        className={cn(
          'max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[11px] leading-5 antialiased',
          tone === 'error' ? 'text-destructive/90' : 'text-foreground/88'
        )}
        style={{ fontFamily: MONO_FONT }}
      >
        {displayed}
      </pre>
    </section>
  )
}

export function bashOutputStats(outputText: string | undefined): {
  lines: number | null
  exitCode: number | null
} {
  if (!outputText?.trim()) return { lines: null, exitCode: null }
  const decoded = decodeStructuredToolResult(outputText)
  if (decoded && !Array.isArray(decoded)) {
    const stdout =
      typeof decoded.stdout === 'string'
        ? decoded.stdout
        : typeof decoded.output === 'string'
          ? decoded.output
          : ''
    const stderr = typeof decoded.stderr === 'string' ? decoded.stderr : ''
    const text = [stderr, stdout].filter(Boolean).join('\n\n')
    return {
      lines: text ? lineCount(text) : null,
      exitCode: typeof decoded.exitCode === 'number' ? decoded.exitCode : null
    }
  }
  return { lines: lineCount(outputText), exitCode: null }
}

export function BashOutputBlock({
  output,
  input,
  toolUseId,
  status
}: {
  output: string
  input: Record<string, unknown>
  toolUseId?: string
  status: ToolCallStatus | 'completed'
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const sendBackgroundProcessInput = useAgentStore((s) => s.sendBackgroundProcessInput)
  const stopBackgroundProcess = useAgentStore((s) => s.stopBackgroundProcess)
  const abortForegroundShellExec = useAgentStore((s) => s.abortForegroundShellExec)
  const foregroundExecId = useAgentStore((s) =>
    toolUseId ? s.foregroundShellExecByToolUseId[toolUseId] : undefined
  )
  const [liveShellOutput, setLiveShellOutput] = React.useState<LiveShellOutputState>({
    execId: null,
    stdout: '',
    stderr: ''
  })

  React.useEffect(() => {
    if (!foregroundExecId || status !== 'running') {
      setLiveShellOutput((current) =>
        current.execId === null ? current : { execId: null, stdout: '', stderr: '' }
      )
      return
    }

    setLiveShellOutput({ execId: foregroundExecId, stdout: '', stderr: '' })
    return tauriCommands.on(TAURI_COMMANDS.SHELL_OUTPUT, (payload) => {
      const data = payload as { execId?: unknown; chunk?: unknown; stream?: unknown }
      const chunk = data.chunk
      if (data.execId !== foregroundExecId || typeof chunk !== 'string') return
      setLiveShellOutput((current) =>
        appendLiveShellOutput(
          current,
          foregroundExecId,
          data.stream === 'stderr' ? 'stderr' : 'stdout',
          chunk
        )
      )
    })
  }, [foregroundExecId, status])

  const parsed = React.useMemo(() => {
    const obj = decodeStructuredToolResult(output)
    if (
      obj &&
      !Array.isArray(obj) &&
      ('stdout' in obj || 'output' in obj || 'exitCode' in obj || 'processId' in obj)
    ) {
      return obj as {
        stdout?: string
        stderr?: string
        exitCode?: number
        output?: string
        processId?: string
        terminalId?: string
        summary?: ShellOutputSummary
      }
    }
    return null
  }, [output])

  const processId = parsed?.processId ? String(parsed.processId) : null
  const process = useAgentStore((s) => (processId ? s.backgroundProcesses[processId] : undefined))
  const inputTerminalId = React.useMemo(() => getBashInputTerminalId(input), [input])
  const terminalId = process?.terminalId ?? parsed?.terminalId ?? inputTerminalId ?? null
  const isProcessRunning = process?.status === 'running'
  const canStopForegroundExec =
    !process && status === 'running' && !!toolUseId && !!foregroundExecId

  const liveStdoutText = liveShellOutput.execId === foregroundExecId ? liveShellOutput.stdout : ''
  const liveStderrText = liveShellOutput.execId === foregroundExecId ? liveShellOutput.stderr : ''
  const storedStdoutText = parsed?.stdout ?? parsed?.output ?? ''
  const storedStderrText = parsed?.stderr ?? ''
  const stdoutText = process
    ? process.output
    : liveStdoutText.length > storedStdoutText.length
      ? liveStdoutText
      : storedStdoutText
  const stderrText = process
    ? ''
    : liveStderrText.length > storedStderrText.length
      ? liveStderrText
      : storedStderrText
  const text = process ? process.output : [stderrText, stdoutText].filter(Boolean).join('\n\n')
  const showTerminal = Boolean(terminalId)

  return (
    <div className="space-y-2">
      {showTerminal ? (
        <div className="overflow-hidden rounded-md bg-black/90">
          <div className="h-[320px] min-h-[220px] w-full">
            <React.Suspense fallback={<TerminalFallback />}>
              <LocalTerminal terminalId={terminalId ?? ''} readOnly={!isProcessRunning} />
            </React.Suspense>
          </div>
        </div>
      ) : (
        <div className="text-[11px]" style={{ fontFamily: MONO_FONT }}>
          <div className="mb-1 flex items-center justify-end gap-1.5">
            {processId ? (
              <span className="rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {processId}
              </span>
            ) : null}
            <CopyButton text={text} />
          </div>
          {text ? (
            stderrText ? (
              <div className="space-y-3">
                <ShellTextPane title="stderr" text={stderrText} expanded tone="error" />
                <ShellTextPane
                  title={stderrText ? 'stdout' : 'output'}
                  text={stdoutText}
                  expanded
                />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words leading-5 text-foreground/88">
                {text}
              </pre>
            )
          ) : (
            <pre className="whitespace-pre-wrap break-words text-muted-foreground">
              {t('toolCall.noOutputYet')}
            </pre>
          )}
        </div>
      )}

      {process ? (
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!isProcessRunning}
            onClick={() => void sendBackgroundProcessInput(process.id, '', false)}
          >
            {t('toolCall.sendCtrlC')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            disabled={!isProcessRunning}
            onClick={() => void stopBackgroundProcess(process.id)}
          >
            <Square className="size-2.5 fill-current" />
            {t('toolCall.stopProcess')}
          </Button>
        </div>
      ) : null}

      {canStopForegroundExec ? (
        <div className="flex items-center gap-1.5">
          <Button
            variant="destructive"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={() => {
              if (!toolUseId) return
              void abortForegroundShellExec(toolUseId)
            }}
          >
            <Square className="size-2.5 fill-current" />
            {t('toolCall.stopProcess')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
