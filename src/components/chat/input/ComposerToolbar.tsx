import * as React from 'react'
import {
  ArrowUp,
  Square,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export interface ComposerToolbarProps {
  isStreaming: boolean
  isDisabled: boolean
  canSend: boolean
  hasMessages: boolean
  showClearButton: boolean
  queuedMessagesCount: number
  // Actions
  composerActionsControl: React.JSX.Element
  /** Task-level context badges (skill, workspace) shown after the + button */
  contextBadges?: React.ReactNode
  onStop: (() => void) | undefined
  onSend: () => void
  onClearConfirm: () => void
  // Ref for the toolbar container
  bottomToolbarRef: React.RefObject<HTMLDivElement | null>
}

export function ComposerToolbar({
  isStreaming,
  isDisabled,
  canSend,
  hasMessages,
  showClearButton,
  queuedMessagesCount,
  composerActionsControl,
  contextBadges,
  onStop,
  onSend,
  onClearConfirm,
  bottomToolbarRef
}: ComposerToolbarProps): React.JSX.Element {
  const { t } = useTranslation('chat')

  const actionControl = isStreaming ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="rounded-full text-red-700 dark:text-red-400"
          data-composer-variant="task"
          data-tone="warning"
          onClick={onStop}
        >
          <Square className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('input.stopTooltip')}</TooltipContent>
    </Tooltip>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="rounded-full"
          data-composer-variant="task"
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          onClick={onSend}
          disabled={
            !canSend ||
            isDisabled
          }
        >
          <ArrowUp className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('input.sendTooltip')}</TooltipContent>
    </Tooltip>
  )

  return (
    <div
      ref={bottomToolbarRef}
      className="relative z-20 mt-1 shrink-0 flex items-center justify-between gap-2 p-2"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-1 [scrollbar-width:none]">
          {composerActionsControl}
          {contextBadges}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {showClearButton && hasMessages && !isStreaming && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-xl"
                  aria-label={t('input.clearMessages')}
                  title={t('input.clearMessages')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('input.clearConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {queuedMessagesCount > 0
                      ? t('input.clearConfirmDescWithQueue', {
                          defaultValue:
                            'This will delete all messages in this task and clear {{count}} pending messages in the current task. This action cannot be undone.',
                          count: queuedMessagesCount
                        })
                      : t('input.clearConfirmDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">
                    {t('action.cancel', { ns: 'common' })}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    size="sm"
                    onClick={onClearConfirm}
                  >
                    {t('action.clear', { ns: 'common' })}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {actionControl}
        </div>
      </div>
    </div>
  )
}
