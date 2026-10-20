import { icon } from '../icons.js'

const { invoke } = window.__TAURI__.core
const $ = (id) => document.getElementById(id)
const kind = new URLSearchParams(location.search).get('kind') === 'accessibility' ? 'accessibility' : 'screen'

const texts = {
  screen: {
    icon: 'screen',
    title: 'Bildschirmaufnahme erlauben',
    lead: 'Damit PeekaView deinen Bildschirm oder ein Fenster teilen kann, braucht es einmalig die Erlaubnis von macOS.',
    steps: [
      'Rechts ist <b>Datenschutz &amp; Sicherheit → Bildschirm- &amp; Systemaudioaufnahme</b> geöffnet.',
      'Steht PeekaView schon in der Liste, schalte es ein. Sonst ziehe das Symbol oben in die Liste.',
      'Bestätige mit deinem Passwort oder Touch ID.',
      'macOS übernimmt die Erlaubnis erst nach einem <b>Neustart von PeekaView</b>.',
    ],
    done: 'Erlaubt – PeekaView startet gleich neu.',
  },
  accessibility: {
    icon: 'control',
    title: 'Fernsteuerung erlauben',
    lead: 'Damit Zuschauer Maus und Tastatur im geteilten Fenster bedienen können, braucht PeekaView Zugriff auf die Bedienungshilfen.',
    steps: [
      'Rechts ist <b>Datenschutz &amp; Sicherheit → Bedienungshilfen</b> geöffnet.',
      'Steht PeekaView schon in der Liste, schalte es ein. Sonst ziehe das Symbol oben in die Liste.',
      'Bestätige mit deinem Passwort oder Touch ID – fertig, ein Neustart ist nicht nötig.',
    ],
    done: 'Erlaubt – die Fernsteuerung ist jetzt aktiv.',
  },
}[kind]

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 16)
$('perm-icon').innerHTML = icon(texts.icon, 22)
$('title').textContent = texts.title
$('lead').textContent = texts.lead
$('steps').innerHTML = texts.steps.map((s) => `<li>${s}</li>`).join('')
$('restart').hidden = kind !== 'screen'

// a native file drag of the app bundle, started while the mouse button is down
$('drag').addEventListener('mousedown', (e) => {
  if (e.button === 0) invoke('drag_app').catch(console.error)
})
$('open').addEventListener('click', () => invoke('request_permission', { kind }))
$('restart').addEventListener('click', () => invoke('restart_app'))

const poll = setInterval(async () => {
  const status = await invoke('permission_status')
  if (!status[kind]) return
  clearInterval(poll)
  $('done').hidden = false
  $('note').hidden = true
  $('done').querySelector('span').textContent = texts.done
  $('drag').classList.add('granted')
}, 1000)
