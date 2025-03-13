import { createApp } from 'vue'
import { Tooltip } from 'floating-vue'

import i18n from './i18n'

// Import a single CSS file that manages the import order
import '../assets/css/main.css'

import App from './App.vue'

const app = createApp(App)

app.use(i18n)
app.component('Tooltip', Tooltip)
app.mount('#app')
