import { useState, useEffect, useCallback } from 'react'
import { Minus, Maximize2, Minimize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { flushDb } from '@/lib/db/json-store'

export function WindowControls(): React.JSX.Element {
  const { t } = useTranslation('common')
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Get initial state
    tauriCommands.invoke('window:isMaximized').then((val) => setIsMaximized(val as boolean))

    // Listen for maximize state changes from the native backend
    const unsub = tauriCommands.on('window:maximized', (maximized: unknown) => {
      setIsMaximized(maximized as boolean)
    })
    return unsub
  }, [])

  const handleClose = useCallback(() => {
    // Flush pending DB writes before closing to prevent data loss
    flushDb().finally(() => {
      tauriCommands.invoke('window:close')
    })
  }, [])

  return (
    <div className="titlebar-no-drag flex items-center gap-0.5">
      {/* Minimize */}
      <button
        onClick={() => tauriCommands.invoke('window:minimize')}
        className="flex size-8 items-center justify-center text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
        aria-label={t('window.minimize')}
      >
        <Minus className="size-4" />
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={() => tauriCommands.invoke('window:maximize')}
        className="flex size-8 items-center justify-center text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
        aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
      >
        {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>

      {/* Close */}
      <button
        onClick={handleClose}
        className="flex size-8 items-center justify-center text-foreground/60 transition-colors hover:bg-destructive hover:text-destructive-foreground"
        aria-label={t('window.close')}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
