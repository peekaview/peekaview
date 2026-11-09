// The script of download.html (kept out of the page: the site's Content-Security-Policy allows
// scripts only from files of its own origin – see deploy/_headers).
import { icon, owl } from './icons.js'
import { t, translate, mountLanguageSwitch, mountLanguageToggle } from './i18n.js'
import './legal.js'

translate()
mountLanguageSwitch()
mountLanguageToggle(document.querySelector('#topbar'))
document.querySelector('#top-logo').innerHTML = owl(34)
for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, 20))
// which download fits this computer (phones and tablets get no desktop app)
const ua = navigator.userAgent
const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
const system = /Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)
  ? 'phone'
  : /Win/i.test(platform) || /Windows/i.test(ua) ? 'windows' : /Mac/i.test(platform) || /Mac OS X/i.test(ua) ? 'mac' : 'other'
const own = document.querySelector(`[data-system="${system}"]`)
if (own) own.hidden = false
for (const item of document.querySelectorAll('[data-other]')) item.hidden = item.dataset.other === system
document.querySelector('[data-others-title]').textContent = system === 'other' || system === 'phone'
  ? t('PeekaView Desktop herunterladen', 'Download PeekaView Desktop')
  : t('Andere Systeme', 'Other systems')
document.querySelector('[data-from-invitation]').hidden = system === 'phone'
