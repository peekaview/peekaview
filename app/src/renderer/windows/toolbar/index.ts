import { createApp } from 'vue'

import i18n from '../../i18n'

import 'bootstrap/dist/css/bootstrap.css'
import '../../../assets/css/loading.css'

import Toolbar from './Toolbar.vue'

const app = createApp(Toolbar)

app.use(i18n)
app.mount('#toolbar')

if (window.process) {
  let params: string[] = []
  let i = 0
  window.process.argv.forEach((param) => {
    if (i > 0 && param.substring(0, 1) != '-' && param.substring(0, 1) != '/') {
      params.push(param)
    }
    i++
  })
  
  console.log(params)
  console.log(window.process.argv)
}