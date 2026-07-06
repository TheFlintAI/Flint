import { Eye, Sparkles, MonitorSmartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { modelSupportsVision } from '@/stores/provider-store'
import type { AIModelConfig, ProviderType } from '@/lib/api/types'

const BADGE_BASE =
  'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium'

/** Capability badges rendered beneath a model name: context window, vision, computer use, thinking. */
export function ModelMetaBadges({
  model,
  providerType,
  className
}: {
  model: AIModelConfig
  providerType?: ProviderType
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div className={`flex items-center gap-1 flex-wrap ${className ?? ''}`}>
      {model.contextLength &&
        (() => {
          const kVal = model.contextLength / 1024
          const display =
            kVal >= 1000 ? `${(kVal / 1000).toFixed(1)}M` : `${Math.round(kVal)}K`
          return (
            <span
              className={`${BADGE_BASE} bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-mono`}
            >
              {display}
            </span>
          )
        })()}
      {modelSupportsVision(model, providerType) && (
        <span className={`${BADGE_BASE} bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400`}>
          <Eye className="size-2.5" />
          {t('provider.capabilityVision')}
        </span>
      )}
      {model.type === 'openai-responses' &&
        model.id.toLowerCase().includes('gpt-5') && (
          <span
            className={`${BADGE_BASE} bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400`}
          >
            <MonitorSmartphone className="size-2.5" />
            {t('provider.computerUseEnabled')}
          </span>
        )}
      {model.supportsThinking && (
        <span
          className={`${BADGE_BASE} bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400`}
        >
          <Sparkles className="size-2.5" />
          {t('provider.capabilityThinking')}
        </span>
      )}
    </div>
  )
}
