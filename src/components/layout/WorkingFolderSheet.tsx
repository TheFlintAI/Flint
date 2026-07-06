import { useEffect, useRef, useState } from 'react'
import { FolderTree } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { FileTreePanel } from '@/components/layout/FileTreePanel'
import { useChatStore } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'
import { clampWorkingFolderPanelWidth } from './panel-constants'

interface WorkingFolderSheetProps {
  taskId?: string | null
}

export function WorkingFolderSheet({
  taskId = null
}: WorkingFolderSheetProps): React.JSX.Element {
  const { t } = useTranslation(['layout'])
  const open = useUIStore((s) => s.workingFolderSheetOpen)
  const setOpen = useUIStore((s) => s.setWorkingFolderSheetOpen)
  const panelWidth = useUIStore((s) => s.workingFolderPanelWidth)
  const setPanelWidth = useUIStore((s) => s.setWorkingFolderPanelWidth)
  const taskView = useChatStore(
    useShallow((state) => {
      const resolvedTaskId = taskId ?? state.activeTaskId
      const currentTask = resolvedTaskId
        ? state.tasks.find((item) => item.id === resolvedTaskId)
        : undefined

      return {
        taskId: resolvedTaskId,
        workingFolder: currentTask?.workingFolder
      }
    })
  )

  useEffect(() => {
    if (open && !taskView.taskId) {
      setOpen(false)
    }
  }, [open, taskView.taskId, setOpen])

  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(panelWidth)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event: MouseEvent): void => {
      if (!draggingRef.current) return
      const delta = startXRef.current - event.clientX
      setPanelWidth(clampWorkingFolderPanelWidth(startWidthRef.current + delta))
    }

    const handleMouseUp = (): void => {
      draggingRef.current = false
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setPanelWidth])

  const startResize = (event: React.MouseEvent): void => {
    if (!open) return
    event.preventDefault()
    draggingRef.current = true
    startXRef.current = event.clientX
    startWidthRef.current = panelWidth
    setIsDragging(true)
  }

  return (
    <div
      className="relative z-30 h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
      style={{ width: open ? panelWidth : 0 }}
    >
      <aside
        className={`workspace-folder-sheet relative flex h-full w-[420px] flex-col border-l transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{ width: panelWidth }}
      >
        <div className="min-h-0 flex-1">
          {taskView.workingFolder ? (
            <FileTreePanel taskId={taskView.taskId} surface="sheet" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="workspace-filetree-empty flex size-12 items-center justify-center rounded-2xl">
                <FolderTree className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('fileTree.selectFolder', {
                    defaultValue: 'No files available'
                  })}
                </p>
              </div>
            </div>
          )}
        </div>

        {open && (
          <div
            className="workspace-folder-sheet-resize absolute bottom-0 left-0 top-0 z-20 w-1.5 cursor-col-resize transition-colors"
            onMouseDown={startResize}
          />
        )}
      </aside>

      {isDragging && <div className="fixed inset-0 z-[100] cursor-col-resize" />}
    </div>
  )
}
