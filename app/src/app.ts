import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import { modalControllerPlugin } from 'bootstrap-vue-next'

import en from './locales/en.json'
import de from './locales/de.json'

import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
// IMPORTANT: load bootstrap styles before Vue components for correct styling order
import App from './App.vue'

import './assets/css/styles.css'

const app = createApp(App)
app.use(modalControllerPlugin)

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

app.use(i18n)
app.mount('#app')
