import * as React from 'react'
import { FileText, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentActions,
  AttachmentAction
} from '@/components/ui/attachment'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'
import {
  type ComposerAttachment,
  isImageAttachment,
  getAttachmentLabel
} from '@/lib/chat/composer-attachment'

export interface ComposerAttachmentStripProps {
  attachments: ComposerAttachment[]
  onRemove: (id: string) => void
}

export function ComposerAttachmentStrip({
  attachments,
  onRemove
}: ComposerAttachmentStripProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const [previewImage, setPreviewImage] = React.useState<ComposerAttachment | null>(null)

  if (attachments.length === 0) return null

  const previewImageUrl: string | null = previewImage && isImageAttachment(previewImage)
    ? previewImage.dataUrl
    : null

  return (
    <>
      <AttachmentGroup className="shrink-0 px-3 pt-3 pb-0">
        <AnimatePresence>
          {attachments.map((att) => {
          const isImage = isImageAttachment(att)
          const label = getAttachmentLabel(att)

          return (
            <motion.div
              key={att.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
            <Attachment
              key={att.id}
              orientation="vertical"
              size="sm"
              state="done"
              className="bg-muted/50 focus-within:ring-0"
            >
              <AttachmentMedia
                variant={isImage ? 'image' : 'icon'}
                className={isImage ? '!w-full cursor-pointer' : '!w-full'}
                onClick={isImage ? () => setPreviewImage(att) : undefined}
              >
                {isImage ? (
                  <img
                    src={att.dataUrl}
                    alt={label}
                    className="size-full object-cover"
                  />
                ) : (
                  <FileText />
                )}
              </AttachmentMedia>
              <AttachmentContent className="text-center">
                <AttachmentTitle className="max-w-[100px] text-[11px]" title={label}>
                  {label}
                </AttachmentTitle>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  onClick={() => onRemove(att.id)}
                  aria-label={t('input.removeAttachment', { defaultValue: 'Remove attachment' })}
                  className="focus-visible:ring-0"
                >
                  <X />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
            </motion.div>
          )
        })}
        </AnimatePresence>
      </AttachmentGroup>

      {/* Full-screen image preview */}
      <Dialog
        open={previewImageUrl !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null)
        }}
      >
        <DialogContent className="max-h-[90vh] !w-fit !max-w-[min(96vw,1100px)] overflow-hidden p-2 sm:!max-w-[min(96vw,1100px)]">
          <DialogTitle className="sr-only">
            {t('userMessage.imagePreview')}
          </DialogTitle>
          {previewImageUrl !== null && (
            <div className="flex max-w-full items-center justify-center overflow-hidden">
              <img
                src={previewImageUrl}
                alt={t('userMessage.imagePreview')}
                className="block h-auto max-h-[calc(90vh-1rem)] w-auto max-w-[min(92vw,1068px)] rounded-sm object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
