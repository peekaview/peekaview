import { createApp } from 'vue'

import i18n from '../i18n'

import '../../assets/css/spectre.min.css'
import '../../assets/css/loading.css'
import '../../assets/css/alerts.css'

import Dialog from './Dialog.vue'

const app = createApp(Dialog)

app.use(i18n)
app.mount('#dialog')