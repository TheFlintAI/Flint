import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useTranslation } from 'react-i18next'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Clipboard, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { ITheme } from '@xterm/xterm'

const DARK_TERMINAL_THEME: ITheme = {
  background: '#09090b',
  foreground: '#fafafa',
  cursor: '#fafafa',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(250, 250, 250, 0.16)',
  black: '#09090b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#fafafa',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff'
}

interface TerminalOutputChunk {
  seq?: number
  data?: string
}

interface TerminalListEntry {
  id?: string
  buffer?: TerminalOutputChunk[]
}

export function LocalTerminal({
  terminalId,
  readOnly = false
}: {
  terminalId: string
  readOnly?: boolean
}): React.JSX.Element {
  const { t } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false,
      theme: DARK_TERMINAL_THEME
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicodeAddon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(unicodeAddon)
    term.unicode.activeVersion = '11'
    term.open(containerRef.current)
    fitAddon.fit()
    term.focus()
    termRef.current = term
    let disposed = false
    let snapshotLoaded = false
    let latestSeq = 0
    const pendingChunks: Array<{ seq: number; data: string }> = []

    const writeChunk = (chunk: TerminalOutputChunk): void => {
      if (!chunk.data) return
      const seq = typeof chunk.seq === 'number' ? chunk.seq : latestSeq + 1
      if (seq <= latestSeq) return
      latestSeq = seq
      term.write(chunk.data)
    }

    const selectionDisposable = term.onSelectionChange(() => {
      setHasSelection(term.getSelection().length > 0)
    })

    const dataDisposable = readOnly
      ? { dispose: () => {} }
      : term.onData((data) => {
          void tauriCommands.invoke(TAURI_COMMANDS.TERMINAL_INPUT, { id: terminalId, data })
        })

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      void tauriCommands.invoke(TAURI_COMMANDS.TERMINAL_RESIZE, { id: terminalId, cols, rows })
    })

    const outputCleanup = tauriCommands.on(TAURI_COMMANDS.TERMINAL_OUTPUT, (payload) => {
      const data = payload as { id?: string; data?: string; seq?: number }
      if (data.id !== terminalId || !data.data) return
      if (!snapshotLoaded) {
        pendingChunks.push({
          seq: typeof data.seq === 'number' ? data.seq : latestSeq + pendingChunks.length + 1,
          data: data.data
        })
        return
      }
      writeChunk(data)
    })

    void tauriCommands
      .invoke(TAURI_COMMANDS.TERMINAL_LIST)
      .then((result) => {
        if (disposed) return
        const tasks = Array.isArray(result) ? (result as TerminalListEntry[]) : []
        const matched = tasks.find((item) => item.id === terminalId)
        const snapshot = Array.isArray(matched?.buffer) ? matched.buffer : []

        snapshot
          .slice()
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
          .forEach((chunk) => writeChunk(chunk))
      })
      .catch(() => {
        // ignore terminal snapshot failures; live output listener remains active
      })
      .finally(() => {
        if (disposed) return
        snapshotLoaded = true
        pendingChunks.sort((a, b) => a.seq - b.seq).forEach((chunk) => writeChunk(chunk))
        pendingChunks.length = 0
      })

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
          void tauriCommands.invoke(TAURI_COMMANDS.TERMINAL_RESIZE, {
            id: terminalId,
            cols: term.cols,
            rows: term.rows
          })
        } catch {
          // ignore
        }
      })
    })
    resizeObserver.observe(containerRef.current)

    requestAnimationFrame(() => {
      fitAddon.fit()
      void tauriCommands.invoke(TAURI_COMMANDS.TERMINAL_RESIZE, {
        id: terminalId,
        cols: term.cols,
        rows: term.rows
      })
    })

    return () => {
      disposed = true
      selectionDisposable.dispose()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      outputCleanup()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [readOnly, terminalId])

  const handleCopy = useCallback(() => {
    const selection = termRef.current?.getSelection()
    if (!selection) return
    navigator.clipboard.writeText(selection).then(
      () => toast.success(t('terminal.copied', { defaultValue: 'Copied' })),
      () => toast.error(t('terminal.copyFailed', { defaultValue: 'Copy failed' }))
    )
  }, [t])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      await tauriCommands.invoke(TAURI_COMMANDS.TERMINAL_INPUT, { id: terminalId, data: text })
    } catch {
      toast.error(t('terminal.pasteFailed', { defaultValue: 'Paste failed' }))
    }
  }, [terminalId, t])

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ backgroundColor: DARK_TERMINAL_THEME.background }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden px-1 py-1"
            style={{ minHeight: 0 }}
            onClick={() => termRef.current?.focus()}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleCopy} disabled={!hasSelection}>
            <Copy className="mr-2 size-4" />
            {t('terminal.copy', { defaultValue: 'Copy' })}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void handlePaste()} disabled={readOnly}>
            <Clipboard className="mr-2 size-4" />
            {t('terminal.paste', { defaultValue: 'Paste' })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => termRef.current?.clear()}>
            {t('terminal.clear', { defaultValue: 'Clear' })}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => termRef.current?.selectAll()}>
            {t('terminal.selectAll', { defaultValue: 'Select all' })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
