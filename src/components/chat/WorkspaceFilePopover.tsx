import { useState, useCallback, useEffect, useMemo } from 'react'
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
import { createSelectFileTag } from '@/lib/chat/select-file-tags'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { TreeItem } from '@/components/layout/file-tree/TreeItem'
import {
  sortEntries,
  countTreeStats,
  fileIcon,
  toRelativePath
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
}

export function WorkspaceFilePopover({
  workingFolder,
  workspaceDisplayName,
  activeTaskId
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
      const rel = toRelativePath(filePath, workingFolder)
      useUIStore.getState().setPendingInsertText(createSelectFileTag(rel))
      setOpen(false)
    },
    [workingFolder]
  )

  // ---- Copy path (also inserts) ----
  const handleCopyPath = useCallback(
    (filePath: string) => {
      const rel = toRelativePath(filePath, workingFolder)
      useUIStore.getState().setPendingInsertText(createSelectFileTag(rel))
      setOpen(false)
    },
    [workingFolder]
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

  // ---- Open full file tree panel ----
  const handleOpenPanel = useCallback(() => {
    setOpen(false)
    useUIStore.getState().setWorkingFolderSheetOpen(true)
  }, [])

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

  const treeStats = useMemo(() => countTreeStats(tree), [tree])
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
        className="w-[340px] p-0 rounded-xl"
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
                onClick={handleOpenPanel}
                title={t('fileTree.openInPanel', {
                  defaultValue: 'Open in full panel'
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
                    onCopyPath={handleCopyPath}
                    editState={emptyEditState}
                    actions={noopActions}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {!isSearching && !loading && tree.length > 0 && (
            <div className="shrink-0 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground/70">
              {treeStats.folders > 0 && (
                <span>
                  {treeStats.folders}{' '}
                  {t('unit.folders', { ns: 'common', defaultValue: 'folders' })}
                </span>
              )}
              {treeStats.folders > 0 && treeStats.files > 0 && <span> · </span>}
              {treeStats.files > 0 && (
                <span>
                  {treeStats.files}{' '}
                  {t('unit.files', { ns: 'common', defaultValue: 'files' })}
                </span>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
