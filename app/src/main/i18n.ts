import i18next from 'i18next'
import backend from 'i18next-fs-backend'
import { resolvePath } from './util'

export const languages = {
  en: 'English',
  de: 'Deutsch',
}

export const i18nReady = i18next.use(backend).init({
  backend: {
    loadPath: resolvePath('locales/{{lng}}.json'),
    addPath: resolvePath('locales/{{lng}}.missing.json'),
  },
  lng: Intl.DateTimeFormat().resolvedOptions().locale.substring(0, 2),
  fallbackLng: Object.keys(languages)[0],
  preload: Object.keys(languages),
  ns: ['translation'],
  /*interpolation: {
    prefix: '{', 
    suffix: '}',
  }*/
})

export const i18n = i18next