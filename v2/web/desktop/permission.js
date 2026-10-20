// The permission helper, docked to System Settings: all permissions in one go – the Rust side
// opens the pane of each missing one in turn and reports the progress ("perm").
import { icon } from '../icons.js'

const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event
const $ = (id) => document.getElementById(id)

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 16)

// a native file drag of the app bundle, started while the mouse button is down
$('drag').addEventListener('mousedown', (e) => {
  if (e.button === 0) invoke('drag_app').catch(console.error)
})

function render({ step, screen, accessibility }) {
  const ok = { screen, accessibility }
  for (const li of document.querySelectorAll('.perm-list li')) {
    const kind = li.dataset.kind
    li.classList.toggle('ok', !!ok[kind])
    li.classList.toggle('now', step === kind)
    li.querySelector('b').innerHTML = ok[kind] ? icon('check', 15) : step === kind ? '<i class="pulse"></i>' : ''
  }
  const done = step === 'done'
  $('done').hidden = !done
  $('drag').hidden = done
  // only screen recording needs the restart
  $('note').hidden = done || screen
}

listen('perm', (e) => render(e.payload))
invoke('permission_status').then((s) => render({ step: !s.accessibility ? 'accessibility' : 'screen', ...s }))
