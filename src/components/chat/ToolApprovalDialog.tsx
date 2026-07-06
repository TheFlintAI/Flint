import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ChevronRight } from 'lucide-react'
import type { ToolCallState } from '@/lib/agent/types'
import { toolRegistry } from '@/lib/agent/tool-registry'
import { resolveLocalizedString } from '@/lib/localized-string'
import { getToolIcon } from '@/lib/tools/tool-icon'
import i18n from '@/locales'

interface ToolApprovalDialogProps {
  toolCall: ToolCallState | null
  onAllow: () => void
  onDeny: () => void
}

export function ToolApprovalDialog({
  toolCall,
  onAllow,
  onDeny
}: ToolApprovalDialogProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [showDetails, setShowDetails] = useState(false)

  const handler = toolCall ? toolRegistry.get(toolCall.name) : null
  const summary = toolCall && handler?.formatApprovalSummary
    ? handler.formatApprovalSummary(toolCall.input)
    : null
  const toolLabel = toolCall
    ? (handler?.displayName
        ? resolveLocalizedString(handler.displayName, i18n.language)
        : t(`permission.toolLabels.${toolCall.name}`, toolCall.name))
    : ''
  const Icon = toolCall ? getToolIcon(toolCall.name) : null

  return (
    <AlertDialog open={!!toolCall}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center text-base">
            {t('permission.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {/* Tool info card */}
              {toolCall && Icon && (
                <div className="min-w-0 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Icon className="size-4" />
                    <span className="text-sm font-medium text-foreground">
                      {toolLabel}
                    </span>
                  </div>
                  {summary && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground break-all whitespace-pre-wrap min-w-0">
                      {summary}
                    </p>
                  )}
                </div>
              )}

              {/* Detail toggle */}
              {toolCall && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight
                      className={`size-3 transition-transform ${showDetails ? 'rotate-90' : ''}`}
                    />
                    {t(showDetails ? 'permission.hideFullInput' : 'permission.showFullInput')}
                  </button>
                  {showDetails && (
                    <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {JSON.stringify(toolCall.input, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDeny} size="sm">
            {t('action.deny', { ns: 'common' })}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAllow} size="sm">
            {t('action.allow', { ns: 'common' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
