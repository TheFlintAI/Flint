import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useUIStore } from '@/stores/ui-store'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'

const shortcutGroups = [
  {
    labelKey: 'general',
    items: [
      { keys: 'Ctrl+N', descKey: 'newTask' },
      { keys: 'Ctrl+Shift+N', descKey: 'newTask' },
      { keys: 'Ctrl+D', descKey: 'duplicateTask' },
      { keys: 'Ctrl+P', descKey: 'pinUnpinTask' },
      { keys: 'Ctrl+,', descKey: 'openSettings' },
      { keys: 'Ctrl+/', descKey: 'keyboardShortcuts' },
      { keys: 'Ctrl+Shift+A', descKey: 'toggleAutoApprove' },
    ]
  },
  {
    labelKey: 'navigation',
    items: [
      { keys: 'Ctrl+B', descKey: 'toggleSidebar' },
      { keys: 'Ctrl+↑/↓', descKey: 'prevNextTask' },
      { keys: 'Ctrl+Home/End', descKey: 'scrollTopBottom' }
    ]
  },
  {
    labelKey: 'chatGroup',
    items: [
      { keys: 'Enter', descKey: 'sendMessage' },
      { keys: 'Ctrl+Enter', descKey: 'sendMessageAlt' },
      { keys: 'Shift+Enter', descKey: 'newLine' },
      { keys: '↑/↓', descKey: 'inputHistory' },
      { keys: 'Escape', descKey: 'stopStreaming' },
      { keys: 'Ctrl+L', descKey: 'clearMessages' },
    ]
  },
  {
    labelKey: 'toolPermissions',
    items: [
      { keys: 'Y', descKey: 'allowTool' },
      { keys: 'N / Esc', descKey: 'denyTool' }
    ]
  }
]

export function KeyboardShortcutsDialog(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const open = useUIStore((s) => s.shortcutsOpen)
  const setOpen = useUIStore((s) => s.setShortcutsOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm sm:max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-3 overflow-y-auto py-2 pr-2">
          {shortcutGroups.map((group, gi) => (
            <div key={group.labelKey}>
              {gi > 0 && <Separator className="mb-3" />}
              <p className="mb-1 px-2 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                {t(`shortcuts.${group.labelKey}`)}
              </p>
              <div className="space-y-0.5">
                {group.items.map((s) => (
                  <div
                    key={s.keys}
                    className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-muted/50"
                  >
                    <span className="text-muted-foreground">{t(`shortcuts.${s.descKey}`)}</span>
                    <kbd className="rounded-sm border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
