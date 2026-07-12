import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings-store'
import { SettingsRow } from '@/components/ui/settings-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

export function GeneralPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()

  return (
    <div className="flex flex-col gap-6">
      <SettingsRow
        label={t('general.language')}
      >
        <Select
          value={settings.language}
          onValueChange={(v: 'en' | 'zh') => settings.updateSettings({ language: v })}
        >
          <SelectTrigger className="w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh" className="text-xs">
              {t('general.chinese')}
            </SelectItem>
            <SelectItem value="en" className="text-xs">
              {t('general.english')}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )
}
