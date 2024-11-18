import { createI18n } from 'vue-i18n'

import en from './locales/en.json'
import de from './locales/de.json'

export default createI18n({
  legacy: false,
  globalInjection: true, 
  locale: Intl.DateTimeFormat().resolvedOptions().locale.substring(0, 2),
  fallbackLocale: 'en',
  messages: {
    en,
    de
  }
})