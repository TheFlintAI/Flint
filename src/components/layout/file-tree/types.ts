export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  path: string
}

export interface TreeNode extends FileEntry {
  children?: TreeNode[]
  loaded?: boolean
  expanded?: boolean
}

export interface FileSearchItem {
  name: string
  path: string
}

export interface TreeEditState {
  renamingPath: string | null
  newItemParent: string | null
  newItemType: 'file' | 'directory'
}

export interface TreeActions {
  onDelete: (nodePath: string, nodeName: string, isDir: boolean) => void
  onRenameStart: (nodePath: string, nodeName: string) => void
  onRenameConfirm: (value: string) => void
  onRenameCancel: () => void
  onNewFile: (dirPath: string) => void
  onNewFolder: (dirPath: string) => void
  onNewItemConfirm: (value: string) => void
  onNewItemCancel: () => void
}
