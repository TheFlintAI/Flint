import { useCallback, useState, type ReactNode } from 'react'
import { X, Download, Copy, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { tauriCommands } from '@/services/tauri-api/command-client'
import {
  downloadImage,
  fetchImageBase64,
  writeImageToClipboard
} from '@/services/tauri-api/runtime'
import {
  buildImageDimensionCacheKey,
  cacheImageDimensions,
  dataUrlToBlob,
  getCachedImageDimensions,
  useImageDisplaySrc,
  type ImageDimensions
} from '@/hooks/use-image-display-src'
import { createLogger } from '@/lib/logger'

const log = createLogger('ImagePreview')

interface ImagePreviewProps {
  src: string
  alt?: string
  filePath?: string
  actions?: ImagePreviewAction[]
}

export interface ImagePreviewAction {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
}

function getDownloadExtension(imageSrc: string): string {
  if (imageSrc.startsWith('data:')) {
    const mimeType = imageSrc.slice(5, imageSrc.indexOf(';'))
    if (mimeType === 'image/jpeg') return '.jpg'
    if (mimeType === 'image/webp') return '.webp'
    if (mimeType === 'image/gif') return '.gif'
    if (mimeType === 'image/bmp') return '.bmp'
    if (mimeType === 'image/svg+xml') return '.svg'
    return '.png'
  }

  const fileExt = imageSrc.split('?')[0].split('.').pop()?.toLowerCase()
  return fileExt ? `.${fileExt}` : '.png'
}

function getFileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || `image-${Date.now()}.png`
}

async function downloadPersistedImage(
  filePath: string,
  defaultName: string
): Promise<{ canceled?: boolean }> {
  const readResult = (await tauriCommands.invoke(TAURI_COMMANDS.FS_READ_FILE_BINARY, {
    path: filePath
  })) as { data?: string; error?: string }

  if (readResult.error || !readResult.data) {
    throw new Error(readResult.error || 'Failed to read image file')
  }

  const saveResult = (await tauriCommands.invoke(TAURI_COMMANDS.FS_SELECT_SAVE_FILE, {
    defaultPath: defaultName,
    filters: [
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']
      }
    ]
  })) as { path?: string; canceled?: boolean }

  if (saveResult.canceled || !saveResult.path) {
    return { canceled: true }
  }

  const writeResult = (await tauriCommands.invoke(TAURI_COMMANDS.FS_WRITE_FILE_BINARY, {
    path: saveResult.path,
    data: readResult.data
  })) as { success?: boolean; error?: string }

  if (writeResult.error) {
    throw new Error(writeResult.error)
  }

  return { canceled: false }
}

export function ImagePreview({
  src,
  alt: altProp,
  filePath,
  actions = []
}: ImagePreviewProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const alt = altProp || t('imagePreview.defaultAlt')
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const displaySrc = useImageDisplaySrc(src, filePath)
  const effectiveSrc = displaySrc || src
  const imageDimensionKey = buildImageDimensionCacheKey(src, filePath)
  const cachedImageDimensions = getCachedImageDimensions(src, filePath, effectiveSrc)
  const [imageDimensionState, setImageDimensionState] = useState<{
    key: string
    dimensions: ImageDimensions | null
  }>(() => ({
    key: imageDimensionKey,
    dimensions: cachedImageDimensions
  }))
  const imageDimensions =
    imageDimensionState.key === imageDimensionKey
      ? (imageDimensionState.dimensions ?? cachedImageDimensions)
      : cachedImageDimensions

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight, currentSrc } = event.currentTarget
      if (!naturalWidth || !naturalHeight) return

      const nextDimensions = { width: naturalWidth, height: naturalHeight }
      setImageDimensionState((current) => {
        if (
          current.key === imageDimensionKey &&
          current.dimensions?.width === nextDimensions.width &&
          current.dimensions?.height === nextDimensions.height
        ) {
          return current
        }
        return {
          key: imageDimensionKey,
          dimensions: cacheImageDimensions(src, nextDimensions, {
            filePath,
            displaySrc: currentSrc
          })
        }
      })
    },
    [filePath, imageDimensionKey, src]
  )

  const handleDownload = async (): Promise<void> => {
    try {
      const defaultName = filePath
        ? getFileName(filePath)
        : `image-${Date.now()}${getDownloadExtension(src)}`

      if (filePath) {
        const result = await downloadPersistedImage(filePath, defaultName)
        if (result.canceled) return
      } else if (src.startsWith('data:')) {
        const blob = dataUrlToBlob(src)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else if (/^https?:\/\//i.test(src)) {
        const result = await downloadImage({ url: src, defaultName })
        if (result.error) throw new Error(result.error)
        if (result.canceled) return
      } else if (effectiveSrc.startsWith('blob:')) {
        const response = await fetch(effectiveSrc)
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else {
        const a = document.createElement('a')
        a.href = effectiveSrc
        a.download = defaultName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }

      toast.success(t('imagePreview.imageDownloaded'))
    } catch (error) {
      log.error('Download failed:', error)
      toast.error(t('imagePreview.downloadFailed'))
    }
  }

  const handleCopy = async (): Promise<void> => {
    try {
      let imageBase64: string

      if (filePath) {
        const result = (await tauriCommands.invoke(TAURI_COMMANDS.FS_READ_FILE_BINARY, {
          path: filePath
        })) as { data?: string; error?: string }
        if (result.error || !result.data) {
          throw new Error(result.error || 'Failed to read image file')
        }
        imageBase64 = result.data
      } else if (src.startsWith('data:')) {
        const parts = src.split(',', 2)
        if (parts.length !== 2) throw new Error('Invalid data URL')
        imageBase64 = parts[1]
      } else {
        const result = await fetchImageBase64({ url: src })
        if (result.error || !result.data) {
          throw new Error(result.error || 'Failed to fetch image data')
        }
        imageBase64 = result.data
      }

      const result = await writeImageToClipboard({ data: imageBase64 })
      if (result.error) throw new Error(result.error)

      setCopied(true)
      toast.success(t('imagePreview.imageCopied'))
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      log.error('Copy failed:', error)
      toast.error(t('imagePreview.copyFailed'))
    }
  }

  return (
    <>
      {/* Thumbnail */}
      <div
        className="relative max-w-lg overflow-hidden rounded-lg border border-border/50 transition-colors group hover:border-accent"
        style={
          imageDimensions
            ? { aspectRatio: `${imageDimensions.width} / ${imageDimensions.height}` }
            : undefined
        }
        onClick={() => {
          if (effectiveSrc) setIsOpen(true)
        }}
      >
        {actions.length > 0 && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  action.onClick()
                }}
                className="flex size-8 items-center justify-center rounded-md bg-black/55 text-white transition-colors hover:bg-black/70"
                title={action.label}
                aria-label={action.label}
              >
                {action.icon}
              </button>
            ))}
          </div>
        )}
        {effectiveSrc ? (
          <img
            src={effectiveSrc}
            alt={alt}
            className="block w-full h-auto"
            loading="lazy"
            onLoad={handleImageLoad}
            {...(imageDimensions
              ? { width: imageDimensions.width, height: imageDimensions.height }
              : {})}
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-muted/20 text-xs text-muted-foreground">
            Loading image...
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium bg-black/50 px-3 py-1.5 rounded-full">
            Click to enlarge
          </div>
        </div>
      </div>

      {/* Full screen preview */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setIsOpen(false)}
          >
            {/* Toolbar */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    action.onClick()
                  }}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title={action.label}
                  aria-label={action.label}
                >
                  {action.icon}
                </button>
              ))}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopy()
                }}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                title={t('imagePreview.copyToClipboard')}
              >
                {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDownload()
                }}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                title={t('imagePreview.download')}
              >
                <Download className="size-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsOpen(false)
                }}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                title={t('imagePreview.close')}
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Image */}
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={effectiveSrc}
              alt={alt}
              className="max-w-full max-h-full object-contain"
              onLoad={handleImageLoad}
              onClick={(e) => e.stopPropagation()}
              {...(imageDimensions
                ? { width: imageDimensions.width, height: imageDimensions.height }
                : {})}
            />

            {/* Close hint */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
              Click outside to close
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
