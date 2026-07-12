import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle, FileUp, Sparkles } from 'lucide-react'
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
  parseSelectFileText
} from '@/lib/chat/select-file-tags'
import type { SelectedFileItem } from '@/lib/chat/select-file-editor'
import { ComposerActionsMenu } from './ComposerActionsMenu'
import { WorkspaceFilePopover } from './WorkspaceFilePopover'
import { TextEditor, type TextEditorHandle } from './input/TextEditor'
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
import { ComposerAttachmentStrip } from './input/ComposerAttachmentStrip'
import { ComposerToolbar } from './input/ComposerToolbar'
import { setUserMessageFlyInOrigin } from './transcript/user-message-fly-in'
import { useComposerDraft } from '@/hooks/use-composer-draft'
import { useComposerAttachments } from '@/hooks/use-composer-attachments'
import {
  isImageAttachment,
  isFileAttachment,
  composerImageToImageAttachment,
  composerFileToSelectedFile,
  selectedFileToComposer,
  type ComposerAttachment,
  type ComposerFileAttachment
} from '@/lib/chat/composer-attachment'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

const log = createLogger('InputArea')

const EMPTY_QUEUED_MESSAGES: PendingTaskMessageItem[] = []
const MIN_INPUT_HEIGHT = 100

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

  // ---- Unified state ----
  const [text, setText] = React.useState('')
  const textRef = React.useRef(text)

  const textEditorRef = React.useRef<TextEditorHandle | null>(null)
  const queueFileInputRef = React.useRef<HTMLInputElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const bottomToolbarRef = React.useRef<HTMLDivElement>(null)

  const skills = useSkillsStore(
    useShallow((s) => s.skills.filter((sk) => sk.enabled !== false))
  )
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const [workspaceSkills, setWorkspaceSkills] = React.useState<SkillInfo[]>([])
  const [skillsPopoverOpen, setSkillsPopoverOpen] = React.useState(false)
  const [queuePreviewImage, setQueuePreviewImage] = React.useState<ImageAttachment | null>(null)

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
  const draftReadyKeyRef = React.useRef<string | null>(null)
  const {
    activeDraftKey,
    persistedDraft,
    saveDraft
  } = useComposerDraft({
    taskId,
    draftKeyOverride,
    inputDraftHydrated
  })

  // ---- Attachment handling ----
  const {
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
  } = useComposerAttachments({
    supportsVision,
    workingFolder
  })

  // Derived attachment lists
  const imageAttachments = React.useMemo(
    () => attachments.filter(isImageAttachment).map(composerImageToImageAttachment),
    [attachments]
  )
  const fileAttachments = React.useMemo(
    () => attachments.filter(isFileAttachment),
    [attachments]
  )

  // ---- Queued messages ----
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
        images: cloneImageAttachments(editingQueueImages)
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

  // ---- Refs sync ----
  React.useEffect(() => {
    textRef.current = text
  }, [text])

  const hasApiKey = !!activeProvider?.apiKey || activeProvider?.requiresApiKey === false
  const needsWorkingFolder = false

  // ---- Queued message lifecycle ----
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

  // ---- Draft hydration ----
  React.useEffect(() => {
    if (!inputDraftHydrated) return

    const persistedText = persistedDraft?.text ?? ''
    const persistedSelectedFiles: SelectedFileItem[] = persistedDraft?.selectedFiles ?? []

    draftReadyKeyRef.current = null
    setText(persistedText)
    setAttachments(persistedSelectedFiles.map(selectedFileToComposer))
    setQueuePreviewImage(null)

    const rafId = window.requestAnimationFrame(() => {
      draftReadyKeyRef.current = activeDraftKey
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [
    activeDraftKey,
    inputDraftHydrated,
    persistedDraft,
    workingFolder
  ])

  // ---- Eagerly load skills ----
  React.useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // ---- Load workspace skills when workingFolder changes ----
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

  // ---- Draft persistence ----
  React.useEffect(() => {
    const selectedFiles = fileAttachments.map(composerFileToSelectedFile)
    saveDraft({
      serializedText: text,
      selectedFiles
    })
  }, [saveDraft, text, fileAttachments])

  // ---- Auto-focus when draft is ready ----
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

      textEditorRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeDraftKey, disabled, inputDraftHydrated, isStreaming])

  // ---- Consume pendingInsertText from FileTree clicks ----
  const pendingInsert = useUIStore((s) => s.pendingInsertText)
  React.useEffect(() => {
    if (!pendingInsert) return

    // Parse <select-file> tags to extract file paths for attachment
    const segments = parseSelectFileText(pendingInsert)
    const filePaths = segments
      .filter((s) => s.type === 'file')
      .map((s) => s.text)
      .filter(Boolean)

    if (filePaths.length > 0) {
      addFiles(filePaths)
    } else {
      // Plain text insert at cursor
      const sel = textEditorRef.current?.getSelection() ?? {
        start: textRef.current.length,
        end: textRef.current.length
      }
      const pendingPlainText = selectFileTextToPlainText(pendingInsert)
      const needsPrefix =
        sel.start === sel.end &&
        sel.start > 0 &&
        !/\s$/.test(textRef.current.slice(0, sel.start)) &&
        pendingPlainText.length > 0 &&
        !/^\s/.test(pendingPlainText)

      const prefix = needsPrefix ? ' ' : ''
      const newText =
        textRef.current.slice(0, sel.start) +
        prefix +
        pendingInsert +
        textRef.current.slice(sel.end)
      setText(newText)
      const cursorPos = sel.start + prefix.length + pendingInsert.length
      requestAnimationFrame(() => {
        textEditorRef.current?.setSelection(cursorPos, cursorPos)
      })
    }

    useUIStore.getState().setPendingInsertText(null)
  }, [pendingInsert, addFiles])

  // ---- Attach media handler ----
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

      // Always load images as previews, regardless of vision support.
      // Vision check gates only whether images are sent to the model (see handleSend).
      const imagePaths = paths.filter((filePath) => Boolean(getImageMediaTypeForPath(filePath)))
      const filePaths = paths.filter((filePath) => !imagePaths.includes(filePath))
      const imageFallbackPaths: string[] = []

      if (imagePaths.length > 0) {
        setPendingImageReads((prev) => prev + imagePaths.length)
        try {
          const images = await Promise.all(
            imagePaths.map(async (filePath) => {
              const attachment = await readImagePathAsAttachment(filePath)
              if (!attachment) {
                imageFallbackPaths.push(filePath)
                return null
              }
              const name = filePath.replace(/\\/g, '/').split('/').pop() || filePath
              return { attachment, name }
            })
          )
          const valid = images.filter(
            (item): item is NonNullable<typeof item> => item !== null
          )
          if (valid.length > 0) {
            setAttachments((prev) => [
              ...prev,
              ...valid.map(({ attachment, name }) => ({
                type: 'image' as const,
                id: attachment.id,
                name,
                dataUrl: attachment.dataUrl,
                mediaType: attachment.mediaType
              }))
            ])
          }
        } finally {
          setPendingImageReads((prev) => Math.max(0, prev - imagePaths.length))
        }
      }

      const pathsForFileReferences = [...filePaths, ...imageFallbackPaths]
      if (pathsForFileReferences.length > 0) {
        addFiles(pathsForFileReferences)
      }
    } catch (error) {
      log.error('Failed to attach media:', error)
      toast.error(t('input.attachMediaFailed'))
    }
  }, [addFiles, readImagePathAsAttachment, getImageMediaTypeForPath, supportsVision, t])

  const handleSelectWorkspace = React.useCallback(async (): Promise<void> => {
    try {
      const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_SELECT_FOLDER, {})) as {
        canceled?: boolean
        path?: string
      }
      if (result.canceled || !result.path || !activeTaskId) return
      useChatStore.getState().setWorkingFolder(activeTaskId, result.path)
      textEditorRef.current?.focus()
    } catch (error) {
      log.error('Failed to select workspace:', error)
    }
  }, [activeTaskId])

  // ---- Reset composer ----
  const resetComposer = React.useCallback((): void => {
    if (activeDraftKey) {
      removePersistedDraft(activeDraftKey)
    }

    textEditorRef.current?.clear()
    setText('')
    setAttachments([])
  }, [activeDraftKey, removePersistedDraft])

  // ---- Send ----
  const handleSend = React.useCallback((): void => {
    const trimmed = text.trim()
    const currentFileAttachments = fileAttachments
    const currentImageAttachments = imageAttachments

    if (!trimmed && currentImageAttachments.length === 0 && currentFileAttachments.length === 0) return
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

    // Collect file paths from the structured attachment list.
    // The chat action will serialize them as @{path} tokens for the AI.
    const allFilePaths: string[] = currentFileAttachments.map((f) => f.sendPath)

    // When vision is NOT supported, treat image attachments as file references
    if (!supportsVision) {
      for (const img of currentImageAttachments) {
        const label = img.mediaType.split('/')[1]?.toUpperCase() || 'IMAGE'
        allFilePaths.push(label)
      }
    }

    // Strip <select-file> editor tags from the text — file references are
    // carried as structured data in filePaths, not embedded in the message.
    const cleanText = (() => {
      if (!trimmed) return ''
      const segments = parseSelectFileText(trimmed)
      return segments
        .filter((s) => s.type === 'text')
        .map((s) => s.text)
        .join('')
    })()

    // Only send images to the model when vision is supported
    const imagesToSend =
      supportsVision && currentImageAttachments.length > 0
        ? currentImageAttachments
        : undefined

    onSend(
      cleanText,
      imagesToSend,
      {
        clearCompletedTasksOnTurnStart: true,
        ...(allFilePaths.length > 0 ? { filePaths: allFilePaths } : {})
      }
    )

    resetComposer()
  }, [
    text,
    fileAttachments,
    imageAttachments,
    disabled,
    needsWorkingFolder,
    pendingImageReads,
    supportsVision,
    onSend,
    resetComposer,
    taskId
  ])

  // ---- Keyboard ----
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.nativeEvent.isComposing) return

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  // ---- Drag & Drop (external OS file drops via Tauri native API) ----
  const [dragging, setDragging] = React.useState(false)

  React.useEffect(() => {
    let unlisten: (() => void) | undefined

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        const el = containerRef.current
        if (!el) return

        const type = event.payload.type

        // 'leave' has no position — just reset drag state
        if (type === 'leave') {
          setDragging(false)
          return
        }

        const scale = window.devicePixelRatio || 1
        const x = event.payload.position.x / scale
        const y = event.payload.position.y / scale
        const target = document.elementFromPoint(x, y)
        const isOverComposer = target !== null && el.contains(target)

        if (type === 'enter' || type === 'over') {
          setDragging(isOverComposer)
        } else if (type === 'drop') {
          setDragging(false)
          if (isOverComposer && event.payload.paths.length > 0) {
            addFiles(event.payload.paths)
          }
        }
      })
      .then((fn) => { unlisten = fn })
      .catch((err) => { log.error('Tauri onDragDropEvent failed:', err) })

    return () => { unlisten?.() }
  }, [addFiles])

  // Reset on escape
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDragging(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // ---- Toolbar controls ----
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
      {workingFolder && workspaceDisplayName && (
        <WorkspaceFilePopover
          workingFolder={workingFolder}
          workspaceDisplayName={workspaceDisplayName}
          activeTaskId={activeTaskId ?? null}
        />
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

  // Derived send state
  const canSend = text.trim().length > 0 || attachments.length > 0
  const isSendDisabled =
    (!text.trim() && attachments.length === 0) ||
    disabled ||
    needsWorkingFolder ||
    pendingImageReads > 0

  // ---- Render ----
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
          style={{ minHeight: MIN_INPUT_HEIGHT }}
        >
          {/* Drag overlay */}
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-accent/70 pointer-events-none">
              <span className="flex items-center gap-1.5 text-xs text-primary/70 font-medium">
                <FileUp className="size-3.5" />
                {supportsVision ? t('input.dropImages') : t('input.dropFiles')}
              </span>
            </div>
          )}

          {/* Unified attachment strip */}
          <ComposerAttachmentStrip
            attachments={attachments}
            onRemove={removeAttachment}
          />

          {/* Text input area */}
          <div className="relative flex min-h-0 flex-1 flex-col px-2 pt-2">
            <TextEditor
              ref={textEditorRef}
              value={text}
              onChange={setText}
              disabled={disabled}
              placeholder={undefined}
              minHeight={80}
              maxHeight={300}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => {}}
              onBlur={() => {}}
              className="min-h-0 w-full"
            />
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
            isDisabled={isSendDisabled}
            canSend={canSend}
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
