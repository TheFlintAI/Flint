import * as React from 'react'
import { Image, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'
import type { ImageAttachment } from '@/lib/chat/image-attachments'

export interface ImageAttachmentStripProps {
  images: ImageAttachment[]
  onRemove: (id: string) => void
}

export function ImageAttachmentStrip({
  images,
  onRemove
}: ImageAttachmentStripProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const [previewImage, setPreviewImage] = React.useState<ImageAttachment | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="shrink-0 flex flex-wrap gap-1.5 px-3 pt-2 pb-0">
        {images.map((img) => (
          <span
            key={img.id}
            className="composer-image-badge inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
            onClick={() => setPreviewImage(img)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setPreviewImage(img)
              }
            }}
            aria-label={t('userMessage.imagePreview')}
          >
            <Image className="size-3 shrink-0" />
            <span className="max-w-[120px] truncate">{img.mediaType.split('/')[1]?.toUpperCase() || t('userMessage.imageAttachment')}</span>
            <button
              type="button"
              className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(img.id)
              }}
              aria-label={t('userMessage.removeImage')}
            >
              <X className="size-2.5" />
            </button>
          </span>
        ))}
      </div>

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null)
        }}
      >
        <DialogContent className="max-h-[90vh] !w-fit !max-w-[min(96vw,1100px)] overflow-hidden p-2 sm:!max-w-[min(96vw,1100px)]">
          <DialogTitle className="sr-only">{t('userMessage.imagePreview')}</DialogTitle>
          {previewImage && (
            <div className="flex max-w-full items-center justify-center overflow-hidden">
              <img
                src={previewImage.dataUrl}
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
