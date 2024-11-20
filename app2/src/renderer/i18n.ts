import { createI18n } from 'vue-i18n'

import en from '../locales/en.json'
import de from '../locales/de.json'

export type Locale = "en" | "de"

const i18n = createI18n({
  legacy: false,
  globalInjection: true, 
  locale: Intl.DateTimeFormat().resolvedOptions().locale.substring(0, 2),
  fallbackLocale: 'en',
  messages: {
    en,
    de
  }
})

window.electronAPI?.onChangeLanguage((locale: string) => {
  i18n.global.locale.value = locale as Locale
})

export default i18n