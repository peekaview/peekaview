import { createApp } from 'vue'

import i18n from './i18n'

import 'bootstrap/dist/css/bootstrap.css'
import '../assets/css/loading.css'
// IMPORTANT: load bootstrap styles before Vue components for correct styling order
import App from './App.vue'

import '../assets/css/styles.css'

const app = createApp(App)

app.use(i18n)
app.mount('#app')
