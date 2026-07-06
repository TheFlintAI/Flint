import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Check,
  Copy,
  ImagePlus,
  FolderOpen,
  FileCode2,
  Undo2
} from 'lucide-react'
import { formatTokens } from '@/lib/utils/format-tokens'
import { useMemoizedTokens } from '@/hooks/use-estimated-tokens'
import {
  writeImageBlobToClipboard,
  writeImageDataUrlToClipboard
} from '@/lib/chat/image-clipboard'
import type { ContentBlock, MessageContextSnapshot } from '@/lib/api/types'
import {
  extractEditableUserMessageDraft,
  type ImageAttachment
} from '@/lib/chat/image-attachments'
import { selectFileTextToPlainText } from '@/lib/chat/select-file-tags'
import { SystemCommandCard } from './SystemCommandCard'
import { SelectFileInlineText } from './SelectFileInlineText'
import { createLogger } from '@/lib/logger'

const log = createLogger('UserMessage')

interface UserMessageProps {
  content: string | ContentBlock[]
  contextSnapshot?: MessageContextSnapshot
  messageId?: string
  taskId?: string | null
  onRollback?: (messageId: string) => void
}

function ActionIconButton({
  label,
  icon,
  onClick
}: {
  label: string
  icon: ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/80 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

const USER_MESSAGE_BUBBLE_CLASS =
  'rounded-lg border border-border/60 bg-muted/60 px-4 py-3 text-base text-foreground'
function MessageContextBadges({ snapshot }: { snapshot: MessageContextSnapshot }): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const items: React.JSX.Element[] = []

  if (snapshot.workspace) {
    const displayName = snapshot.workspace.split(/[\\/]/).pop() || snapshot.workspace
    items.push(
      <Tooltip key="ws">
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <FolderOpen className="size-3 shrink-0" />
            <span className="max-w-32 truncate">{displayName}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{snapshot.workspace}</TooltipContent>
      </Tooltip>
    )
  }

  if (snapshot.fileCount && snapshot.fileCount > 0) {
    items.push(
      <span key="files" className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <FileCode2 className="size-3 shrink-0" />
        <span>{t('userMessage.fileCount', { count: snapshot.fileCount })}</span>
      </span>
    )
  }

  if (snapshot.imageCount && snapshot.imageCount > 0) {
    items.push(
      <span key="images" className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <ImagePlus className="size-3 shrink-0" />
        <span>{t('userMessage.imageCount', { count: snapshot.imageCount })}</span>
      </span>
    )
  }

  if (items.length === 0) return null
  return <div className="mb-2 flex flex-wrap items-center gap-1">{items}</div>
}

async function copyImageSourceToClipboard(src: string): Promise<void> {
  if (src.startsWith('data:')) {
    await writeImageDataUrlToClipboard(src)
    return
  }

  const response = await fetch(src)
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
  await writeImageBlobToClipboard(await response.blob())
}

async function copyImageAttachmentToClipboard(image: ImageAttachment): Promise<void> {
  await copyImageSourceToClipboard(image.dataUrl)
}

function UserImageAttachmentView({
  image,
  onPreview
}: {
  image: ImageAttachment
  onPreview?: (src: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [copied, setCopied] = useState(false)

  const copyImage = useCallback(async (): Promise<void> => {
    try {
      await copyImageAttachmentToClipboard(image)
      setCopied(true)
      toast.success(t('userMessage.imageCopied'))
      window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      log.error('Copy image failed:', error)
      toast.error(t('userMessage.copyImageFailed'))
    }
  }, [image, t])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        onPreview &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault()
        onPreview(image.dataUrl)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') return
      event.preventDefault()
      event.stopPropagation()
      void copyImage()
    },
    [copyImage, image.dataUrl, onPreview]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('userMessage.imageAttachment')}
      className="group/img relative shrink-0 cursor-zoom-in rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring/20"
      onClick={() => onPreview?.(image.dataUrl)}
      onKeyDown={handleKeyDown}
      title={t('userMessage.copyImageShortcut')}
    >
      <img
        src={image.dataUrl}
        alt=""
        className="max-h-[180px] max-w-[240px] rounded-lg border border-border/60 object-contain shadow-sm transition-shadow group-hover/img:shadow-md"
      />
      <button
        type="button"
        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/img:opacity-100 group-focus-within/img:opacity-100"
        aria-label={copied ? t('userMessage.imageCopied') : t('userMessage.copyImage')}
        title={copied ? t('userMessage.imageCopied') : t('userMessage.copyImage')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void copyImage()
        }}
      >
        {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

export function UserMessage({
  content,
  contextSnapshot,
  messageId,
  taskId,
  onRollback
}: UserMessageProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const currentDraft = useMemo(() => extractEditableUserMessageDraft(content), [content])
  const plainText = currentDraft.text
  const allImages = currentDraft.images
  const command = currentDraft.command
  const displayText = plainText
  const copyBodyText = selectFileTextToPlainText(displayText)
  const copyText = command
    ? `/${command.name}${copyBodyText ? ` ${copyBodyText}` : ''}`
    : copyBodyText

  const memoizedTokens = useMemoizedTokens(displayText)

  const [copied, setCopied] = useState(false)
  const [previewCopied, setPreviewCopied] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)

  const handleCopy = useCallback((): void => {
    navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [copyText])

  const handleRollback = useCallback((): void => {
    setRollbackConfirmOpen(true)
  }, [])

  const handleRollbackConfirm = useCallback((): void => {
    setRollbackConfirmOpen(false)
    if (messageId && onRollback) {
      onRollback(messageId)
    }
  }, [messageId, onRollback])

  const handleCopyPreviewImage = useCallback(async (): Promise<void> => {
    if (!previewImageSrc) return

    try {
      await copyImageSourceToClipboard(previewImageSrc)
      setPreviewCopied(true)
      toast.success(t('userMessage.imageCopied'))
      window.setTimeout(() => setPreviewCopied(false), 1500)
    } catch (error) {
      log.error('Copy preview image failed:', error)
      toast.error(t('userMessage.copyImageFailed'))
    }
  }, [previewImageSrc, t])

  return (
    <div className="group/user flex flex-col">
      <div className="w-full">
        <div className={`${USER_MESSAGE_BUBBLE_CLASS} w-full relative`}>
          {contextSnapshot && <MessageContextBadges snapshot={contextSnapshot} />}
          {command && <SystemCommandCard command={command} />}
          {displayText && (
            <div className="text-base leading-relaxed">
              <SelectFileInlineText text={displayText} />
            </div>
          )}
          {allImages.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {allImages.map((img) => (
                <UserImageAttachmentView
                  key={img.id}
                  image={img}
                  onPreview={setPreviewImageSrc}
                />
              ))}
            </div>
          )}

          <Dialog
            open={Boolean(previewImageSrc)}
            onOpenChange={(open) => {
              if (!open) setPreviewImageSrc(null)
            }}
          >
            <DialogContent className="max-h-[90vh] !w-fit !max-w-[min(96vw,1100px)] overflow-hidden p-2 sm:!max-w-[min(96vw,1100px)]">
              <DialogTitle className="sr-only">{t('userMessage.imagePreview')}</DialogTitle>
              {previewImageSrc && (
                <div
                  tabIndex={0}
                  className="relative flex max-w-full items-center justify-center overflow-hidden outline-none"
                  onKeyDown={(event) => {
                    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') {
                      return
                    }
                    event.preventDefault()
                    event.stopPropagation()
                    void handleCopyPreviewImage()
                  }}
                  title={t('userMessage.copyImageShortcut')}
                >
                  <button
                    type="button"
                    className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                    aria-label={
                      previewCopied ? t('userMessage.imageCopied') : t('userMessage.copyImage')
                    }
                    title={
                      previewCopied ? t('userMessage.imageCopied') : t('userMessage.copyImage')
                    }
                    onClick={() => void handleCopyPreviewImage()}
                  >
                    {previewCopied ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                  <img
                    src={previewImageSrc}
                    alt={t('userMessage.imagePreview')}
                    className="block h-auto max-h-[calc(90vh-1rem)] w-auto max-w-[min(92vw,1068px)] rounded-sm object-contain"
                  />
                </div>
              )}
            </DialogContent>
          </Dialog>
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/user:pointer-events-auto group-hover/user:opacity-100">
            {messageId && taskId && onRollback && (
              <>
                <ActionIconButton
                  label={t('userMessage.rollbackTooltip')}
                  icon={<Undo2 className="size-3.5" />}
                  onClick={handleRollback}
                />
                <AlertDialog open={rollbackConfirmOpen} onOpenChange={setRollbackConfirmOpen}>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('userMessage.rollbackConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('userMessage.rollbackConfirmDesc')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel size="sm">
                        {t('action.cancel', { ns: 'common' })}
                      </AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleRollbackConfirm}>
                        {t('userMessage.rollback')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            <ActionIconButton
              label={copied ? t('userMessage.copied') : t('action.copy', { ns: 'common' })}
              icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              onClick={handleCopy}
            />
          </div>
        </div>
        {displayText.length > 50 && (
          <p className="mt-1 pr-1 text-right text-[10px] text-muted-foreground/0 transition-colors tabular-nums group-hover/user:text-muted-foreground/40">
            {formatTokens(memoizedTokens)} {t('unit.tokens', { ns: 'common' })}
          </p>
        )}
      </div>
    </div>
  )
}
