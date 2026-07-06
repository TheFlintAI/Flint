import * as React from 'react'
import {
  Send,
  CornerDownRight,
  Trash2,
  Ellipsis,
  X,
  ImagePlus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { selectFileTextToPlainText } from '@/lib/chat/select-file-tags'
import { type ImageAttachment } from '@/lib/chat/image-attachments'
import { type PendingTaskMessageItem } from '@/hooks/use-chat-actions'

// Utilities

export function areQueuedMessagesEqual(
  left: PendingTaskMessageItem[],
  right: PendingTaskMessageItem[]
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    const leftMsg = left[i]
    const rightMsg = right[i]
    if (leftMsg.id !== rightMsg.id) return false
    if (leftMsg.text !== rightMsg.text) return false
    if (leftMsg.createdAt !== rightMsg.createdAt) return false
    if (leftMsg.images.length !== rightMsg.images.length) return false
    for (let j = 0; j < leftMsg.images.length; j += 1) {
      if (leftMsg.images[j].id !== rightMsg.images[j].id) return false
    }
  }
  return true
}

export function summarizeQueuedMessage(text: string): string {
  const normalized = selectFileTextToPlainText(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized
}

// Props

interface EditingQueueState {
  editingQueueItemId: string | null
  editingQueueText: string
  editingQueueImages: ImageAttachment[]
  startEdit: (msg: PendingTaskMessageItem) => void
  cancelEdit: () => void
  save: (id: string) => void
  removeImage: (id: string) => void
  addImages: (files: File[]) => void
  setText: (text: string) => void
  queueClearConfirmOpen: boolean
  setQueueClearConfirmOpen: (open: boolean) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
}

export interface QueuedMessagesPanelProps {
  activeTaskId: string | null
  queuedMessages: PendingTaskMessageItem[]
  isQueueDispatchPaused: boolean
  editing: EditingQueueState
  supportsVision: boolean
  queueFileInputRef: React.RefObject<HTMLInputElement | null>
  onResumeQueuedMessages: () => void
  onClearQueuedMessages: () => void
  onClearQueuedMessagesConfirm: () => void
  onRemoveQueuedMessage: (id: string) => void
}

// Image thumbnails (shared between preview and edit modes)

function QueueImageStrip({
  images,
  onRemove,
  onPreview
}: {
  images: ImageAttachment[]
  onRemove: (id: string) => void
  onPreview: (img: ImageAttachment) => void
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {images.map((img) => (
        <div key={img.id} className="relative group/img shrink-0">
          <button
            type="button"
            className="block cursor-zoom-in rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring/20"
            aria-label={t('userMessage.imagePreview')}
            title={t('userMessage.imagePreview')}
            onClick={() => onPreview(img)}
          >
            <img
              src={img.dataUrl}
              alt=""
              className="composer-image-thumb size-12 rounded-lg object-cover transition-transform group-hover/img:scale-[1.03]"
            />
          </button>
          <button
            type="button"
            className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm opacity-0 transition-opacity group-hover/img:opacity-100"
            aria-label={t('userMessage.removeImage')}
            title={t('userMessage.removeImage')}
            onClick={() => onRemove(img.id)}
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function QueuedMessagesPanel({
  activeTaskId: _activeTaskId,
  queuedMessages,
  isQueueDispatchPaused,
  editing,
  supportsVision,
  queueFileInputRef,
  onResumeQueuedMessages,
  onClearQueuedMessages,
  onClearQueuedMessagesConfirm,
  onRemoveQueuedMessage,
  onPreviewImage
}: QueuedMessagesPanelProps & {
  onPreviewImage: (img: ImageAttachment) => void
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')

  if (queuedMessages.length === 0) return null

  return (
    <>
      <div className="mx-auto mb-2 w-full max-w-[820px] overflow-hidden rounded-lg border border-border/50 bg-muted/20 shadow-sm backdrop-blur">
        <div className="max-h-40 overflow-y-auto py-1">
          {queuedMessages.map((msg, index) => {
            const isEditing = editing.editingQueueItemId === msg.id
            const summaryText = summarizeQueuedMessage(msg.text)
            const fallbackText =
              summaryText ||
              t('input.queueImageOnly', { defaultValue: '[Images only]' })
            const quoteLabel = t('input.queueQuote', { defaultValue: 'Quote' })

            return (
              <div
                key={msg.id}
                className={cn(
                  'border-b border-border/35 last:border-b-0',
                  isEditing ? 'px-3 py-2' : 'group flex min-h-8 items-center gap-2 px-3 py-1'
                )}
              >
                {isEditing ? (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {t('input.queueEditing', { defaultValue: 'Edit queued message' })}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={() => editing.save(msg.id)}
                        >
                          {t('action.save', { ns: 'common' })}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={editing.cancelEdit}
                        >
                          {t('action.cancel', { ns: 'common' })}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={editing.editingQueueText}
                      onChange={(e) => editing.setText(e.target.value)}
                      onPaste={editing.onPaste}
                      className="composer-aux-textarea min-h-[56px] max-h-36 resize-none text-xs"
                      rows={2}
                    />
                    {editing.editingQueueImages.length > 0 && (
                      <QueueImageStrip
                        images={editing.editingQueueImages}
                        onRemove={editing.removeImage}
                        onPreview={onPreviewImage}
                      />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      {editing.editingQueueImages.length > 0 ? (
                        <p className="text-[10px] text-muted-foreground">
                          {t('input.queueImageCount', {
                            defaultValue: '{{count}} images',
                            count: editing.editingQueueImages.length
                          })}
                        </p>
                      ) : (
                        <span />
                      )}
                      {supportsVision && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={() => queueFileInputRef.current?.click()}
                        >
                          <ImagePlus className="size-3" />
                          {t('input.attachImages')}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <CornerDownRight className="size-3 shrink-0 text-muted-foreground/65" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      title={fallbackText}
                      onClick={() => editing.startEdit(msg)}
                    >
                      <span className="block truncate text-xs leading-5 text-muted-foreground/90 group-hover:text-foreground">
                        {fallbackText}
                      </span>
                    </button>
                    {msg.images.length > 0 ? (
                      <span className="hidden shrink-0 rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex">
                        {t('input.queueImageCount', {
                          defaultValue: '{{count}} images',
                          count: msg.images.length
                        })}
                      </span>
                    ) : null}
                    <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                      {isQueueDispatchPaused && index === 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={onResumeQueuedMessages}
                          title={t('input.queueResume', { defaultValue: 'Resume' })}
                          aria-label={t('input.queueResume', { defaultValue: 'Resume' })}
                        >
                          <Send className="size-3" />
                          <span className="hidden sm:inline">
                            {t('input.queueResume', { defaultValue: 'Resume' })}
                          </span>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        onClick={() => editing.startEdit(msg)}
                        title={quoteLabel}
                        aria-label={quoteLabel}
                      >
                        <CornerDownRight className="size-3" />
                        <span className="hidden sm:inline">{quoteLabel}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRemoveQueuedMessage(msg.id)}
                        title={t('action.delete', { ns: 'common' })}
                        aria-label={t('action.delete', { ns: 'common' })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            title={t('action.more', { ns: 'common' })}
                            aria-label={t('action.more', { ns: 'common' })}
                          >
                            <Ellipsis className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-36">
                          {isQueueDispatchPaused ? (
                            <DropdownMenuItem onSelect={onResumeQueuedMessages}>
                              <Send className="size-3.5" />
                              {t('input.queueResume', { defaultValue: 'Resume' })}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => editing.startEdit(msg)}>
                            <CornerDownRight className="size-3.5" />
                            {quoteLabel}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={onClearQueuedMessages}
                          >
                            <Trash2 className="size-3.5" />
                            {t('action.clear', { ns: 'common' })}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <AlertDialog
        open={editing.queueClearConfirmOpen}
        onOpenChange={editing.setQueueClearConfirmOpen}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('input.queueClearConfirmTitle', {
                defaultValue: 'Clear queued messages?'
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('input.queueClearConfirmDesc', {
                defaultValue:
                  'This will delete {{count}} pending messages in the current taskItem.',
                count: queuedMessages.length
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">
              {t('action.cancel', { ns: 'common' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              onClick={onClearQueuedMessagesConfirm}
            >
              {t('action.clear', { ns: 'common' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
