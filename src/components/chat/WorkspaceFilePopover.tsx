import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  Search,
  RefreshCw,
  X,
  ExternalLink
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useChatStore } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { WORKSPACE_FILE_POPOVER_DEFAULT_WIDTH } from '@/components/layout/panel-constants'
import { TreeItem } from '@/components/layout/file-tree/TreeItem'
import {
  sortEntries,
  fileIcon
} from '@/components/layout/file-tree/tree-utils'
import type {
  TreeNode,
  FileSearchItem,
  FileEntry,
  TreeEditState,
  TreeActions
} from '@/components/layout/file-tree/types'

const log = createLogger('WorkspaceFilePopover')

interface WorkspaceFilePopoverProps {
  workingFolder: string
  workspaceDisplayName: string
  activeTaskId: string | null
  /** Called when a file is selected for insertion — the caller adds it as an attachment. */
  onInsertFile?: (filePath: string) => void
}

export function WorkspaceFilePopover({
  workingFolder,
  workspaceDisplayName,
  activeTaskId,
  onInsertFile
}: WorkspaceFilePopoverProps): React.JSX.Element {
  const { t } = useTranslation(['layout', 'chat'])
  const [open, setOpen] = useState(false)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileSearchItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // ---- Tree loading ----
  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_LIST_DIR, {
      path: dirPath
    })) as { entries?: Array<Record<string, unknown>>; error?: string } | FileEntry[]

    if (!Array.isArray(result) && typeof result?.error === 'string') {
      throw new Error(result.error)
    }
    const entries: FileEntry[] = (
      Array.isArray(result) ? result : result?.entries ?? []
    ).map((entry) => {
      const record = entry as Record<string, unknown>
      const type =
        typeof record.type === 'string'
          ? (record.type as FileEntry['type'])
          : record.is_dir
            ? 'directory'
            : 'file'
      return {
        name: String(record.name ?? ''),
        path: String(record.path ?? ''),
        type
      }
    })
    const sorted = sortEntries(entries)
    return sorted.map((e) => ({
      ...e,
      expanded: false,
      loaded: e.type === 'file',
      children: e.type === 'directory' ? [] : undefined
    }))
  }, [])

  const loadRoot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nodes = await loadDir(workingFolder)
      setTree(nodes)
    } catch (err) {
      log.error('Failed to load workspace root:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workingFolder, loadDir])

  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setSearchResults([])
      loadRoot()
    }
  }, [open, loadRoot])

  // ---- Search ----
  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    const timer = window.setTimeout(() => {
      void tauriCommands
        .invoke('fs:search-files', {
          path: workingFolder,
          query,
          limit: 100
        })
        .then((result) => {
          if (cancelled) return
          setSearchResults(Array.isArray(result) ? (result as FileSearchItem[]) : [])
        })
        .catch((err) => {
          if (cancelled) return
          log.error('File search failed:', err)
          setSearchResults([])
        })
        .finally(() => {
          if (cancelled) return
          setSearchLoading(false)
        })
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery, workingFolder])

  // ---- Tree toggle (expand/collapse folder) ----
  const handleToggle = useCallback(
    async (dirPath: string) => {
      const toggleNode = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        return Promise.all(
          nodes.map(async (n) => {
            if (n.path === dirPath && n.type === 'directory') {
              if (n.expanded) {
                return { ...n, expanded: false }
              }
              if (!n.loaded) {
                try {
                  const children = await loadDir(dirPath)
                  return { ...n, expanded: true, loaded: true, children }
                } catch (err) {
                  log.error('Failed to load directory:', dirPath, err)
                  return { ...n, expanded: true, loaded: true, children: [] }
                }
              }
              return { ...n, expanded: true }
            }
            if (n.children) {
              return { ...n, children: await toggleNode(n.children) }
            }
            return n
          })
        )
      }
      setTree(await toggleNode(tree))
    },
    [tree, loadDir]
  )

  // ---- Insert file reference into composer ----
  const handleInsertFile = useCallback(
    (filePath: string) => {
      onInsertFile?.(filePath)
      setOpen(false)
    },
    [onInsertFile]
  )

  // ---- Clear workspace ----
  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!activeTaskId) return
      useChatStore.getState().setWorkingFolder(activeTaskId, '')
    },
    [activeTaskId]
  )

  // ---- Open working folder in OS file explorer ----
  const handleOpenInExplorer = useCallback(() => {
    tauriCommands.invoke(TAURI_COMMANDS.SHELL_OPEN_PATH, workingFolder)
  }, [workingFolder])

  // Read-only mode: no CRUD actions in popover
  const emptyEditState: TreeEditState = useMemo(
    () => ({ renamingPath: null, newItemParent: null, newItemType: 'file' }),
    []
  )
  const noopActions: TreeActions = useMemo(
    () => ({
      onDelete: () => {},
      onRenameStart: () => {},
      onRenameConfirm: () => {},
      onRenameCancel: () => {},
      onNewFile: () => {},
      onNewFolder: () => {},
      onNewItemConfirm: () => {},
      onNewItemCancel: () => {}
    }),
    []
  )

  // ---- Resize ----
  const popoverWidth = useUIStore((s) => s.workspaceFilePopoverWidth)
  const setPopoverWidth = useUIStore((s) => s.setWorkspaceFilePopoverWidth)
  const MIN_POPOVER_WIDTH = 280
  const MAX_POPOVER_WIDTH = 560
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(WORKSPACE_FILE_POPOVER_DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event: MouseEvent): void => {
      if (!draggingRef.current) return
      const delta = event.clientX - startXRef.current
      const next = Math.min(MAX_POPOVER_WIDTH, Math.max(MIN_POPOVER_WIDTH, startWidthRef.current + delta))
      setPopoverWidth(next)
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
  }, [isDragging])

  const startResize = useCallback((event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    draggingRef.current = true
    startXRef.current = event.clientX
    startWidthRef.current = popoverWidth
    setIsDragging(true)
  }, [popoverWidth])

  const isSearching = searchQuery.trim().length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge variant="outline" className="h-8 gap-1 px-2.5 cursor-pointer select-none">
          <FolderOpen className="size-3 shrink-0" />
          <span className="max-w-[100px] truncate">{workspaceDisplayName}</span>
          <button
            type="button"
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            onClick={handleClear}
            aria-label={t('input.contextBar.clearWorkspace', {
              ns: 'chat',
              defaultValue: 'Clear workspace'
            })}
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="relative p-0 rounded-xl"
        style={{ width: popoverWidth }}
      >
        <div className="flex flex-col max-h-[420px]">
          {/* Header */}
          <div className="shrink-0 px-3 pt-3 pb-2">
            <div className="flex items-start gap-2 mb-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
                <FolderOpen className="size-3.5 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-xs font-medium text-foreground"
                  title={workingFolder}
                >
                  {workspaceDisplayName}
                </div>
                <div
                  className="mt-0.5 truncate text-[10px] text-muted-foreground"
                  title={workingFolder}
                >
                  {workingFolder}
                </div>
              </div>
              <button
                type="button"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                onClick={handleOpenInExplorer}
                title={t('fileTree.openInExplorer', {
                  defaultValue: 'Open in file explorer'
                })}
              >
                <ExternalLink className="size-3.5" />
              </button>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('fileTree.searchPlaceholder', {
                  defaultValue: 'Search file names or paths'
                })}
                className="workspace-filetree-input h-7 rounded-lg pl-8 pr-7 text-xs"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="workspace-filetree-action absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* Tree content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 text-[12px]">
            {error && (
              <div className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-destructive">
                <span className="truncate">{error}</span>
              </div>
            )}

            {loading && tree.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : isSearching ? (
              searchLoading ? (
                <div className="workspace-filetree-empty flex items-center gap-2 rounded-xl px-2 py-3 text-xs text-muted-foreground">
                  <RefreshCw className="size-3 animate-spin" />
                  <span>
                    {t('fileTree.searching', { defaultValue: 'Searching files...' })}
                  </span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="workspace-filetree-empty workspace-filetree-empty--dashed flex flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-8 text-center">
                  <Search className="size-4 text-muted-foreground/40" />
                  <div className="text-xs text-muted-foreground">
                    {t('fileTree.noSearchResults', {
                      defaultValue: 'No matching files'
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {searchResults.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className={cn(
                        'workspace-filetree-row workspace-filetree-row--interactive group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left'
                      )}
                      onClick={() => handleInsertFile(file.path)}
                      title={file.path}
                    >
                      {fileIcon(file.name)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-foreground/85">
                          {file.name}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {file.path}
                        </div>
                      </div>
                      <span className="workspace-filetree-chip rounded-full px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
                        {t('fileTree.insertPath', {
                          defaultValue: 'Insert'
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : tree.length === 0 ? (
              <div className="workspace-filetree-empty workspace-filetree-empty--dashed flex flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-8 text-center">
                <FolderOpen className="size-4 text-muted-foreground/40" />
                <div className="text-xs text-muted-foreground">
                  {t('fileTree.empty', { defaultValue: 'Empty folder' })}
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {tree.map((node) => (
                  <TreeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    onToggle={handleToggle}
                    onAddToAttachments={handleInsertFile}
                    editState={emptyEditState}
                    actions={noopActions}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize transition-colors hover:bg-primary/20 z-10"
          onMouseDown={startResize}
        />

        {isDragging && <div className="fixed inset-0 z-[100] cursor-col-resize" />}
      </PopoverContent>
    </Popover>
  )
}
