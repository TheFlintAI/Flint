import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore, resolveReasoningEffortForModel } from '@/stores/settings-store'
import type { ThinkingConfig, ReasoningEffortLevel } from '@/lib/api/types'

export interface ThinkingLevelSelectProps {
  providerId: string
  modelId: string
  thinkingConfig: ThinkingConfig
}

const OFF_VALUE = '__off__'
const ON_VALUE = '__on__'

export function ThinkingLevelSelect({
  providerId,
  modelId,
  thinkingConfig
}: ThinkingLevelSelectProps): React.JSX.Element {
  const { t } = useTranslation('layout')

  const { thinkingEnabled, reasoningEffort, reasoningEffortByModel, updateSettings } =
    useSettingsStore(
      useShallow((s) => ({
        thinkingEnabled: s.thinkingEnabled,
        reasoningEffort: s.reasoningEffort,
        reasoningEffortByModel: s.reasoningEffortByModel,
        updateSettings: s.updateSettings
      }))
    )

  const levels = thinkingConfig.reasoningEffortLevels
  const hasLevels = levels && levels.length > 0

  const effectiveEffort = hasLevels
    ? resolveReasoningEffortForModel({
        reasoningEffort,
        reasoningEffortByModel,
        providerId,
        modelId,
        thinkingConfig
      })
    : undefined

  // Build option list
  const options = useMemo(() => {
    const opts: Array<{ label: string; value: string }> = []
    opts.push({ value: OFF_VALUE, label: t('topbar.thinkingOff', { defaultValue: 'Off' }) })
    if (hasLevels) {
      levels!.forEach((level) =>
        opts.push({
          value: level,
          label: t(`topbar.reasoningEffortLevels.${level}`, { defaultValue: level })
        })
      )
    } else {
      opts.push({ value: ON_VALUE, label: t('topbar.thinkingOn', { defaultValue: 'On' }) })
    }
    return opts
  }, [hasLevels, levels, t])

  const currentValue = !thinkingEnabled
    ? OFF_VALUE
    : hasLevels
      ? (effectiveEffort ?? ON_VALUE)
      : ON_VALUE

  const handleChange = (value: string): void => {
    if (value === OFF_VALUE) {
      updateSettings({ thinkingEnabled: false })
    } else if (value === ON_VALUE) {
      updateSettings({ thinkingEnabled: true })
    } else {
      const key = `${providerId}:${modelId}`
      updateSettings({
        thinkingEnabled: true,
        reasoningEffortByModel: {
          ...reasoningEffortByModel,
          [key]: value as ReasoningEffortLevel
        }
      })
    }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-xs text-muted-foreground">
        {t('topbar.thinking')}
      </span>
      <Select value={currentValue} onValueChange={handleChange}>
        <SelectTrigger size="sm" className="h-8 w-[5rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
