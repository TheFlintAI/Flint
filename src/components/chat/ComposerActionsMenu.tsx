import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Paperclip,
  ImagePlus,
  FolderOpen
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ComposerActionsMenuProps {
  /** Callback to open the file (document) picker. */
  onAttachFiles?: () => void
  /** Callback to open the image picker. Only rendered when supportsVision is true. */
  onAttachImages?: () => void
  /** Callback to open the workspace folder picker. */
  onSelectWorkspace?: () => void
  disabled?: boolean
  triggerClassName?: string
  menuClassName?: string
  /** Whether the current model supports vision/image input. Gates the image menu item. */
  supportsVision?: boolean
  workingFolder?: string
}

/**
 * "+" dropdown menu with separate actions for files, images, and workspace.
 *
 * Architecture note: Files and images are separate menu items because they
 * inject into prompts differently — files become @{path} tokens (all models
 * support this) while images become base64 content blocks (only vision models).
 */
export function ComposerActionsMenu({
  onAttachFiles,
  onAttachImages,
  onSelectWorkspace,
  disabled = false,
  triggerClassName,
  menuClassName,
  supportsVision = false,
  workingFolder
}: ComposerActionsMenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={cn('rounded-full', triggerClassName)}
          disabled={disabled}
          aria-label={t('input.composerActions.addActions')}
          title={t('input.composerActions.addActions')}
        >
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className={menuClassName}>
        {onAttachFiles && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => {
                onAttachFiles()
              })
            }}
          >
            <Paperclip className="size-4" />
            <span>{t('input.composerActions.attachFile')}</span>
          </DropdownMenuItem>
        )}

        {supportsVision && onAttachImages && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => {
                onAttachImages()
              })
            }}
          >
            <ImagePlus className="size-4" />
            <span>{t('input.composerActions.attachImage')}</span>
          </DropdownMenuItem>
        )}

        {onSelectWorkspace && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => {
                onSelectWorkspace()
              })
            }}
          >
            <FolderOpen className="size-4" />
            <span>{workingFolder
              ? t('input.contextBar.selectWorkspace', { defaultValue: 'Change workspace' })
              : t('input.composerActions.workspace', { defaultValue: 'Workspace' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
