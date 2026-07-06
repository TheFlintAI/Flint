import { useTranslation } from 'react-i18next'
import type { PluginToolInfo } from '@/stores/plugin-store'
import { resolveLocalizedString } from '@/lib/localized-string'
import { resolveLucideIcon } from '@/lib/tools/tool-icon'
import { cn } from '@/lib/utils'

interface PluginToolsListProps {
  tools: PluginToolInfo[]
}

export function PluginToolsList({ tools }: PluginToolsListProps): React.JSX.Element {
  const { t, i18n } = useTranslation('settings')

  if (tools.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center">
        <p className="text-[13px] text-muted-foreground">
          {t('plugin.noTools', { defaultValue: 'No tools registered' })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground/60 px-0.5">
        {t('plugin.toolCount', { count: tools.length })}
      </p>
      <div className="space-y-1">
        {tools.map((tool) => {
          const displayName = resolveLocalizedString(tool.displayName, i18n.language)
          const description = resolveLocalizedString(tool.displayDescription, i18n.language)
          const Icon = resolveLucideIcon(tool.icon)

          return (
            <div
              key={tool.name}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 h-16',
                'transition-colors hover:bg-accent/50'
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                <Icon className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1 h-full flex flex-col justify-center">
                <p className="text-[13px] font-medium truncate">{displayName}</p>
                <p className="text-[12px] text-muted-foreground/70 leading-snug mt-0.5 overflow-y-auto scrollbar-auto-hide">
                  {description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
