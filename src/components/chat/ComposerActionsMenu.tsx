import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Paperclip,
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

interface ComposerActionsMenuProps {
  onAttachMedia?: () => void
  disabled?: boolean
  triggerClassName?: string
  menuClassName?: string
  workingFolder?: string
  onSelectWorkspace?: () => void
}

export function ComposerActionsMenu({
  onAttachMedia,
  disabled = false,
  triggerClassName,
  menuClassName,
  workingFolder,
  onSelectWorkspace
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

      <DropdownMenuContent align="start" className={cn('w-56', menuClassName)}>
        {onAttachMedia && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => {
                onAttachMedia()
              })
            }}
          >
            <Paperclip className="size-4" />
            <span>{t('input.composerActions.attachMedia')}</span>
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
