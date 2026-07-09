import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MessageList } from '@/components/chat/MessageList'
import { InputArea } from '@/components/chat/InputArea'
import { useChatActions } from '@/hooks/use-chat-actions'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat-store'

interface TaskPaneProps {
  taskId?: string | null
  windowHeaderOwnsTitle?: boolean
}

export function TaskPane({
  taskId,
  windowHeaderOwnsTitle = false
}: TaskPaneProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const resolvedTaskId = useChatStore((state) => taskId ?? state.activeTaskId)
  const taskView = useChatStore(
    useShallow((state) => {
      const targetTaskId = taskId ?? state.activeTaskId
      const currentTask = targetTaskId
        ? state.tasks.find((item) => item.id === targetTaskId)
        : undefined

      return {
        taskId: targetTaskId,
        title: currentTask?.title ?? null,
        workingFolder: currentTask?.workingFolder,
        messageCount: currentTask?.messageCount ?? 0
      }
    })
  )
  const streamingMessageId = useChatStore((state) =>
    resolvedTaskId ? (state.streamingMessages[resolvedTaskId] ?? null) : null
  )
  const isStreaming = Boolean(streamingMessageId)
  const {
    sendMessage,
    stopStreaming,
    continueLastToolExecution,
    retryLastMessage,
    deleteMessage,
    rollbackMessage
  } = useChatActions()

  const compactTaskHeader = taskView.messageCount === 0
  const taskRoot = useMemo(() => resolvedTaskId ?? 'empty', [resolvedTaskId])
  const showInlineTaskTitle = !windowHeaderOwnsTitle

  if (!resolvedTaskId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('sidebar.newChat', { defaultValue: 'Flint' })}
      </div>
    )
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-background">
      <div
        className={cn(
          'flex shrink-0 items-center gap-3 px-3 pt-3',
          showInlineTaskTitle ? (compactTaskHeader ? 'pb-1' : 'pb-2') : 'pb-2'
        )}
      >
        <div className="min-w-0 flex-1">
          {showInlineTaskTitle ? (
            <div className="flex min-w-0 items-center gap-2">
              <div
                className={cn(
                  'min-w-0 flex-1 truncate text-foreground',
                  compactTaskHeader ? 'text-[13px] font-medium' : 'text-[14px] font-medium'
                )}
              >
                {taskView.title || t('sidebar.defaultTaskTitle')}
              </div>
              {taskView.workingFolder ? (
                <div className="flex min-w-0 max-w-[38%] shrink items-center gap-1.5 text-[11px] text-muted-foreground/65">
                  <span className="shrink-0 text-muted-foreground/35">/</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate cursor-default">{taskView.workingFolder}</span>
                    </TooltipTrigger>
                    <TooltipContent>{taskView.workingFolder}</TooltipContent>
                  </Tooltip>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div key={taskRoot} className="flex min-h-0 flex-1 flex-col">
        {taskView.messageCount === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <motion.div
              key="input-centered"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="w-full max-w-[760px]"
            >
              <InputArea
                taskId={resolvedTaskId}
                onSend={(text, images, options) =>
                  void sendMessage(text, images, undefined, resolvedTaskId, undefined, {
                    ...options,
                    clearCompletedTasksOnTurnStart: true
                  })
                }
                onStop={stopStreaming}
                workingFolder={taskView.workingFolder}
                isStreaming={isStreaming}
              />
            </motion.div>
          </div>
        ) : (
          <>
            <MessageList
              taskId={resolvedTaskId}
              onRetry={retryLastMessage}
              onContinue={continueLastToolExecution}
              onDeleteMessage={deleteMessage}
              onRollbackMessage={rollbackMessage}
            />
            <motion.div
              key="input-bottom"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <InputArea
                taskId={resolvedTaskId}
                onSend={(text, images, options) =>
                  void sendMessage(text, images, undefined, resolvedTaskId, undefined, {
                    ...options,
                    clearCompletedTasksOnTurnStart: true
                  })
                }
                onStop={stopStreaming}
                workingFolder={taskView.workingFolder}
                isStreaming={isStreaming}
              />
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
