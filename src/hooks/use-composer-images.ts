import * as React from 'react'
import {
  ACCEPTED_IMAGE_TYPES,
  fileToImageAttachment,
  type ImageAttachment
} from '@/lib/chat/image-attachments'
import {
  createSelectFileToken,
} from '@/lib/chat/select-file-tags'
import { ensureSelectedFile, type SelectedFileItem } from '@/lib/chat/select-file-editor'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { createLogger } from '@/lib/logger'

const log = createLogger('useComposerImages')

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

export interface UseComposerImagesOptions {
  supportsVision: boolean
  workingFolder: string | undefined
  editorSelection: { start: number; end: number }
  selectedFilesRef: React.MutableRefObject<SelectedFileItem[]>
  replaceSelectionWithText: (
    replacement: string,
    selection: { start: number; end: number },
    cursorOffset?: number,
    nextSelectedFiles?: SelectedFileItem[]
  ) => void
}

export interface UseComposerImagesResult {
  attachedImages: ImageAttachment[]
  pendingImageReads: number
  addImages: (files: File[]) => Promise<void>
  removeImage: (id: string) => void
  readImagePathAsAttachment: (filePath: string) => Promise<ImageAttachment | null>
  addFilesToEditor: (filePaths: string[], selection?: { start: number; end: number }) => void
  handlePaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
  handleDropFiles: (fileList: FileList | null) => void
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  getPastedImageFiles: (clipboardData: DataTransfer | null | undefined) => File[]
  getImageMediaTypeForPath: (filePath: string) => string | null
  setAttachedImages: React.Dispatch<React.SetStateAction<ImageAttachment[]>>
  setPendingImageReads: React.Dispatch<React.SetStateAction<number>>
  imagePreviewRef: React.RefObject<HTMLDivElement | null>
}

export function useComposerImages({
  supportsVision,
  workingFolder,
  editorSelection,
  selectedFilesRef,
  replaceSelectionWithText
}: UseComposerImagesOptions): UseComposerImagesResult {
  const [attachedImages, setAttachedImages] = React.useState<ImageAttachment[]>([])
  const [pendingImageReads, setPendingImageReads] = React.useState(0)
  const imagePreviewRef = React.useRef<HTMLDivElement>(null)

  const addImages = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return

    setPendingImageReads((prev) => prev + files.length)
    try {
      const results = await Promise.all(files.map(fileToImageAttachment))
      const valid = results.filter(Boolean) as ImageAttachment[]
      if (valid.length > 0) {
        setAttachedImages((prev) => [...prev, ...valid])
      }
    } finally {
      setPendingImageReads((prev) => Math.max(0, prev - files.length))
    }
  }, [])

  const removeImage = React.useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id))
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

  const addFilesToEditor = React.useCallback(
    (filePaths: string[], selection?: { start: number; end: number }) => {
      const nextSelection = selection ?? editorSelection

      const filesToInsert: SelectedFileItem[] = []
      let mergedFiles = selectedFilesRef.current

      for (const filePath of filePaths) {
        const ensured = ensureSelectedFile(mergedFiles, filePath, workingFolder)
        mergedFiles = ensured.files
        if (ensured.file) {
          filesToInsert.push(ensured.file)
        }
      }

      if (filesToInsert.length === 0) return

      const replacement = filesToInsert
        .map((file) => createSelectFileToken(file.sendPath))
        .filter(Boolean)
        .join('\n')

      replaceSelectionWithText(replacement, nextSelection, 0, mergedFiles)
    },
    [editorSelection.end, editorSelection.start, replaceSelectionWithText, workingFolder, selectedFilesRef]
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
    (e: React.ClipboardEvent<HTMLDivElement>): void => {
      const imageFiles = getPastedImageFiles(e.clipboardData)

      if (imageFiles.length > 0) {
        e.preventDefault()
        void addImages(imageFiles)
        return
      }

      const plainText = e.clipboardData.getData('text/plain')
      if (!plainText) return

      e.preventDefault()
      replaceSelectionWithText(plainText, editorSelection)
    },
    [addImages, getPastedImageFiles, replaceSelectionWithText, editorSelection]
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
        addFilesToEditor(paths)
      }
    },
    [addFilesToEditor, addImages, supportsVision]
  )

  const handleFileInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        void addImages(Array.from(e.target.files))
      }
      e.target.value = ''
    },
    [addImages]
  )

  return {
    attachedImages,
    pendingImageReads,
    addImages,
    removeImage,
    readImagePathAsAttachment,
    addFilesToEditor,
    handlePaste,
    handleDropFiles,
    handleFileInputChange,
    getPastedImageFiles,
    getImageMediaTypeForPath,
    setAttachedImages,
    setPendingImageReads,
    imagePreviewRef
  }
}
