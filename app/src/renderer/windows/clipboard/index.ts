import { createApp } from 'vue'

import i18n from '../../i18n'

import 'bootstrap/dist/css/bootstrap.css'
import '../../../assets/css/loading.css'
import '../../../assets/css/styles.css'

import Clipboard from './Clipboard.vue'

const app = createApp(Clipboard)

app.use(i18n)
app.mount('#clipboard')