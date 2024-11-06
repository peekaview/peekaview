import { createApp } from 'vue'
import { modalControllerPlugin } from 'bootstrap-vue-next'

import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
// IMPORTANT: load bootstrap styles before Vue components for correct styling order
import App from './App.vue'

import './assets/css/styles.css'

const app = createApp(App)
app.use(modalControllerPlugin)

app.mount('#app')
