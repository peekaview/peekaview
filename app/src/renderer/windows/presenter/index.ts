import { createApp } from 'vue'

import i18n from '../../i18n'

import 'bootstrap/dist/css/bootstrap.css'
// IMPORTANT: load bootstrap styles before Vue components for correct styling order
import Presenter from './Presenter.vue'

import '../../../assets/css/styles.css'

const app = createApp(Presenter)

app.use(i18n)
app.mount('#presenter')