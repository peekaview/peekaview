// The script of the simple website pages (preise.html, warum.html), kept out of the pages: the
// site's Content-Security-Policy allows scripts only from files of its own origin (deploy/_headers).
import { translate, mountLanguageSwitch, mountLanguageToggle } from './i18n.js'
import './legal.js'
translate()
mountLanguageSwitch()
mountLanguageToggle(document.querySelector('.pv-page-top'))
