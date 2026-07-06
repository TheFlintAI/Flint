import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Pencil,
  Trash2,
  FilePlus2,
  FolderPlus,
  GripVertical
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { DepthGuides } from './DepthGuides'
import { InlineInput } from './InlineInput'
import { fileIcon, IGNORED_DIRS } from './tree-utils'
import type { TreeNode, TreeEditState, TreeActions } from './types'

export function TreeItem({
  node,
  depth,
  onToggle,
  onCopyPath,
  onFileDragStart,
  editState,
  actions
}: {
  node: TreeNode
  depth: number
  onToggle: (path: string) => void
  onCopyPath: (path: string) => void
  onFileDragStart: (event: React.DragEvent<HTMLElement>, path: string) => void
  editState: TreeEditState
  actions: TreeActions
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [copied, setCopied] = useState(false)
  const isDir = node.type === 'directory'
  const isIgnored = isDir && IGNORED_DIRS.has(node.name)
  const safeEditState = editState ?? {
    renamingPath: null,
    newItemParent: null,
    newItemType: 'file' as const
  }
  const isRenaming = safeEditState.renamingPath === node.path

  const handleCopy = useCallback(() => {
    onCopyPath(node.path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }, [node.path, onCopyPath])

  const rowContent = (
    <div
      className={cn(
        'workspace-filetree-row group relative flex items-center gap-2 rounded-xl px-2 py-1.5 text-[12px] transition-all',
        isDir ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        isDir && node.expanded
          ? 'workspace-filetree-row--expanded workspace-filetree-row--interactive'
          : 'workspace-filetree-row--interactive',
        isIgnored && 'opacity-40'
      )}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      onClick={() => { if (isDir && !isIgnored) onToggle(node.path) }}
      onDragStart={(event) => {
        if (!isDir) {
          onFileDragStart(event, node.path)
        }
      }}
      draggable={!isDir && !isRenaming}
      title={node.path}
    >
      <DepthGuides depth={depth} />
      {depth > 0 && (
        <span
          className="workspace-filetree-guide absolute top-1/2 h-px w-2 pointer-events-none"
          style={{ left: `${(depth - 1) * 14 + 9}px` }}
        />
      )}

      {isDir ? (
        node.expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
        )
      ) : (
        <GripVertical className="size-3 shrink-0 text-muted-foreground/25 transition-colors group-hover:text-muted-foreground/60" />
      )}

      {isDir ? (
        node.expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-amber-400" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-amber-400/80" />
        )
      ) : (
        fileIcon(node.name)
      )}

      {isRenaming ? (
        <input
          autoFocus
          className="workspace-filetree-input flex-1 min-w-0 rounded-sm border px-1 py-0 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring/20"
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value.trim()
              if (val && val !== node.name) actions.onRenameConfirm(val)
              else actions.onRenameCancel()
            }
            if (e.key === 'Escape') actions.onRenameCancel()
          }}
          onBlur={() => actions.onRenameCancel()}
          onFocus={(e) => {
            const dot = node.name.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 && !isDir ? dot : node.name.length)
          }}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'truncate',
              isDir ? 'font-medium text-foreground/85' : 'text-foreground/80'
            )}
          >
            {node.name}
          </span>
          {!isDir && (
            <span className="workspace-filetree-chip rounded-full px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
              {t('fileTree.dragToReference')}
            </span>
          )}
        </div>
      )}

      {!isDir && !isRenaming && (
        <button
          className="workspace-filetree-action shrink-0 rounded-md p-1 opacity-0 transition-all group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
          title={t('fileTree.copyPath')}
        >
          {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
        </button>
      )}
    </div>
  )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {isDir && !isIgnored && (
            <>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onNewFile(node.path)}
              >
                <FilePlus2 className="size-3.5" /> {t('fileTree.newFile')}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onNewFolder(node.path)}
              >
                <FolderPlus className="size-3.5" /> {t('fileTree.newFolder')}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            className="gap-2 text-xs"
            onSelect={() => actions.onRenameStart(node.path, node.name)}
          >
            <Pencil className="size-3.5" /> {t('action.rename', { ns: 'common' })}
          </ContextMenuItem>
          <ContextMenuItem className="gap-2 text-xs" onSelect={handleCopy}>
            <Copy className="size-3.5" /> {t('action.copyPath', { ns: 'common' })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="gap-2 text-xs text-destructive focus:text-destructive"
            onSelect={() => actions.onDelete(node.path, node.name, isDir)}
          >
            <Trash2 className="size-3.5" /> {t('action.delete', { ns: 'common' })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* New item input (shown as first child of this directory) */}
      {isDir && node.expanded && safeEditState.newItemParent === node.path && (
        <InlineInput
          defaultValue={safeEditState.newItemType === 'file' ? 'untitled' : 'new-folder'}
          depth={depth + 1}
          icon={
            safeEditState.newItemType === 'file' ? (
              <File className="size-3.5 text-muted-foreground/60" />
            ) : (
              <Folder className="size-3.5 text-amber-400/70" />
            )
          }
          onConfirm={actions.onNewItemConfirm}
          onCancel={actions.onNewItemCancel}
        />
      )}

      {/* Children */}
      <AnimatePresence>
        {isDir && node.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {node.children?.length ? (
              node.children.map((child) => (
                <TreeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  onToggle={onToggle}
                  onCopyPath={onCopyPath}
                  onFileDragStart={onFileDragStart}
                  editState={editState}
                  actions={actions}
                />
              ))
            ) : (
              <div
                className="relative py-1 pl-8 text-[11px] text-muted-foreground/45"
                style={{ paddingLeft: `${(depth + 1) * 14 + 18}px` }}
              >
                <DepthGuides depth={depth + 1} />
                <span className="relative">{t('fileTree.empty')}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
