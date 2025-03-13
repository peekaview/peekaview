import { createApp } from 'vue'
import { Tooltip } from 'floating-vue'

import i18n from './i18n'

// Import CSS before Vue components for correct styling order
import '../assets/css/app.css'

import App from './App.vue'

const app = createApp(App)

app.use(i18n)
app.component('Tooltip', Tooltip)
app.mount('#app')
