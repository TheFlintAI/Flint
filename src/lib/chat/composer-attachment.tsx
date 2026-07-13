import { nanoid } from 'nanoid'
import React from 'react'
import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileArchive,
  Folder,
  Image,
} from 'lucide-react'
import type { ImageAttachment } from './image-attachments'

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
  /** Whether this attachment represents a directory rather than a regular file. */
  isDirectory?: boolean
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

// ---- Factory ----

/** Create a ComposerFileAttachment from a raw file path and optional working folder. */
export function createComposerFileAttachment(
  filePath: string,
  workingFolder?: string,
  isDirectory?: boolean
): ComposerFileAttachment | null {
  const normalizedPath = filePath.replace(/\\/g, '/').trim()
  if (!normalizedPath) return null

  const normalizedWorkingFolder = workingFolder
    ? workingFolder.replace(/\\/g, '/').replace(/\/+$/, '')
    : ''
  const workingFolderKey = normalizedWorkingFolder
    ? `${normalizedWorkingFolder.toLowerCase()}/`
    : ''
  const isWorkspaceFile =
    Boolean(workingFolderKey) && normalizedPath.toLowerCase().startsWith(workingFolderKey)
  const sendPath = isWorkspaceFile
    ? normalizedPath.slice(normalizedWorkingFolder.length).replace(/^\/+/, '')
    : normalizedPath
  const name = normalizedPath.split('/').pop() || normalizedPath

  return {
    type: 'file',
    id: nanoid(),
    name,
    originalPath: normalizedPath,
    sendPath,
    previewPath: normalizedPath,
    isWorkspaceFile,
    ...(isDirectory ? { isDirectory: true } : {}),
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

// ---- File type icons ----

/** Extension → icon colour pairs. Add new extensions here as needed. */
const CODE_EXT_COLOURS: Record<string, string> = {
  ts: 'text-blue-400', tsx: 'text-blue-400',
  js: 'text-yellow-500', jsx: 'text-yellow-500',
  py: 'text-green-500',
  rs: 'text-orange-400',
  go: 'text-cyan-400',
  css: 'text-purple-400', scss: 'text-purple-400', less: 'text-purple-400',
  html: 'text-orange-400', htm: 'text-orange-400',
  vue: 'text-emerald-500', svelte: 'text-orange-500',
  java: 'text-red-400', kt: 'text-purple-500', swift: 'text-orange-500',
  c: 'text-blue-500', cpp: 'text-blue-500', h: 'text-blue-400', hpp: 'text-blue-400',
  xml: 'text-amber-500', toml: 'text-muted-foreground',
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'zst'])

function resolveFileExt(name: string): string {
  const lastDot = name.lastIndexOf('.')
  if (lastDot < 0) return ''
  return name.slice(lastDot + 1).toLowerCase()
}

/** Return a lucide icon element for a ComposerFileAttachment, matching shadcn style. */
export function attachmentFileIcon(
  att: ComposerFileAttachment,
  className?: string
): React.ReactNode {
  if (att.isDirectory) {
    return <Folder className={className} />
  }

  const ext = resolveFileExt(att.name)

  if (ext === 'json') return <FileJson className={className} />
  if (IMAGE_EXTS.has(ext)) return <Image className={className} />
  if (ARCHIVE_EXTS.has(ext)) return <FileArchive className={className} />

  const colour = CODE_EXT_COLOURS[ext]
  if (colour) return <FileCode className={className ? `${className} ${colour}` : colour} />

  if (ext === 'md' || ext === 'mdx' || ext === 'txt' || ext === 'log' || ext === 'csv') {
    return <FileText className={className} />
  }

  return <File className={className} />
}
