import { useTranslation } from 'react-i18next'
import { useChatStore } from '@/stores/chat-store'

export function RightPanelHeader(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const activeTask = useChatStore((state) =>
    state.tasks.find((taskItem) => taskItem.id === state.activeTaskId),
  )

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-background/95 px-3">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
        {activeTask?.title ??
          t('rightPanel.taskPanel')}
      </span>
    </div>
  )
}
