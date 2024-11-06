import { createApp } from 'vue'
import { modalControllerPlugin } from 'bootstrap-vue-next'

import App from './App.vue'

import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'

import './assets/css/styles.css'

const app = createApp(App)
app.use(modalControllerPlugin)

app.mount('#app')
