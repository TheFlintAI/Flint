import * as React from 'react'
import { useState as useLocalState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, FileUp, FolderOpen, Sparkles, X } from 'lucide-react'
import { useProviderStore, modelSupportsVision } from '@/stores/provider-store'
import { useUIStore } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import {
  useInputDraftStore
} from '@/stores/input-draft-store'
import { useSkillsStore } from '@/stores/skills-store'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import {
  ACCEPTED_IMAGE_TYPES,
  cloneImageAttachments,
  fileToImageAttachment,
  hasEditableDraftContent,
  type EditableUserMessageDraft,
  type ImageAttachment
} from '@/lib/chat/image-attachments'
import {
  selectFileTextToPlainText
} from '@/lib/chat/select-file-tags'
import {
  deserializeEditorState,
  documentHasFileReferences,
  editorDocumentToPlainText,
  mergeSelectedFiles,
  removeReferenceNode,
  replaceEditorRange,
  serializeEditorDocument,
  type EditorDocumentNode,
  type SelectedFileItem
} from '@/lib/chat/select-file-editor'
import { ComposerActionsMenu } from './ComposerActionsMenu'
import { FileAwareEditor, type FileAwareEditorHandle } from './FileAwareEditor'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

import {
  clearPendingTaskMessages,
  dispatchNextQueuedMessageForTask,
  getPendingTaskMessages,
  isPendingTaskDispatchPaused,
  removePendingTaskMessage,
  subscribePendingTaskMessages,
  updatePendingTaskMessageDraft,
  type SendMessageOptions,
  type PendingTaskMessageItem
} from '@/hooks/use-chat-actions'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import type { SkillInfo } from '@/lib/resources/resource-manager'

import { QueuedMessagesPanel, areQueuedMessagesEqual } from './input/QueuedMessagesPanel'
import { ImageAttachmentStrip } from './input/ImageAttachmentStrip'
import { ComposerToolbar } from './input/ComposerToolbar'
import { setUserMessageFlyInOrigin } from './message-list/user-message-fly-in'
import { useComposerDraft } from '@/hooks/use-composer-draft'
import { useComposerImages } from '@/hooks/use-composer-images'

const log = createLogger('InputArea')

const EMPTY_QUEUED_MESSAGES: PendingTaskMessageItem[] = []
const INTERNAL_FILE_DRAG_MIME = 'application/x-flint-file-paths'
const _MIN_INPUT_HEIGHT = 120
const DEFAULT_TASK_INPUT_HEIGHT = 160

interface InputAreaProps {
  taskId?: string | null
  onSend: (text: string, images?: ImageAttachment[], options?: SendMessageOptions) => void
  onStop?: () => void
  isStreaming?: boolean
  workingFolder?: string
  disabled?: boolean
  draftKeyOverride?: string | null
  suppressPendingQueue?: boolean
}

export function InputArea({
  taskId,
  onSend,
  onStop,
  isStreaming = false,
  workingFolder,
  disabled = false,
  draftKeyOverride,
  suppressPendingQueue = false
}: InputAreaProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [documentNodes, setDocumentNodes] = React.useState<EditorDocumentNode[]>([])
  const [selectedFiles, setSelectedFiles] = React.useState<SelectedFileItem[]>([])
  const [highlightedFileId, setHighlightedFileId] = React.useState<string | null>(null)
  const [editorSelection, setEditorSelection] = React.useState({ start: 0, end: 0 })
  const text = React.useMemo(
    () => editorDocumentToPlainText(documentNodes, selectedFiles),
    [documentNodes, selectedFiles]
  )
  const finalSerializedText = React.useMemo(
    () => serializeEditorDocument(documentNodes, selectedFiles),
    [documentNodes, selectedFiles]
  )
  const skills = useSkillsStore(
    useShallow((s) => s.skills.filter((sk) => sk.enabled !== false))
  )
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const [workspaceSkills, setWorkspaceSkills] = React.useState<SkillInfo[]>([])
  const [skillsPopoverOpen, setSkillsPopoverOpen] = React.useState(false)
  const [queuePreviewImage, setQueuePreviewImage] = React.useState<ImageAttachment | null>(null)
  const editorRef = React.useRef<FileAwareEditorHandle | null>(null)
  const queueFileInputRef = React.useRef<HTMLInputElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const bottomToolbarRef = React.useRef<HTMLDivElement>(null)
  const textRef = React.useRef(text)
  const documentRef = React.useRef(documentNodes)
  const selectedFilesRef = React.useRef(selectedFiles)
  const activeProvider = useProviderStore(
    useShallow((s) => {
      const { providers, activeProviderId, activeModelId } = s
      if (!activeProviderId) return null
      const p = providers.find((p) => p.id === activeProviderId)
      if (!p) return null
      return {
        apiKey: p.apiKey,
        requiresApiKey: p.requiresApiKey,
        type: p.type,
        models: p.models,
        modelId: activeModelId
      }
    })
  )
  const supportsVision = React.useMemo(() => {
    if (!activeProvider) return false
    const model = activeProvider.models.find((m) => m.id === activeProvider.modelId)
    return modelSupportsVision(model, activeProvider.type)
  }, [activeProvider])
  const openSettingsPage = useUIStore((s) => s.openSettingsPage)
  const showInlineClear = false
  const { activeTaskId, hasMessages, clearTaskMessages } = useChatStore(
    useShallow((s) => {
      const targetTaskId = taskId ?? s.activeTaskId
      const idx = targetTaskId ? s.tasksById[targetTaskId] : undefined
      const targetTask = idx !== undefined ? s.tasks[idx] : undefined
      return {
        activeTaskId: targetTaskId,
        hasMessages: (targetTask?.messageCount ?? 0) > 0,
        clearTaskMessages: s.clearTaskMessages
      }
    })
  )
  const workspaceDisplayName = workingFolder?.split(/[\\/]/).pop() || workingFolder
  const inputDraftHydrated = useInputDraftStore((s) => s.hydrated)
  const removePersistedDraft = useInputDraftStore((s) => s.removeDraft)

  // Draft persistence
  const {
    activeDraftKey,
    persistedDraft,
    draftReadyKeyRef,
    saveDraft
  } = useComposerDraft({
    taskId,
    draftKeyOverride,
    inputDraftHydrated
  })

  const replaceSelectionWithText = React.useCallback(
    (
      replacement: string,
      selection: { start: number; end: number } = editorSelection,
      cursorOffset = 0,
      nextSelectedFiles?: SelectedFileItem[]
    ) => {
      const replacementState = deserializeEditorState(
        replacement,
        workingFolder,
        nextSelectedFiles ?? selectedFilesRef.current
      )
      const candidateFiles = mergeSelectedFiles(
        nextSelectedFiles ?? selectedFilesRef.current,
        replacementState.selectedFiles
      )
      const nextDocument = replaceEditorRange(
        documentRef.current,
        selectedFilesRef.current,
        selection.start,
        selection.end,
        replacementState.document
      )
      const referencedFileIds = new Set(
        nextDocument
          .filter(
            (node): node is Extract<EditorDocumentNode, { type: 'file' }> => node.type === 'file'
          )
          .map((node) => node.fileId)
      )
      const nextFiles = candidateFiles.filter((file) => referencedFileIds.has(file.id))
      const nextCursor =
        selection.start +
        editorDocumentToPlainText(replacementState.document, candidateFiles).length +
        cursorOffset

      setDocumentNodes(nextDocument)
      setSelectedFiles(nextFiles)
      requestAnimationFrame(() => {
        editorRef.current?.focus()
        editorRef.current?.setSelectionOffsets(nextCursor, nextCursor)
        setEditorSelection({ start: nextCursor, end: nextCursor })
      })
    },
    [editorSelection, workingFolder]
  )

  // Image handling
  const {
    attachedImages,
    pendingImageReads,
    removeImage,
    readImagePathAsAttachment,
    addFilesToEditor,
    handlePaste,
    handleDropFiles,
    getPastedImageFiles,
    getImageMediaTypeForPath,
    setAttachedImages,
    setPendingImageReads
  } = useComposerImages({
    supportsVision,
    workingFolder,
    editorSelection,
    selectedFilesRef,
    replaceSelectionWithText
  })

  // Queued messages
  const queuedMessagesSnapshotRef = React.useRef<PendingTaskMessageItem[]>(EMPTY_QUEUED_MESSAGES)
  const getQueuedMessagesSnapshot = React.useCallback(() => {
    if (suppressPendingQueue) return EMPTY_QUEUED_MESSAGES
    const next = activeTaskId ? getPendingTaskMessages(activeTaskId) : EMPTY_QUEUED_MESSAGES
    const prev = queuedMessagesSnapshotRef.current
    if (prev !== next && areQueuedMessagesEqual(prev, next)) {
      return prev
    }
    queuedMessagesSnapshotRef.current = next
    return next
  }, [activeTaskId, suppressPendingQueue])
  const queuedMessages = React.useSyncExternalStore(
    subscribePendingTaskMessages,
    getQueuedMessagesSnapshot,
    () => EMPTY_QUEUED_MESSAGES
  )
  const isQueueDispatchPaused = React.useSyncExternalStore(
    subscribePendingTaskMessages,
    () =>
      !suppressPendingQueue && activeTaskId ? isPendingTaskDispatchPaused(activeTaskId) : false,
    () => false
  )
  const [editingQueueItemId, setEditingQueueItemId] = React.useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = React.useState('')
  const [editingQueueImages, setEditingQueueImages] = React.useState<ImageAttachment[]>([])
  const [queueClearConfirmOpen, setQueueClearConfirmOpen] = React.useState(false)

  const startEditQueuedMessage = React.useCallback((msg: PendingTaskMessageItem) => {
    setEditingQueueItemId(msg.id)
    setEditingQueueText(msg.text)
    setEditingQueueImages(cloneImageAttachments(msg.images))
  }, [])

  const cancelEditQueuedMessage = React.useCallback(() => {
    setEditingQueueItemId(null)
    setEditingQueueText('')
    setEditingQueueImages([])
  }, [])

  const removeQueuedMessage = React.useCallback(
    (id: string) => {
      if (!activeTaskId) return
      removePendingTaskMessage(activeTaskId, id)
      if (editingQueueItemId === id) {
        setEditingQueueItemId(null)
        setEditingQueueText('')
        setEditingQueueImages([])
      }
    },
    [activeTaskId, editingQueueItemId]
  )

  const addQueuedImages = React.useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(fileToImageAttachment))
    const valid = results.filter(Boolean) as ImageAttachment[]
    if (valid.length > 0) {
      setEditingQueueImages((prev) => [...prev, ...valid])
    }
  }, [])

  const removeQueuedImage = React.useCallback((id: string) => {
    setEditingQueueImages((prev) => prev.filter((img) => img.id !== id))
    setQueuePreviewImage((current) => (current?.id === id ? null : current))
  }, [])

  const saveQueuedMessage = React.useCallback(
    (id: string) => {
      if (!activeTaskId) return
      const targetMessage = queuedMessages.find((msg) => msg.id === id)
      if (!targetMessage) return

      const nextDraft: EditableUserMessageDraft = {
        text: editingQueueText.trim(),
        images: cloneImageAttachments(editingQueueImages),
        command: null
      }

      if (!hasEditableDraftContent(nextDraft)) {
        removePendingTaskMessage(activeTaskId, id)
        setEditingQueueItemId(null)
        setEditingQueueText('')
        setEditingQueueImages([])
        return
      }

      updatePendingTaskMessageDraft(activeTaskId, id, nextDraft)
      setEditingQueueItemId(null)
      setEditingQueueText('')
      setEditingQueueImages([])
    },
    [activeTaskId, queuedMessages, editingQueueText, editingQueueImages]
  )

  const clearQueuedMessagesForActiveTask = React.useCallback(() => {
    if (!activeTaskId) return
    const cleared = clearPendingTaskMessages(activeTaskId)
    if (cleared === 0) return
    setQueueClearConfirmOpen(false)
    cancelEditQueuedMessage()
    toast.success(t('input.queueCleared', { defaultValue: 'Queued messages cleared' }))
  }, [activeTaskId, cancelEditQueuedMessage, t])

  const handleClearQueuedMessages = React.useCallback(() => {
    if (queuedMessages.length <= 1) {
      clearQueuedMessagesForActiveTask()
      return
    }
    setQueueClearConfirmOpen(true)
  }, [clearQueuedMessagesForActiveTask, queuedMessages.length])

  const resumeQueuedMessages = React.useCallback(() => {
    if (!activeTaskId) return
    dispatchNextQueuedMessageForTask(activeTaskId)
  }, [activeTaskId])

  const handleQueueEditPaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      const imageFiles = getPastedImageFiles(e.clipboardData)
      if (imageFiles.length === 0) return
      e.preventDefault()
      void addQueuedImages(imageFiles)
    },
    [addQueuedImages, getPastedImageFiles]
  )

  // Editor helpers

  React.useEffect(() => {
    textRef.current = text
  }, [text])
  React.useEffect(() => {
    documentRef.current = documentNodes
  }, [documentNodes])
  React.useEffect(() => {
    selectedFilesRef.current = selectedFiles
  }, [selectedFiles])

  React.useEffect(() => {
    if (!highlightedFileId) return
    const timer = window.setTimeout(() => {
      setHighlightedFileId((current) => (current === highlightedFileId ? null : current))
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [highlightedFileId])

  const applyEditorStateFromSerializedText = React.useCallback(
    (nextText: string, baseFiles: SelectedFileItem[] = selectedFilesRef.current) => {
      const nextState = deserializeEditorState(nextText, workingFolder, baseFiles)
      setDocumentNodes(nextState.document)
      setSelectedFiles(nextState.selectedFiles)
    },
    [workingFolder]
  )

  const hasApiKey = !!activeProvider?.apiKey || activeProvider?.requiresApiKey === false
  const needsWorkingFolder = false

  React.useEffect(() => {
    setEditingQueueItemId(null)
    setEditingQueueText('')
    setEditingQueueImages([])
    setQueueClearConfirmOpen(false)
  }, [activeTaskId])

  React.useEffect(() => {
    if (!editingQueueItemId) return
    if (queuedMessages.some((msg) => msg.id === editingQueueItemId)) return
    setEditingQueueItemId(null)
    setEditingQueueText('')
    setEditingQueueImages([])
  }, [queuedMessages, editingQueueItemId])

  React.useEffect(() => {
    if (!isStreaming) {
      cancelEditQueuedMessage()
    }
  }, [isStreaming, cancelEditQueuedMessage])

  React.useEffect(() => {
    if (queuedMessages.length > 0) return
    setQueueClearConfirmOpen(false)
  }, [queuedMessages.length])

  // Draft hydration
  React.useEffect(() => {
    if (!inputDraftHydrated) return

    const persistedText = persistedDraft?.text ?? ''
    const persistedSelectedFiles = persistedDraft?.selectedFiles ?? []

    draftReadyKeyRef.current = null
    applyEditorStateFromSerializedText(
      persistedText,
      persistedSelectedFiles
    )
    setAttachedImages([])
    setQueuePreviewImage(null)
    setHighlightedFileId(null)
    setEditorSelection({ start: 0, end: 0 })

    const rafId = window.requestAnimationFrame(() => {
      draftReadyKeyRef.current = activeDraftKey
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [
    activeDraftKey,
    applyEditorStateFromSerializedText,
    inputDraftHydrated,
    persistedDraft,
    workingFolder
  ])

  // Eagerly load skills
  React.useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // Load workspace skills when workingFolder changes
  React.useEffect(() => {
    if (!workingFolder) {
      setWorkspaceSkills([])
      return
    }
    let cancelled = false
    tauriCommands
      .invoke<SkillInfo[]>(TAURI_COMMANDS.SKILLS_SCAN_WORKSPACE, workingFolder)
      .then((result) => {
        if (!cancelled) setWorkspaceSkills(Array.isArray(result) ? result : [])
      })
      .catch(() => {
        if (!cancelled) setWorkspaceSkills([])
      })
    return () => { cancelled = true }
  }, [workingFolder])

  // Draft persistence
  React.useEffect(() => {
    saveDraft({
      serializedText: finalSerializedText,
      selectedFiles
    })
  }, [saveDraft, finalSerializedText, selectedFiles])

  // Auto-focus when draft is ready
  React.useEffect(() => {
    if (isStreaming || disabled || !inputDraftHydrated) return

    const rafId = window.requestAnimationFrame(() => {
      if (activeDraftKey && draftReadyKeyRef.current !== activeDraftKey) return

      const activeElement = document.activeElement
      if (
        activeElement &&
        activeElement !== document.body &&
        !rootRef.current?.contains(activeElement)
      ) {
        return
      }

      editorRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeDraftKey, disabled, inputDraftHydrated, isStreaming])

  // Consume pendingInsertText from FileTree clicks
  const pendingInsert = useUIStore((s) => s.pendingInsertText)
  React.useEffect(() => {
    if (!pendingInsert) return

    const selection = editorRef.current?.getSelectionOffsets() ?? {
      start: text.length,
      end: text.length
    }
    const pendingPlainText = selectFileTextToPlainText(pendingInsert)
    const needsPrefix =
      selection.start === selection.end &&
      selection.start > 0 &&
      !/\s$/.test(text.slice(0, selection.start)) &&
      pendingPlainText.length > 0 &&
      !/^\s/.test(pendingPlainText)

    replaceSelectionWithText(`${needsPrefix ? ' ' : ''}${pendingInsert}`, selection)
    useUIStore.getState().setPendingInsertText(null)
  }, [pendingInsert, replaceSelectionWithText, text])

  // Attach media handler (uses t() for i18n)
  const handleAttachMedia = React.useCallback(async (): Promise<void> => {
    try {
      const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_SELECT_FILE, {
        multiSelections: true,
        filters: [
          {
            name: t('input.mediaFilter'),
            extensions: [
              'png',
              'jpg',
              'jpeg',
              'gif',
              'webp',
              'md',
              'txt',
              'docx',
              'pdf',
              'html',
              'csv',
              'json',
              'xml',
              'yaml',
              'yml',
              'ts',
              'js',
              'tsx',
              'jsx'
            ]
          },
          { name: t('input.allFilesFilter'), extensions: ['*'] }
        ]
      })) as { canceled?: boolean; path?: string; paths?: string[] }

      const paths = Array.from(
        new Set(
          (Array.isArray(result.paths) && result.paths.length > 0
            ? result.paths
            : result.path
              ? [result.path]
              : []
          ).filter((filePath): filePath is string => Boolean(filePath))
        )
      )
      if (result.canceled || paths.length === 0) return

      const imagePaths = supportsVision
        ? paths.filter((filePath) => Boolean(getImageMediaTypeForPath(filePath)))
        : []
      const filePaths = paths.filter((filePath) => !imagePaths.includes(filePath))
      const imageFallbackPaths: string[] = []

      if (imagePaths.length > 0) {
        setPendingImageReads((prev) => prev + imagePaths.length)
        try {
          const images = await Promise.all(
            imagePaths.map(async (filePath) => {
              const attachment = await readImagePathAsAttachment(filePath)
              if (!attachment) imageFallbackPaths.push(filePath)
              return attachment
            })
          )
          const validImages = images.filter((image): image is ImageAttachment => Boolean(image))
          if (validImages.length > 0) {
            setAttachedImages((prev) => [...prev, ...validImages])
          }
        } finally {
          setPendingImageReads((prev) => Math.max(0, prev - imagePaths.length))
        }
      }

      const pathsForFileReferences = [...filePaths, ...imageFallbackPaths]
      if (pathsForFileReferences.length > 0) {
        addFilesToEditor(pathsForFileReferences)
      }
    } catch (error) {
      log.error('Failed to attach media:', error)
      toast.error(t('input.attachMediaFailed'))
    }
  }, [addFilesToEditor, readImagePathAsAttachment, getImageMediaTypeForPath, supportsVision, t])

  const handleSelectWorkspace = React.useCallback(async (): Promise<void> => {
    try {
      const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_SELECT_FOLDER, {})) as {
        canceled?: boolean
        path?: string
      }
      if (result.canceled || !result.path || !activeTaskId) return
      useChatStore.getState().setWorkingFolder(activeTaskId, result.path)
      editorRef.current?.focus()
    } catch (error) {
      log.error('Failed to select workspace:', error)
    }
  }, [activeTaskId])

  const handleLocateFileReference = React.useCallback((fileId: string) => {
    setHighlightedFileId(fileId)
    editorRef.current?.scrollToReference(fileId)
    editorRef.current?.focus()
  }, [])

  const handleEditorSelectionChange = React.useCallback(
    (selection: { start: number; end: number }) => {
      setEditorSelection((current) =>
        current.start === selection.start && current.end === selection.end ? current : selection
      )
    },
    []
  )

  const handleRemoveFileReference = React.useCallback((nodeId: string) => {
    const currentDocument = documentRef.current
    const targetNode = currentDocument.find(
      (node): node is Extract<EditorDocumentNode, { type: 'file' }> =>
        node.type === 'file' && node.id === nodeId
    )
    if (!targetNode) return

    const nextDocument = removeReferenceNode(currentDocument, nodeId, selectedFilesRef.current)
    const hasRemainingReferences = documentHasFileReferences(nextDocument, targetNode.fileId)
    const nextFiles = hasRemainingReferences
      ? selectedFilesRef.current
      : selectedFilesRef.current.filter((file) => file.id !== targetNode.fileId)

    setDocumentNodes(nextDocument)
    setSelectedFiles(nextFiles)
  }, [])

  const handleEditorDocumentChange = React.useCallback((nextDocument: EditorDocumentNode[]) => {
    const referencedFileIds = new Set(
      nextDocument
        .filter(
          (node): node is Extract<EditorDocumentNode, { type: 'file' }> => node.type === 'file'
        )
        .map((node) => node.fileId)
    )
    setDocumentNodes(nextDocument)
    setSelectedFiles((currentFiles) =>
      currentFiles.filter((file) => referencedFileIds.has(file.id))
    )
  }, [])

  const getLiveEditorState = React.useCallback(() => {
    const liveDocument = editorRef.current?.getDocumentSnapshot() ?? documentRef.current
    const referencedFileIds = new Set(
      liveDocument
        .filter(
          (node): node is Extract<EditorDocumentNode, { type: 'file' }> => node.type === 'file'
        )
        .map((node) => node.fileId)
    )
    const liveSelectedFiles = selectedFilesRef.current.filter((file) =>
      referencedFileIds.has(file.id)
    )

    return {
      plainText: editorDocumentToPlainText(liveDocument, liveSelectedFiles),
      serializedText: serializeEditorDocument(liveDocument, liveSelectedFiles)
    }
  }, [])

  const resetComposer = React.useCallback((): void => {
    if (activeDraftKey) {
      removePersistedDraft(activeDraftKey)
    }

    setDocumentNodes([])
    setSelectedFiles([])
    setHighlightedFileId(null)
    setEditorSelection({ start: 0, end: 0 })
    setAttachedImages([])
    requestAnimationFrame(() => {
      editorRef.current?.setSelectionOffsets(0, 0)
    })
  }, [activeDraftKey, removePersistedDraft])

  const handleSend = React.useCallback((): void => {
    const liveEditorState = getLiveEditorState()
    const serialized = liveEditorState.serializedText.trim()
    if (!serialized && attachedImages.length === 0) return
    if (disabled || needsWorkingFolder || pendingImageReads > 0) return

    const composerEl = containerRef.current
    if (composerEl && taskId) {
      const rect = composerEl.getBoundingClientRect()
      setUserMessageFlyInOrigin(taskId, {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      })
    }

    onSend(serialized, attachedImages.length > 0 ? attachedImages : undefined, {
      clearCompletedTasksOnTurnStart: true,
      ...(selectedFiles.length > 0 ? { fileCount: selectedFiles.length } : {})
    })

    resetComposer()
  }, [
    getLiveEditorState,
    attachedImages,
    disabled,
    needsWorkingFolder,
    pendingImageReads,
    selectedFiles,
    onSend,
    resetComposer,
    taskId
  ])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.nativeEvent.isComposing) return

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const getDraggedFilePaths = React.useCallback((dataTransfer: DataTransfer | null): string[] => {
    if (!dataTransfer) return []
    const payload = dataTransfer.getData(INTERNAL_FILE_DRAG_MIME)
    if (!payload) return []

    try {
      const parsed = JSON.parse(payload)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
    } catch {
      return []
    }
  }, [])

  const [dragging, setDragging] = useLocalState(false)

  const handleDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      const transfer = e.dataTransfer
      const types = Array.from(transfer?.types ?? [])
      const canHandle = types.includes('Files') || types.includes(INTERNAL_FILE_DRAG_MIME)
      if (!canHandle) return
      e.preventDefault()
      if (transfer) {
        transfer.dropEffect = 'copy'
      }
      setDragging(true)
    },
    [setDragging]
  )

  const handleDragLeave = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      const nextTarget = e.relatedTarget as Node | null
      if (nextTarget && e.currentTarget.contains(nextTarget)) return
      setDragging(false)
    },
    [setDragging]
  )

  const handleDropWrapped = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      const draggedPaths = getDraggedFilePaths(e.dataTransfer)
      const hasNativeFiles = (e.dataTransfer?.files?.length ?? 0) > 0
      if (draggedPaths.length === 0 && !hasNativeFiles) return
      e.preventDefault()
      setDragging(false)
      if (draggedPaths.length > 0) {
        addFilesToEditor(draggedPaths)
        return
      }
      handleDropFiles(e.dataTransfer?.files ?? null)
    },
    [addFilesToEditor, getDraggedFilePaths, handleDropFiles, setDragging]
  )

  const composerActionsControl = (
    <ComposerActionsMenu
      onAttachMedia={() => void handleAttachMedia()}
      disabled={disabled || isStreaming}
      triggerClassName="rounded-full"
      menuClassName="composer-flyout"
      workingFolder={workingFolder}
      onSelectWorkspace={() => void handleSelectWorkspace()}
    />
  )

  // Merge global + workspace skills (workspace overrides global by name)
  const mergedSkills = React.useMemo(() => {
    const wsNames = new Set(workspaceSkills.map((s) => s.name))
    const globalFiltered = skills.filter((s) => !wsNames.has(s.name))
    return [...workspaceSkills, ...globalFiltered]
  }, [skills, workspaceSkills])

  // Task-level context badges (skill count, workspace) shown after the + button
  const contextBadges = (
    <div className="flex items-center gap-1">
      {mergedSkills.length > 0 && (
        <Popover open={skillsPopoverOpen} onOpenChange={setSkillsPopoverOpen}>
          <PopoverTrigger asChild>
            <div
              onMouseEnter={() => setSkillsPopoverOpen(true)}
              onMouseLeave={() => setSkillsPopoverOpen(false)}
            >
              <Badge variant="outline" className="h-8 gap-1 px-2.5 cursor-default">
                <Sparkles className="size-3 shrink-0" />
                <span>{t('input.skillsBadge.skillsCount', { count: mergedSkills.length })}</span>
              </Badge>
            </div>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-48 p-0"
            onMouseEnter={() => setSkillsPopoverOpen(true)}
            onMouseLeave={() => setSkillsPopoverOpen(false)}
          >
            <div className="py-1.5">
              <div className="max-h-48 overflow-y-auto">
                {mergedSkills.map((sk) => (
                  <div
                    key={sk.name}
                    className="px-3 py-1.5 text-[13px] text-foreground leading-tight truncate"
                    title={sk.name}
                  >
                    {sk.name}
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {workspaceDisplayName && (
        <Badge variant="outline" className="h-8 gap-1 px-2.5">
          <FolderOpen className="size-3 shrink-0" />
          <span className="max-w-[100px] truncate">{workspaceDisplayName}</span>
          <button
            type="button"
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => {
              if (!activeTaskId) return
              useChatStore.getState().setWorkingFolder(activeTaskId, '')
            }}
            aria-label={t('input.contextBar.clearWorkspace', { defaultValue: 'Clear workspace' })}
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      )}
    </div>
  )

  // Queued messages editing state
  const editingQueueState = {
    editingQueueItemId,
    editingQueueText,
    editingQueueImages,
    queueClearConfirmOpen,
    startEdit: startEditQueuedMessage,
    cancelEdit: cancelEditQueuedMessage,
    save: saveQueuedMessage,
    removeImage: removeQueuedImage,
    addImages: addQueuedImages,
    setText: setEditingQueueText,
    setQueueClearConfirmOpen,
    onPaste: handleQueueEditPaste
  }

  // Render
  return (
    <div ref={rootRef} className="px-4 py-3 pb-4">
      {/* API key warning */}
      {!hasApiKey && (
        <div className="mx-auto w-full max-w-[820px]">
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-2 rounded-[18px] border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-left text-xs text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/10"
            onClick={() => openSettingsPage('provider')}
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>{t('input.noApiKey')}</span>
          </button>
        </div>
      )}

      <QueuedMessagesPanel
        activeTaskId={activeTaskId ?? null}
        queuedMessages={queuedMessages}
        isQueueDispatchPaused={isQueueDispatchPaused}
        editing={editingQueueState}
        supportsVision={supportsVision}
        queueFileInputRef={queueFileInputRef}
        onResumeQueuedMessages={resumeQueuedMessages}
        onClearQueuedMessages={handleClearQueuedMessages}
        onClearQueuedMessagesConfirm={clearQueuedMessagesForActiveTask}
        onRemoveQueuedMessage={removeQueuedMessage}
        onPreviewImage={setQueuePreviewImage}
      />

      <div className="mx-auto w-full max-w-[820px]">
        <div
          ref={containerRef}
          className={cn(
            'relative flex flex-col rounded-[18px] border border-input bg-transparent shadow-xs transition-[box-shadow,border-color] duration-200 overflow-hidden',
            'focus-within:border-ring/40 focus-within:ring-1 focus-within:ring-ring/15',
            dragging && 'ring-2 ring-primary/50'
          )}
          data-composer-variant="task"
          style={{ height: DEFAULT_TASK_INPUT_HEIGHT }}
        >
          {/* Image preview strip */}
          <ImageAttachmentStrip
            images={attachedImages}
            onRemove={removeImage}
          />

          {/* Text input area */}
          <div
            className="relative flex min-h-0 flex-1 flex-col px-3 pt-3"
            onDrop={handleDropWrapped}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {dragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-accent/70 pointer-events-none">
                <span className="flex items-center gap-1.5 text-xs text-primary/70 font-medium">
                  <FileUp className="size-3.5" />
                  {supportsVision ? t('input.dropImages') : t('input.dropFiles')}
                </span>
              </div>
            )}
            <div className="relative flex-1 min-h-0 overflow-visible">
              <FileAwareEditor
                ref={editorRef}
                document={documentNodes}
                files={selectedFiles}
                disabled={disabled}
                placeholder={undefined}
                highlightedFileId={highlightedFileId}
                onDocumentChange={handleEditorDocumentChange}
                onSelectionChange={handleEditorSelectionChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onReferenceLocate={handleLocateFileReference}
                onReferenceDelete={handleRemoveFileReference}
                className="h-full w-full"
              />
            </div>
          </div>

          {/* Hidden file input for queue image upload */}
          <input
            ref={queueFileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                void addQueuedImages(Array.from(e.target.files))
              }
              e.target.value = ''
            }}
          />

          {/* Bottom toolbar */}
          <ComposerToolbar
            isStreaming={isStreaming}
            isDisabled={
              (!finalSerializedText.trim() && attachedImages.length === 0) ||
              disabled ||
              needsWorkingFolder ||
              pendingImageReads > 0
            }
            canSend={!!finalSerializedText.trim() || attachedImages.length > 0}
            hasMessages={hasMessages}
            showClearButton={showInlineClear}
            queuedMessagesCount={queuedMessages.length}
            composerActionsControl={composerActionsControl}
            contextBadges={contextBadges}
            onStop={onStop}
            onSend={handleSend}
            onClearConfirm={() => {
              if (!activeTaskId) return
              clearTaskMessages(activeTaskId)
              clearPendingTaskMessages(activeTaskId)
            }}
            bottomToolbarRef={bottomToolbarRef}
          />
        </div>
      </div>
    </div>
  )
}
