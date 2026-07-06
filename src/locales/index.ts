import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings-store'

import enCommon from './en/common.json'
import enLayout from './en/layout.json'
import enChat from './en/chat.json'
import enSettings from './en/settings.json'
import enAgent from './en/agent.json'

import zhCommon from './zh/common.json'
import zhLayout from './zh/layout.json'
import zhChat from './zh/chat.json'
import zhSettings from './zh/settings.json'
import zhAgent from './zh/agent.json'

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      layout: enLayout,
      chat: enChat,
      settings: enSettings,
      agent: enAgent
    },
    zh: {
      common: zhCommon,
      layout: zhLayout,
      chat: zhChat,
      settings: zhSettings,
      agent: zhAgent
    }
  },
  lng: useSettingsStore.getState().language,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false
  }
})

export default i18n
