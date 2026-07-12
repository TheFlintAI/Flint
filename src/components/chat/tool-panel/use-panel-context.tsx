import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toolRegistry } from '@/lib/agent/tool-registry'
import { resolveLocalizedString } from '@/lib/localized-string'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import type { ToolPanelProps } from './types'
import { outputAsString } from './utils'

export function usePanelContext(props: ToolPanelProps): ToolPanelContext {
  const { t, i18n } = useTranslation('chat')
  const handler = toolRegistry.get(props.name)
  const outputText = React.useMemo(() => outputAsString(props.output), [props.output])

  const displayName = React.useMemo(() => {
    if (handler?.displayName) {
      return resolveLocalizedString(handler.displayName, i18n.language)
    }
    return t(`toolLabels.${props.name}`, { defaultValue: props.name })
  }, [handler, props.name, i18n.language, t])

  return React.useMemo<ToolPanelContext>(
    () => ({
      toolUseId: props.toolUseId,
      name: props.name,
      displayName,
      input: props.input,
      output: props.output,
      outputText,
      status: props.status,
      error: props.error,
      startedAt: props.startedAt,
      completedAt: props.completedAt,
      t
    }),
    [props, displayName, outputText, t]
  )
}
