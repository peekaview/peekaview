// The PeekaView window of the desktop client: pick what to share (also to change a running share)
// and the join requests while nothing is shared. Opened from the tray icon; while sharing the
// toolbar takes over (toolbar.js); settings and permanent rooms have a window of their own.
import { icon, owl } from '../icons.js'
import { renderRequests } from './requests.js'

const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const $ = (id) => document.getElementById(id)
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const renderIcons = (root = document) => {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 17)
}

let sources = []
let kind = 'screen'
// picked sources: one screen, or up to six windows
let selected = []
const MAX_WINDOWS = 6
let invite = null
// picking new sources for the running share (from its toolbar)
let switching = false

// errors of this window go to PeekaView's log
window.addEventListener('error', (e) => invoke('log_js', { message: `main: ${e.message} (${e.filename}:${e.lineno})` }).catch(() => {}))
window.addEventListener('unhandledrejection', (e) => invoke('log_js', { message: `main: ${e.reason}` }).catch(() => {}))

renderIcons()
$('logo').innerHTML = owl(22)
$('name').value = store.get('pv-name') ?? ''

// ------------------------------------------------------------------ settings (kept on the Rust side,
// edited in the settings window)

let settings = {}
$('name').addEventListener('change', () => {
  store.set('pv-name', $('name').value.trim())
  if (!invite) invoke('set_settings', { patch: { name: $('name').value.trim() } }).then((s) => (settings = s))
})
$('settings-btn').addEventListener('click', () => invoke('rooms_window'))
listen('settings', (e) => {
  settings = e.payload ?? {}
  renderRoomChoice()
})
listen('toast', (e) => toast(String(e.payload)))

// ------------------------------------------------------------------ which room to share into
// a new link, the last one again ("Raumlink beibehalten", also in the tray menu), or a permanent room

let rooms = []
function renderRoomChoice() {
  const select = $('room-choice')
  const value = select.value || (settings.keep_link ? 'keep' : 'new')
  select.replaceChildren()
  const add = (v, label) => select.append(Object.assign(document.createElement('option'), { value: v, textContent: label }))
  add('new', 'Neuer Link')
  add('keep', 'Letzten Link beibehalten')
  for (const r of rooms) add(`room:${r.id}`, `Raum: ${r.name}${r.pin ? ' (PIN)' : ''}`)
  add('manage', 'Feste Räume verwalten …')
  select.value = [...select.options].some((o) => o.value === value) ? value : 'new'
}
$('room-choice').addEventListener('change', () => {
  const v = $('room-choice').value
  if (v === 'manage') {
    invoke('rooms_window')
    return renderRoomChoice()
  }
  // "Letzten Link beibehalten" is the tray's "Raumlink beibehalten"
  if ((v === 'keep') !== !!settings.keep_link) invoke('set_settings', { patch: { keep_link: v === 'keep' } }).then((s) => (settings = s))
})
listen('rooms', (e) => {
  rooms = e.payload ?? []
  renderRoomChoice()
})
Promise.all([invoke('get_settings'), invoke('rooms_list')]).then(([s, r]) => {
  settings = s ?? {}
  rooms = r ?? []
  // settings from before they were kept on the Rust side
  if (settings.keep_link == null && store.get('pv-keep') === '1') invoke('set_settings', { patch: { keep_link: true } }).then((x) => (settings = x))
  if (!$('name').value && settings.name) $('name').value = settings.name
  renderRoomChoice()
})

// ------------------------------------------------------------------ join requests

// (while sharing they appear below the toolbar)
listen('join-requests', (e) => renderRequests($('requests'), e.payload ?? []))

function error(msg) {
  $('error').textContent = msg ?? ''
  $('error').hidden = !msg
}

// ------------------------------------------------------------------ the picker: a new share, or other sources for the running one

listen('picker', (e) => {
  switching = !!e.payload
  showView()
  loadSources()
})
// the running share ended: back to a new share
listen('ended', (e) => {
  switching = false
  showView()
  if (e.payload) error(e.payload)
})

function showView() {
  $('cancel-switch').hidden = !switching
  $('name').hidden = switching
  $('room-choice').hidden = switching
  $('live-badge').hidden = !switching
  updateStart()
  highlight()
  saveUi()
}
$('cancel-switch').addEventListener('click', () => {
  switching = false
  showView()
  invoke('hide_window')
})

// red frames around the picked windows while picking (and this window is in front)
function highlight() {
  const picking = document.hasFocus()
  invoke('highlight', { sources: picking ? selected : [] })
}
window.addEventListener('focus', () => {
  highlight()
  // fresh thumbnails when coming back to the picker
  if (Date.now() - loadedAt > 5000) loadSources()
})
window.addEventListener('blur', highlight)

// ------------------------------------------------------------------ picker

function renderGrid(loading = false) {
  const grid = $('grid')
  if (loading) {
    grid.innerHTML = Array.from({ length: 6 }, () => '<div class="card skeleton"><div class="thumb"></div><div class="meta"><strong>&nbsp;</strong><span>&nbsp;</span></div></div>').join('')
    return
  }
  const list = sources.filter((s) => s.kind === kind)
  if (!list.length) {
    grid.innerHTML = `<div class="empty">${kind === 'screen' ? 'Kein Bildschirm gefunden.' : 'Keine teilbaren Fenster gefunden.'}</div>`
    return
  }
  grid.replaceChildren(
    ...list.map((s) => {
      const card = document.createElement('button')
      card.className = 'card'
      const index = selected.indexOf(s.id)
      card.classList.toggle('selected', index >= 0)
      card.innerHTML = '<div class="thumb"></div><div class="meta"><strong></strong><span></span></div>'
      if (index >= 0 && s.kind === 'window') card.querySelector('.thumb').insertAdjacentHTML('beforeend', `<span class="pick">${index + 1}</span>`)
      const thumb = card.querySelector('.thumb')
      if (s.thumb) thumb.style.backgroundImage = `url("${s.thumb}")`
      else thumb.innerHTML = icon(s.kind, 32)
      // the app's name, below it the (shortened) window title – no tooltip over the picture
      card.querySelector('strong').textContent = s.kind === 'window' ? s.app : s.title
      card.querySelector('span').textContent = s.kind === 'window' ? s.title : s.app
      card.addEventListener('click', () => select(s.id))
      card.addEventListener('dblclick', () => {
        if (!selected.includes(s.id)) select(s.id)
        start()
      })
      return card
    }),
  )
}

// a screen is shared alone; windows can be combined (click again to remove one)
function select(id) {
  const source = sources.find((s) => s.id === id)
  if (!source) selected = []
  else if (source.kind === 'screen') selected = [id]
  else if (selected.includes(id)) selected = selected.filter((x) => x !== id)
  else {
    selected = [...selected.filter((x) => x.startsWith('window:')), id]
    if (selected.length > MAX_WINDOWS) {
      selected = selected.slice(-MAX_WINDOWS)
      toast(`Höchstens ${MAX_WINDOWS} Fenster gleichzeitig.`, 'info')
    }
  }
  saveUi()
  updateStart()
  renderGrid()
  highlight()
}

function updateStart() {
  $('start').disabled = !selected.length
  const n = selected.filter((x) => x.startsWith('window:')).length
  $('start-label').textContent = switching ? (n > 1 ? `${n} Fenster teilen` : 'Wechseln') : n > 1 ? `${n} Fenster teilen` : 'Freigabe starten'
  // say what is missing instead of a silently greyed out button
  $('picker-title').textContent = switching ? 'Was sollen die anderen stattdessen sehen?' : 'Was sollen die anderen sehen?'
  $('picker-lead').textContent = kind === 'window'
    ? 'Klicke auf ein Fenster. Mehrere Fenster: einfach nacheinander anklicken.'
    : 'Klicke auf deinen Bildschirm – oder oben auf „Fenster“, um nur ein Programm zu zeigen.'
  $('start-hint').textContent = !selected.length
    ? 'Zuerst oben etwas anklicken.'
    : switching ? '' : 'Danach den Link verschicken – die anderen öffnen ihn im Browser.'
}

let loadedAt = 0
async function loadSources() {
  loadedAt = Date.now()
  if (!sources.length) renderGrid(true)
  try {
    sources = await invoke('list_sources')
  } catch (e) {
    sources = []
    error(String(e))
  }
  selected = selected.filter((id) => sources.some((s) => s.id === id))
  saveUi()
  updateStart()
  renderGrid()
  highlight()
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab)
    renderGrid()
    updateStart()
  })
}
$('refresh').addEventListener('click', loadSources)

// ------------------------------------------------------------------ sharing

async function start() {
  error()
  if (!selected.length) return
  if (switching) return switchSource()
  const status = await invoke('permission_status')
  if (!status.screen) {
    error('PeekaView darf den Bildschirm noch nicht aufnehmen. Bitte in den Systemeinstellungen erlauben (die Hilfe zeigt wie) – danach startet PeekaView kurz neu.')
    return invoke('request_permission', { kind: 'screen' })
  }

  const name = $('name').value.trim() || 'Host'
  store.set('pv-name', $('name').value.trim())
  $('start').disabled = true
  try {
    // "Letzten Link beibehalten": the same room secret and presenter key as last time;
    // a permanent room: its secret and key
    const choice = invite ? 'new' : $('room-choice').value
    settings = await invoke('get_settings')
    const keep = choice === 'keep'
    let kept = keep ? { room: store.get('pv-keep-room'), key: store.get('pv-keep-key') } : {}
    if (choice.startsWith('room:')) {
      const k = await invoke('room_keys', { id: choice.slice(5) })
      kept = { room: k.secret, key: k.signingKey }
    }
    const hosted = await invoke('start_share', {
      site: invite?.site ?? settings.site ?? '',
      name,
      sources: selected,
      room: invite?.room || kept.room || null,
      signingKey: kept.key || null,
      color: invite?.color ?? null,
      relays: invite?.relays ?? settings.relays ?? [],
      ice: invite?.ice ?? null,
      turnUrls: settings.turn_urls ?? [],
      turnSecret: settings.turn_secret || null,
    })
    if (keep) {
      store.set('pv-keep-room', hosted.secret)
      store.set('pv-keep-key', hosted.signingKey)
    }
    // this window closes, the toolbar comes up – with the link in the clipboard
  } catch (e) {
    error(String(e))
    if (String(e).includes('Bildschirmaufnahme')) invoke('request_permission', { kind: 'screen' })
  } finally {
    updateStart()
  }
}

$('start').addEventListener('click', start)

const sourceTitle = (s) => (s.kind === 'window' ? `${s.app} – ${s.title}` : s.title)
const sharedTitle = () => {
  const list = selected.map((id) => sources.find((s) => s.id === id)).filter(Boolean)
  return list.length > 1 ? list.map((s) => s.app || s.title).join(', ') : list[0] ? sourceTitle(list[0]) : ''
}

// a running share switches to another screen / window; room, viewers, voice and recording continue
async function switchSource() {
  $('start').disabled = true
  try {
    await invoke('switch_source', { sources: selected })
    switching = false
    showView()
    invoke('toast', { text: `Jetzt geteilt: ${sharedTitle() || 'neue Auswahl'}` })
  } catch (e) {
    error(String(e))
  } finally {
    updateStart()
  }
}

// ------------------------------------------------------------------ invitations (peekaview://share?…)

function applyInvite(data) {
  invite = data
  saveUi()
  $('invite').hidden = !invite
  if (!invite) return
  if (invite.name) $('name').value = invite.name
  $('invite-room').textContent = 'Einladung zu einer Bildschirmfreigabe'
  // always show where the viewers will watch
  $('invite-server').textContent = invite.site ? `Zuschauer-Website: ${new URL(invite.site).host}` : 'Zuschauer sind über die einladende Anwendung verbunden'
  loadSources()
}

$('invite-clear').addEventListener('click', () => applyInvite(null))
listen('invite', (e) => applyInvite(e.payload))
invoke('take_invite').then((data) => data && applyInvite(data))

// ------------------------------------------------------------------ toasts & macOS permissions

let toastTimer
function toast(text, kind = 'ok', ms = 3500) {
  $('toast').querySelector('span').textContent = text
  $('toast').classList.toggle('info', kind === 'info')
  $('toast').firstElementChild.outerHTML = icon(kind === 'info' ? 'record' : 'check', 17)
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), ms)
}

listen('permission-granted', (e) => {
  if (e.payload === 'screen') {
    $('perm-banner').hidden = true
    toast('Super – es kann losgehen! PeekaView startet kurz neu …')
    // macOS only applies the screen recording permission to a fresh process
    setTimeout(() => invoke('restart_app'), 2500)
  } else {
    toast('Super – Steuern ist jetzt freigeschaltet!')
    rememberPermissions({ accessibility: true })
  }
})

// The last known permission state survives restarts: a permission granted in the meantime
// (PeekaView or macOS restarted the app for it) is greeted right after the start.
function rememberPermissions(update) {
  let known = {}
  try {
    known = JSON.parse(store.get('pv-perm') ?? '{}') ?? {}
  } catch {}
  store.set('pv-perm', JSON.stringify({ ...known, ...update }))
  return known
}

$('perm-fix').addEventListener('click', () => invoke('request_permission', { kind: 'screen' }))
const permissionCheck = invoke('permission_status').then((status) => {
  const before = rememberPermissions(status)
  const justGranted = (before.screen === false && status.screen) || (before.accessibility === false && status.accessibility)
  if (justGranted) toast('Super – es kann losgehen!', 'ok', 5000)
  $('perm-banner').hidden = status.screen
  if (!status.screen) invoke('request_permission', { kind: 'screen' })
  return justGranted
})

// ------------------------------------------------------------------ continue after a restart

// e.g. macOS "Beenden & erneut öffnen" after granting a permission
function saveUi() {
  store.set('pv-ui', JSON.stringify({ at: Date.now(), selected, kind, invite }))
}

async function restoreUi() {
  let ui
  try {
    ui = JSON.parse(store.get('pv-ui') ?? 'null')
  } catch {}
  if (ui && Date.now() - ui.at < 3 * 60 * 1000) {
    if (ui.invite) applyInvite(ui.invite)
    kind = ui.kind ?? 'screen'
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.kind === kind)
    selected = Array.isArray(ui.selected) ? ui.selected : []
  }
  await loadSources()
}

invoke('resume')
  .then(async (hosted) => {
    if (!hosted) return restoreUi()
    const justGranted = await permissionCheck.catch(() => false)
    invoke('toast', { text: justGranted ? 'Super – es kann losgehen! Deine Freigabe läuft weiter.' : 'Freigabe fortgesetzt – alle sind wieder verbunden.' })
  })
  .catch((e) => error(String(e)))
