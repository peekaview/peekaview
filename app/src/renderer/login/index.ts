import { createApp } from 'vue'

import i18n from '../i18n'

import 'bootstrap/dist/css/bootstrap.css'
// IMPORTANT: load bootstrap styles before Vue components for correct styling order
import Login from './Login.vue'

import '../../assets/css/styles.css'

const app = createApp(Login)

app.use(i18n)
app.mount('#login')
