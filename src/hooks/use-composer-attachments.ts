import * as React from 'react'
import {
  ACCEPTED_IMAGE_TYPES,
  fileToImageAttachment,
  type ImageAttachment
} from '@/lib/chat/image-attachments'
import {
  imageAttachmentToComposer,
  createComposerFileAttachment,
  type ComposerAttachment,
  type ComposerFileAttachment,
  type ComposerImageAttachment
} from '@/lib/chat/composer-attachment'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { createLogger } from '@/lib/logger'

const log = createLogger('useComposerAttachments')

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

function getImageMediaTypeForPath(filePath: string): string | null {
  const normalized = filePath.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  const extension = normalized.match(/\.([a-z0-9]+)$/)?.[1]
  return extension ? (IMAGE_MEDIA_TYPE_BY_EXTENSION[extension] ?? null) : null
}

function createImageAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random().toString(36)}`
}

function normalizePathKey(value: string): string {
  return value.replace(/\\/g, '/').trim().toLowerCase()
}

export interface UseComposerAttachmentsOptions {
  supportsVision: boolean
  workingFolder: string | undefined
}

export interface UseComposerAttachmentsResult {
  attachments: ComposerAttachment[]
  pendingImageReads: number
  addImages: (files: File[]) => Promise<void>
  addFiles: (filePaths: string[], isDirectory?: boolean) => void
  removeAttachment: (id: string) => void
  readImagePathAsAttachment: (filePath: string) => Promise<ImageAttachment | null>
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  handleDropFiles: (fileList: FileList | null) => void
  getPastedImageFiles: (clipboardData: DataTransfer | null | undefined) => File[]
  getImageMediaTypeForPath: (filePath: string) => string | null
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  setPendingImageReads: React.Dispatch<React.SetStateAction<number>>
}

export function useComposerAttachments({
  supportsVision,
  workingFolder
}: UseComposerAttachmentsOptions): UseComposerAttachmentsResult {
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const [pendingImageReads, setPendingImageReads] = React.useState(0)

  const addImages = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return

    setPendingImageReads((prev) => prev + files.length)
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const attachment = await fileToImageAttachment(file)
          return attachment ? { attachment, name: file.name, size: file.size } : null
        })
      )
      const valid = results.filter((r): r is NonNullable<typeof r> => r !== null)
      if (valid.length > 0) {
        const composerImages: ComposerImageAttachment[] = valid.map(({ attachment, name, size }) =>
          imageAttachmentToComposer(attachment, name, size)
        )
        setAttachments((prev) => [...prev, ...composerImages])
      }
    } finally {
      setPendingImageReads((prev) => Math.max(0, prev - files.length))
    }
  }, [])

  const addFiles = React.useCallback(
    (filePaths: string[], isDirectory?: boolean) => {
      const newFiles: ComposerFileAttachment[] = []
      for (const filePath of filePaths) {
        const created = createComposerFileAttachment(filePath, workingFolder, isDirectory)
        if (created) {
          newFiles.push(created)
        }
      }
      if (newFiles.length === 0) return

      setAttachments((prev) => {
        const existingSendPaths = new Set(
          prev
            .filter((a): a is ComposerFileAttachment => a.type === 'file')
            .map((a) => normalizePathKey(a.sendPath))
        )
        const unique = newFiles.filter(
          (f) => !existingSendPaths.has(normalizePathKey(f.sendPath))
        )
        if (unique.length === 0) return prev
        return [...prev, ...unique]
      })
    },
    [workingFolder]
  )

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const readImagePathAsAttachment = React.useCallback(
    async (filePath: string): Promise<ImageAttachment | null> => {
      const mediaType = getImageMediaTypeForPath(filePath)
      if (!mediaType) return null

      const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_READ_FILE_BINARY, {
        path: filePath
      })) as {
        data?: string
        error?: string
      }
      if (result.error || !result.data) {
        log.warn('Failed to read selected image:', result.error ?? filePath)
        return null
      }

      return {
        id: createImageAttachmentId(),
        dataUrl: `data:${mediaType};base64,${result.data}`,
        mediaType
      }
    },
    []
  )

  const getPastedImageFiles = React.useCallback(
    (clipboardData: DataTransfer | null | undefined): File[] => {
      if (!supportsVision || !clipboardData) return []
      return Array.from(clipboardData.items)
        .filter((item) => item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type))
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[]
    },
    [supportsVision]
  )

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      const imageFiles = getPastedImageFiles(e.clipboardData)
      if (imageFiles.length > 0) {
        e.preventDefault()
        void addImages(imageFiles)
      }
      // Text paste goes through native textarea behavior — no need to intercept
    },
    [addImages, getPastedImageFiles]
  )

  const handleDropFiles = React.useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      const fileArr = Array.from(fileList)
      const imageFiles = supportsVision
        ? fileArr.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type))
        : []
      const otherFiles = supportsVision
        ? fileArr.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type))
        : fileArr

      if (imageFiles.length > 0) {
        void addImages(imageFiles)
      }

      const paths = otherFiles
        .map((f) => (f as File & { path?: string }).path)
        .filter((filePath): filePath is string => Boolean(filePath))

      if (paths.length > 0) {
        addFiles(paths)
      }
    },
    [addFiles, addImages, supportsVision]
  )

  return {
    attachments,
    pendingImageReads,
    addImages,
    addFiles,
    removeAttachment,
    readImagePathAsAttachment,
    handlePaste,
    handleDropFiles,
    getPastedImageFiles,
    getImageMediaTypeForPath,
    setAttachments,
    setPendingImageReads
  }
}
