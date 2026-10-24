// Guided native file drag, with a click-through marker on the real System Settings window.
import { icon } from '../icons.js'

const { invoke } = window.__TAURI__.core
const { listen, emitTo } = window.__TAURI__.event
const $ = (id) => document.getElementById(id)
let step = null
let phase = 'ready'
let targetVisible = false

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 16)

function markTarget() {
  if (step === 'done') return Promise.resolve()
  return emitTo('permission-target', 'permission-guide', { phase, step })
}

function guide(next) {
  phase = next
  const done = step === 'done'
  const active = phase === 'dragging' ? 'drop' : phase === 'enable' ? 'enable' : 'grab'
  document.body.dataset.phase = phase
  for (const li of document.querySelectorAll('[data-guide]')) {
    const current = !done && li.dataset.guide === active
    li.hidden = done || (!current && !(phase === 'dragging' && li.dataset.guide === 'grab'))
    li.classList.toggle('current', current)
    if (current) li.setAttribute('aria-current', 'step')
    else li.removeAttribute('aria-current')
  }
  const instruction = done ? 'Alles erledigt!' : !targetVisible
    ? 'Öffne die Systemeinstellungen, um fortzufahren.'
    : phase === 'dragging' ? 'Maustaste weiter gedrückt halten.'
    : phase === 'enable' ? 'Schalter neben PeekaView einschalten.'
    : 'App-Icon in die markierte Liste ziehen.'
  if ($('instruction').textContent !== instruction) $('instruction').textContent = instruction
  $('drag').disabled = done || !targetVisible || phase === 'dragging'
  $('guide').hidden = done || !targetVisible
  $('open-settings').hidden = done || targetVisible
  $('quit').hidden = done || step !== 'screen'
  $('done').hidden = !done
  $('already-listed').hidden = done || phase !== 'ready'
  $('already-listed').disabled = !targetVisible
  $('retry').hidden = done || phase !== 'enable'
  $('note').hidden = step !== 'screen' || phase !== 'enable'
  markTarget().catch(console.error)
}

function render(status) {
  if (status.targetVisible !== undefined) targetVisible = status.targetVisible
  const changed = step !== status.step
  step = status.step
  $('permission-title').textContent = step === 'screen' ? 'Bildschirmaufnahme erlauben' : step === 'done' ? 'Bereit zum Teilen' : 'Bedienungshilfen erlauben'
  for (const li of document.querySelectorAll('.perm-list li')) {
    const kind = li.dataset.kind
    li.classList.toggle('ok', !!status[kind])
    li.classList.toggle('now', step === kind)
    const required = kind === 'screen' || status.accessibilityRequired !== false
    li.querySelector('b').innerHTML = status[kind] ? `${icon('check', 15)} Erteilt` : step === kind ? 'Jetzt erlauben' : required ? 'Offen' : 'Bei Bedarf'
    li.setAttribute('aria-label', `${li.querySelector('strong').textContent}: ${status[kind] ? 'erteilt' : required ? 'erforderlich, noch offen' : 'optional, noch offen'}`)
  }
  if (changed) $('error').hidden = true
  guide(changed ? 'ready' : phase)
}

$('open-settings').addEventListener('click', async () => {
  try {
    $('error').hidden = true
    await invoke('open_permission_settings', { kind: step })
  } catch (error) {
    $('error').textContent = String(error)
    $('error').hidden = false
  }
})
$('quit').addEventListener('click', () => invoke('quit'))

$('drag').addEventListener('mousedown', (event) => {
  if (event.button !== 0 || $('drag').disabled) return
  event.preventDefault()
  const kind = step
  $('error').hidden = true
  guide('dragging')
  invoke('drag_app', { kind }).catch(() => {
    if (step !== kind) return
    guide('ready')
    $('error').textContent = 'Ziehen fehlgeschlagen. Bitte erneut versuchen.'
    $('error').hidden = false
  })
})
$('already-listed').addEventListener('click', () => {
  $('error').hidden = true
  guide('enable')
})
$('retry').addEventListener('click', () => {
  $('error').hidden = true
  guide('ready')
})

await listen('perm', (event) => render(event.payload))
await listen('perm-drag', (event) => {
  if (event.payload.kind !== step || step === 'done') return
  guide(event.payload.dropped ? 'enable' : 'ready')
  if (!event.payload.dropped) {
    $('error').textContent = 'Noch nicht abgelegt. Bitte erneut in die markierte App-Liste ziehen.'
    $('error').hidden = false
  }
})
await listen('permission-guide-ready', () => markTarget().catch(console.error))
const status = await invoke('permission_status')
if (step === null) render({ step: status.accessibilityRequired !== false && !status.accessibility ? 'accessibility' : !status.screen ? 'screen' : 'done', ...status })
