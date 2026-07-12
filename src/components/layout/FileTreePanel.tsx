import { useState, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  FolderOpen,
  Folder,
  Search,
  FolderPlus,
  RefreshCw,
  ChevronDown,
  X,
  AlertCircle,
  GripVertical
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChatStore } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { createSelectFileTag } from '@/lib/chat/select-file-tags'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { TreeItem } from './file-tree/TreeItem'
import {
  sortEntries,
  countTreeStats,
  collapseTree,
  toRelativePath,
  parentPath,
  joinPath,
  fileIcon
} from './file-tree/tree-utils'
import type { TreeNode, FileSearchItem, FileEntry, TreeEditState, TreeActions } from './file-tree/types'

const log = createLogger('FileTree')

interface FileTreePanelProps {
  taskId?: string | null
  surface?: 'card' | 'sheet'
}

export function FileTreePanel({
  taskId = null,
  surface = 'card'
}: FileTreePanelProps): React.JSX.Element {
  const { t } = useTranslation('layout')
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
  const workingFolder = taskView.workingFolder

  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileSearchItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // --- Edit state for context menu actions ---
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [newItemParent, setNewItemParent] = useState<string | null>(null)
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file')

  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_LIST_DIR, {
      path: dirPath
    })) as { entries?: Array<Record<string, unknown>>; error?: string } | FileEntry[]
    if (!Array.isArray(result) && typeof result?.error === 'string') {
      throw new Error(result.error)
    }
    const entries: FileEntry[] = (Array.isArray(result) ? result : result?.entries ?? []).map(
      (entry) => {
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
      }
    )
    const sorted = sortEntries(entries)
    return sorted.map((e) => ({
      ...e,
      expanded: false,
      loaded: e.type === 'file',
      children: e.type === 'directory' ? [] : undefined
    }))
  }, [])

  const loadRoot = useCallback(async () => {
    if (!workingFolder) return
    setLoading(true)
    setError(null)
    try {
      const nodes = await loadDir(workingFolder)
      setTree(nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workingFolder, loadDir])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!workingFolder || !query) {
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
        .catch(() => {
          if (cancelled) return
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
                } catch {
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

  // Refresh a single directory's children in the tree (after create/rename/delete)
  const refreshDir = useCallback(
    async (dirPath: string) => {
      const refresh = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        return Promise.all(
          nodes.map(async (n) => {
            if (n.path === dirPath && n.type === 'directory') {
              try {
                const children = await loadDir(dirPath)
                return { ...n, expanded: true, loaded: true, children }
              } catch {
                return n
              }
            }
            if (n.children) return { ...n, children: await refresh(n.children) }
            return n
          })
        )
      }
      setTree(await refresh(tree))
    },
    [tree, loadDir]
  )

  const handleCopyPath = useCallback(
    (filePath: string) => {
      // Make path relative to working folder if possible
      const rel =
        workingFolder && filePath.startsWith(workingFolder)
          ? filePath.slice(workingFolder.length).replace(/^[\\//]/, '')
          : filePath
      useUIStore.getState().setPendingInsertText(createSelectFileTag(rel))
      navigator.clipboard.writeText(filePath)
    },
    [workingFolder]
  )

  // --- Context menu action handlers ---

  const sep = workingFolder?.includes('/') ? '/' : '\\'

  const handleDelete = useCallback(
    async (nodePath: string, nodeName: string, isDir: boolean) => {
      const confirmed = await confirm({
        title: t('fileTree.deleteConfirm', {
          type: isDir ? t('fileTree.folder') : t('fileTree.file'),
          name: nodeName
        }),
        variant: 'destructive'
      })
      if (!confirmed) return
      try {
        await tauriCommands.invoke(TAURI_COMMANDS.FS_DELETE, { path: nodePath })
        const parentDir = parentPath(nodePath, sep)
        if (parentDir === workingFolder) {
          await loadRoot()
        } else {
          await refreshDir(parentDir)
        }
      } catch (err) {
        log.error('Delete failed:', err)
      }
    },
    [sep, t, workingFolder, loadRoot, refreshDir]
  )

  const handleRenameStart = useCallback((nodePath: string) => {
    setRenamingPath(nodePath)
    setNewItemParent(null)
  }, [])

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renamingPath) return
      const parentDir = parentPath(renamingPath, sep)
      const newPath = joinPath(parentDir, newName, sep)
      try {
        await tauriCommands.invoke(TAURI_COMMANDS.FS_MOVE, { from: renamingPath, to: newPath })
        setRenamingPath(null)
        if (parentDir === workingFolder) {
          await loadRoot()
        } else {
          await refreshDir(parentDir)
        }
      } catch (err) {
        log.error('Rename failed:', err)
      }
    },
    [renamingPath, sep, workingFolder, loadRoot, refreshDir]
  )

  const handleRenameCancel = useCallback(() => setRenamingPath(null), [])

  const handleNewFile = useCallback(
    async (dirPath: string) => {
      setNewItemParent(dirPath)
      setNewItemType('file')
      setRenamingPath(null)
      // Ensure the directory is expanded
      const expandNode = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        return Promise.all(
          nodes.map(async (n) => {
            if (n.path === dirPath && n.type === 'directory' && !n.expanded) {
              if (!n.loaded) {
                const children = await loadDir(dirPath)
                return { ...n, expanded: true, loaded: true, children }
              }
              return { ...n, expanded: true }
            }
            if (n.children) return { ...n, children: await expandNode(n.children) }
            return n
          })
        )
      }
      setTree(await expandNode(tree))
    },
    [tree, loadDir]
  )

  const handleNewFolder = useCallback(
    async (dirPath: string) => {
      setNewItemParent(dirPath)
      setNewItemType('directory')
      setRenamingPath(null)
      const expandNode = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        return Promise.all(
          nodes.map(async (n) => {
            if (n.path === dirPath && n.type === 'directory' && !n.expanded) {
              if (!n.loaded) {
                const children = await loadDir(dirPath)
                return { ...n, expanded: true, loaded: true, children }
              }
              return { ...n, expanded: true }
            }
            if (n.children) return { ...n, children: await expandNode(n.children) }
            return n
          })
        )
      }
      setTree(await expandNode(tree))
    },
    [tree, loadDir]
  )

  const handleNewItemConfirm = useCallback(
    async (name: string) => {
      if (!newItemParent) return
      const newPath = joinPath(newItemParent, name, sep)
      try {
        if (newItemType === 'directory') {
          await tauriCommands.invoke(TAURI_COMMANDS.FS_MKDIR, { path: newPath })
        } else {
          await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE, { path: newPath, content: '' })
        }
        setNewItemParent(null)
        await refreshDir(newItemParent)
      } catch (err) {
        log.error('Create failed:', err)
      }
    },
    [newItemParent, newItemType, sep, refreshDir]
  )

  const handleNewItemCancel = useCallback(() => setNewItemParent(null), [])

  const treeStats = useMemo(() => countTreeStats(tree), [tree])
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const isSearching = normalizedSearchQuery.length > 0

  const editState: TreeEditState = { renamingPath, newItemParent, newItemType }
  const treeActions: TreeActions = {
    onDelete: handleDelete,
    onRenameStart: handleRenameStart,
    onRenameConfirm: handleRenameConfirm,
    onRenameCancel: handleRenameCancel,
    onNewFile: handleNewFile,
    onNewFolder: handleNewFolder,
    onNewItemConfirm: handleNewItemConfirm,
    onNewItemCancel: handleNewItemCancel
  }

  const handleCollapseAll = useCallback(() => {
    setTree((current) => collapseTree(current))
  }, [])
  const compactSheetSurface = surface === 'sheet'

  if (!workingFolder) {
    return (
      <div className="workspace-filetree-empty flex flex-col items-center justify-center gap-2 rounded-xl py-8 text-muted-foreground/70">
        <FolderPlus className="size-8" />
        <p className="text-xs">{t('fileTree.selectFolder')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'workspace-filetree-surface flex min-h-0 flex-1 flex-col overflow-hidden',
          compactSheetSurface
            ? 'workspace-filetree-surface--sheet'
            : 'workspace-filetree-surface--card rounded-xl'
        )}
      >
        <div
          className={cn(
            'workspace-filetree-header',
            compactSheetSurface ? 'px-3 py-3' : 'px-3 py-3'
          )}
        >
          {!compactSheetSurface && (
            <>
              <div className="flex items-start gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10">
                  <FolderOpen className="size-4 text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="truncate text-sm font-medium text-foreground"
                      title={workingFolder}
                    >
                      {workingFolder.split(/[\\/]/).pop()}
                    </div>
                    <span className="workspace-filetree-chip rounded-full px-1.5 py-0.5 text-[10px]">
                      {t('fileTree.dragToReference')}
                    </span>
                  </div>
                  <div
                    className="mt-1 truncate text-[11px] text-muted-foreground"
                    title={workingFolder}
                  >
                    {workingFolder}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-lg"
                    onClick={handleCollapseAll}
                    disabled={tree.length === 0 || isSearching}
                    title={t('action.showLess', { ns: 'common' })}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-lg"
                    onClick={() => {
                      void loadRoot()
                    }}
                    disabled={loading}
                    title={t('action.refresh', { ns: 'common' })}
                  >
                    <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="workspace-filetree-chip rounded-full px-2 py-1">
                  {treeStats.folders} {t('unit.folders', { ns: 'common' })}
                </span>
                <span className="workspace-filetree-chip rounded-full px-2 py-1">
                  {treeStats.files} {t('unit.files', { ns: 'common' })}
                </span>
                {isSearching && (
                  <span className="rounded-full border border-border bg-accent/50 px-2 py-1 text-muted-foreground">
                    {searchResults.length} {t('unit.matches', { ns: 'common' })}
                  </span>
                )}
              </div>
            </>
          )}

          <div className={cn('relative', !compactSheetSurface && 'mt-3')}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('fileTree.searchPlaceholder', {
                defaultValue: 'Search file name or path'
              })}
              className="workspace-filetree-input h-9 rounded-xl pl-9 pr-9 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                className="workspace-filetree-action absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md transition-colors"
                onClick={() => setSearchQuery('')}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="workspace-filetree-header flex items-center gap-1.5 px-3 py-2 text-[11px] text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto text-[12px]',
            compactSheetSurface ? 'px-3 py-3' : 'px-2 py-2'
          )}
        >
          {loading && tree.length === 0 ? (
            <div className="flex h-full items-center justify-center py-8">
              <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : isSearching ? (
            searchLoading ? (
              <div className="workspace-filetree-empty flex items-center gap-2 rounded-xl px-3 py-3 text-xs text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin" />
                <span>{t('fileTree.searching', { defaultValue: 'Searching files...' })}</span>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="workspace-filetree-empty workspace-filetree-empty--dashed flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-10 text-center">
                <Search className="size-5 text-muted-foreground/50" />
                <div className="text-xs text-muted-foreground">
                  {t('fileTree.noSearchResults', { defaultValue: 'No matching files' })}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {searchResults.map((file) => {
                  const relativePath = toRelativePath(file.path, workingFolder)
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={cn(
                        'workspace-filetree-row group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all',
                        'workspace-filetree-row--interactive'
                      )}
                      onClick={() => handleCopyPath(file.path)}
                      title={file.path}
                    >
                      <GripVertical className="size-3 shrink-0 text-muted-foreground/25 transition-colors group-hover:text-muted-foreground/60" />
                      {fileIcon(file.name)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground/90">
                          {file.name}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {relativePath}
                        </div>
                      </div>
                      <span className="workspace-filetree-chip rounded-full px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
                        {t('fileTree.dragToReference')}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          ) : tree.length === 0 ? (
            <div className="workspace-filetree-empty workspace-filetree-empty--dashed flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-10 text-center">
              <Folder className="size-5 text-muted-foreground/50" />
              <div className="text-xs text-muted-foreground">
                {t('fileTree.empty', { defaultValue: 'No files in current directory' })}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  onToggle={handleToggle}
                  onCopyPath={handleCopyPath}
                  editState={editState}
                  actions={treeActions}
                />
              ))}
            </div>
          )}
        </div>

        {!compactSheetSurface && (
          <div className="workspace-filetree-footer px-3 py-2 text-[10px] text-muted-foreground/80">
            {isSearching
              ? t('fileTree.searchHint', {
                  defaultValue: 'Click to preview, drag to input to insert file reference'
                })
              : t('fileTree.stats', {
                  folders: treeStats.folders,
                  files: treeStats.files
                })}
          </div>
        )}
      </div>
    </div>
  )
}
