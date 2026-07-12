import type { ImageAttachment } from './image-attachments'
import type { SelectedFileItem } from './select-file-editor'

// ---- Unified attachment types ----

export interface ComposerImageAttachment {
  type: 'image'
  id: string
  name: string
  dataUrl: string
  mediaType: string
  /** File size in bytes (if available). */
  size?: number
}

export interface ComposerFileAttachment {
  type: 'file'
  id: string
  name: string
  originalPath: string
  sendPath: string
  previewPath: string
  isWorkspaceFile: boolean
  /** File size in bytes (if available). */
  size?: number
}

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment

// ---- Conversion helpers ----

export function imageAttachmentToComposer(
  img: ImageAttachment,
  name: string,
  size?: number
): ComposerImageAttachment {
  return { type: 'image', id: img.id, name, dataUrl: img.dataUrl, mediaType: img.mediaType, size }
}

export function composerImageToImageAttachment(att: ComposerImageAttachment): ImageAttachment {
  return { id: att.id, dataUrl: att.dataUrl, mediaType: att.mediaType }
}

export function selectedFileToComposer(
  file: SelectedFileItem,
  size?: number
): ComposerFileAttachment {
  return {
    type: 'file',
    id: file.id,
    name: file.name,
    originalPath: file.originalPath,
    sendPath: file.sendPath,
    previewPath: file.previewPath,
    isWorkspaceFile: file.isWorkspaceFile,
    size
  }
}

export function composerFileToSelectedFile(att: ComposerFileAttachment): SelectedFileItem {
  return {
    id: att.id,
    name: att.name,
    originalPath: att.originalPath,
    sendPath: att.sendPath,
    previewPath: att.previewPath,
    isWorkspaceFile: att.isWorkspaceFile
  }
}

// ---- Type guards ----

export function isImageAttachment(
  att: ComposerAttachment
): att is ComposerImageAttachment {
  return att.type === 'image'
}

export function isFileAttachment(att: ComposerAttachment): att is ComposerFileAttachment {
  return att.type === 'file'
}

// ---- Display helpers ----

/** Always returns the filename for both image and file attachments. */
export function getAttachmentLabel(att: ComposerAttachment): string {
  return att.name
}

/** Human-readable file size (e.g. "2.4 MB"). Returns empty string when unknown. */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`
}
