import { createApp } from 'vue'

import i18n from '../../i18n'

import 'bootstrap/dist/css/bootstrap.css'
import 'floating-vue/dist/style.css'
import '../../../assets/css/loading.css'

import Toolbar from './Toolbar.vue'

const app = createApp(Toolbar)

app.use(i18n)
app.mount('#toolbar')
