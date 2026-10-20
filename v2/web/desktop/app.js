// Presenter toolbar of the desktop client: a small bar at the top edge of the screen; the source
// picker and the settings fold out below it.
import { icon } from '../icons.js'
import { Voice } from '../voice.js'

const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const $ = (id) => document.getElementById(id)
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const renderIcons = (root = document) => {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, el.closest('.logo') ? 16 : 17)
}
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const site = () => $('site').value.trim().replace(/\/+$/, '')
const lines = (id) => $(id).value.split(/\s+/).map((l) => l.trim()).filter(Boolean)
// empty: the viewer site is served over Nostr (nsite), published by this app itself
const DEFAULT_SITE = ''

let sources = []
let kind = 'screen'
// picked sources: one screen, or up to six windows
let selected = []
const MAX_WINDOWS = 6
let invite = null
let sharing = false
let link = ''
let recording = null
const isMac = /Mac/.test(navigator.platform)
const pad = (n) => String(n).padStart(2, '0')

const voice = new Voice({
  send: (msg) => invoke('signal', { msg }),
  onChange: () => {
    const b = $('mic-btn')
    b.classList.toggle('live', voice.on)
    b.title = voice.on ? 'Mikrofon aus' : 'Sprechen'
    b.innerHTML = icon(voice.on ? 'mic' : 'micOff', 17)
    recording?.audio.sync()
  },
})

renderIcons()
$('site').value = (store.get('pv-site') ?? DEFAULT_SITE).replace(/^http:\/\/localhost:8090\/?$/, '')
$('relays').value = store.get('pv-relays') ?? ''
$('turn-urls').value = store.get('pv-turn-urls') ?? ''
$('turn-secret').value = store.get('pv-turn-secret') ?? ''
for (const [id, key] of [['site', 'pv-site'], ['relays', 'pv-relays'], ['turn-urls', 'pv-turn-urls'], ['turn-secret', 'pv-turn-secret']]) {
  $(id).addEventListener('change', () => !invite && store.set(key, $(id).value.trim()))
}
$('name').value = store.get('pv-name') ?? ''

// ------------------------------------------------------------------ window size follows the content

// the bar's left edge stays where the user dragged it, also when the panel folds out below
new ResizeObserver(() => {
  const shell = $('shell')
  const barLeft = shell.querySelector('.bar').offsetLeft
  invoke('toolbar_resize', { width: Math.ceil(shell.offsetWidth), height: Math.ceil(shell.offsetHeight), barLeft })
}).observe($('shell'))

// ------------------------------------------------------------------ move & collapse

$('grip').addEventListener('mousedown', (e) => e.button === 0 && invoke('toolbar_drag'))

function setCollapsed(collapsed) {
  document.body.classList.toggle('collapsed', collapsed)
  store.set('pv-collapsed', collapsed ? '1' : '')
  const b = $('fold-btn')
  b.title = collapsed ? 'Ausklappen' : 'Einklappen'
  b.innerHTML = icon(collapsed ? 'expand' : 'collapse', 17)
  if (collapsed && currentPanel) openPanel(null)
}
$('fold-btn').addEventListener('click', () => setCollapsed(!document.body.classList.contains('collapsed')))

// ------------------------------------------------------------------ settings shared with the Rust side
// (tray menu, permanent rooms waiting for remote access)

let settings = {}
const pushSettings = () =>
  invoke('set_settings', {
    patch: { site: site(), name: $('name').value.trim(), relays: lines('relays'), turn_urls: lines('turn-urls'), turn_secret: $('turn-secret').value.trim() },
  }).catch(() => {})
for (const id of ['site', 'relays', 'turn-urls', 'turn-secret', 'name']) $(id).addEventListener('change', () => !invite && pushSettings())
listen('settings', (e) => {
  settings = e.payload ?? {}
  renderRoomChoice()
})
listen('toast', (e) => toast(String(e.payload)))

// the viewer site on Nostr: address and publishing state
function renderNsite(st) {
  const el = $('nsite')
  el.hidden = !!site() || !st?.url
  if (el.hidden) return
  const states = { publishing: 'wird veröffentlicht …', ok: 'veröffentlicht ✓', error: `Fehler: ${st.error ?? ''}`, idle: 'noch nicht veröffentlicht', dev: 'Entwicklungs-Build: lokaler Testserver statt Nostr' }
  el.innerHTML = `${st.state === 'dev' ? 'Viewer-Seite' : 'Über Nostr'}: <code></code> · <span></span> <button class="link" type="button">jetzt veröffentlichen</button>`
  el.querySelector('code').textContent = st.url.replace(/^https:\/\//, '')
  el.querySelector('span').textContent = states[st.state] ?? ''
  el.classList.toggle('error', st.state === 'error')
  el.querySelector('button').hidden = st.state === 'publishing' || st.state === 'dev'
  el.querySelector('button').addEventListener('click', () => invoke('nsite_publish'))
}
listen('nsite', (e) => renderNsite(e.payload))
invoke('nsite_status').then(renderNsite)
$('site').addEventListener('input', () => invoke('nsite_status').then(renderNsite))

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
  add('manage', 'Raumlinks verwalten …')
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
$('rooms-btn').addEventListener('click', () => invoke('rooms_window'))
listen('rooms', (e) => {
  rooms = e.payload ?? []
  renderRoomChoice()
})
Promise.all([invoke('get_settings'), invoke('rooms_list')]).then(([s, r]) => {
  settings = s ?? {}
  rooms = r ?? []
  // settings from before they were kept on the Rust side
  if (settings.keep_link == null && store.get('pv-keep') === '1') invoke('set_settings', { patch: { keep_link: true } }).then((x) => (settings = x))
  renderRoomChoice()
  pushSettings()
})

// a viewer was let into a permanent room with remote access: that share runs now
listen('remote-started', (e) => {
  const hosted = e.payload
  selected = hosted.sources ?? []
  goLive(hosted, 'control')
  setCollapsed(false)
  toast(`Remote-Zugriff in „${hosted.remote}“ – Fernsteuerung ist an.`, 'ok', 5000)
})

// ------------------------------------------------------------------ join requests

function renderRequests(list) {
  const box = $('requests')
  box.hidden = !list.length
  if (list.length) setCollapsed(false)
  box.replaceChildren(
    ...list.map((r) => {
      const row = document.createElement('div')
      row.className = 'request glass'
      row.innerHTML = '<span class="who"></span><div><strong></strong><span>möchte zusehen</span></div><button class="pill secondary" data-deny>Ablehnen</button><button class="pill primary" data-allow>Zulassen</button>'
      if (r.room) {
        const label = row.querySelector('div span')
        label.textContent = 'möchte in „'
        label.append(Object.assign(document.createElement('b'), { className: 'room', textContent: r.room }), '“ – Remote-Zugriff')
      }
      const who = row.querySelector('.who')
      who.textContent = initials(r.name || 'Gast')
      who.style.background = /^#[0-9a-f]{6}$/i.test(r.color ?? '') ? r.color : '#52525b'
      row.querySelector('strong').textContent = r.name || 'Gast'
      row.querySelector('[data-allow]').addEventListener('click', () => invoke('admit', { peer: r.peer, allow: true }))
      row.querySelector('[data-deny]').addEventListener('click', () => invoke('admit', { peer: r.peer, allow: false }))
      return row
    }),
  )
  if (list.length > 1) {
    const all = document.createElement('button')
    all.className = 'pill secondary all'
    all.textContent = `Alle ${list.length} zulassen`
    all.addEventListener('click', () => invoke('admit', { allow: true }))
    box.append(all)
  }
}
listen('join-requests', (e) => renderRequests(e.payload ?? []))
listen('ended', () => renderRequests([]))

// ------------------------------------------------------------------ shared clipboard (own window)

$('clip-btn').addEventListener('click', () => invoke('clip_window', {}).catch((e) => error(String(e))))
listen('clip-window', (e) => $('clip-btn').classList.toggle('open', !!e.payload))
listen('clip', (e) => {
  const n = e.payload?.length ?? 0
  $('clip-btn').title = n ? `Gemeinsame Zwischenablage (${n})` : 'Gemeinsame Zwischenablage'
})

function error(msg) {
  $('error').textContent = msg ?? ''
  $('error').hidden = !msg
  if (msg) openPanel(currentPanel ?? 'picker')
}

// ------------------------------------------------------------------ panel

let currentPanel = null
setTimeout(() => store.get('pv-collapsed') && setCollapsed(true))

function openPanel(which) {
  if (which && document.body.classList.contains('collapsed')) setCollapsed(false)
  currentPanel = which
  saveUi()
  $('panel').hidden = !which
  $('picker').hidden = which !== 'picker'
  $('settings').hidden = which !== 'settings'
  if (which !== 'picker') invoke('highlight', { sources: [] })
  else invoke('highlight', { sources: selected })
}

$('share-btn').addEventListener('click', () => {
  if (currentPanel === 'picker') return openPanel(null)
  openPanel('picker')
  loadSources()
})
$('settings-btn').addEventListener('click', () => openPanel(currentPanel === 'settings' ? null : 'settings'))
$('quit-btn').addEventListener('click', () => invoke('quit'))
window.addEventListener('keydown', (e) => e.key === 'Escape' && !sharing && openPanel(null))

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
      card.querySelector('strong').textContent = s.kind === 'window' ? s.app : s.title
      card.querySelector('span').textContent = s.kind === 'window' ? s.title : s.app
      card.title = `${s.app} – ${s.title}`
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
  invoke('highlight', { sources: selected })
}

function updateStart() {
  $('start').disabled = !selected.length
  const n = selected.filter((x) => x.startsWith('window:')).length
  $('start-label').textContent = sharing ? (n > 1 ? `${n} Fenster teilen` : 'Wechseln') : n > 1 ? `${n} Fenster teilen` : 'Freigabe starten'
}

async function loadSources() {
  renderGrid(true)
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
  invoke('highlight', { sources: selected })
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab)
    renderGrid()
  })
}
$('refresh').addEventListener('click', loadSources)

// ------------------------------------------------------------------ sharing

async function start() {
  error()
  if (!selected.length) return
  if (sharing) return switchSource()
  const status = await invoke('permission_status')
  if (!status.screen) return invoke('request_permission', { kind: 'screen' })

  const name = $('name').value.trim() || 'Host'
  store.set('pv-name', $('name').value.trim())
  $('start').disabled = true
  try {
    // "Letzten Link beibehalten": the same room secret and presenter key as last time;
    // a permanent room: its secret and key
    const choice = invite ? 'new' : $('room-choice').value
    const keep = choice === 'keep'
    let kept = keep ? { room: store.get('pv-keep-room'), key: store.get('pv-keep-key') } : {}
    if (choice.startsWith('room:')) {
      const k = await invoke('room_keys', { id: choice.slice(5) })
      kept = { room: k.secret, key: k.signingKey }
    }
    const hosted = await invoke('start_share', {
      site: site(),
      name,
      sources: selected,
      room: $('room').value.trim() || kept.room || null,
      signingKey: kept.key || null,
      color: invite?.color ?? null,
      relays: invite?.relays ?? lines('relays'),
      ice: invite?.ice ?? null,
      turnUrls: lines('turn-urls'),
      turnSecret: $('turn-secret').value.trim() || null,
    })
    if (keep) {
      store.set('pv-keep-room', hosted.secret)
      store.set('pv-keep-key', hosted.signingKey)
    }
    goLive(hosted, 'view')
    // the link is ready to paste right away
    invoke('copy_text', { text: hosted.link })
      .then(() => {
        markCopied()
        toast('Link in der Zwischenablage – einfach einfügen und verschicken.')
      })
      .catch(() => {})
  } catch (e) {
    error(String(e))
    if (String(e).includes('Bildschirmaufnahme')) invoke('request_permission', { kind: 'screen' })
  } finally {
    updateStart()
  }
}

function goLive(hosted, mode) {
  link = hosted.link
  $('code').textContent = 'Link kopieren'
  $('code-btn').title = `${sharedTitle() ? `Geteilt: ${sharedTitle()}\n` : ''}Klicken, um den Link zum Zuschauen zu kopieren`
  voice.setSelf(0, hosted.ice)
  setMode(mode, false)
  renderAvatars([])
  showLive(true)
}

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
    $('code-btn').title = `${sharedTitle() ? `Geteilt: ${sharedTitle()}\n` : ''}Klicken, um den Link zum Zuschauen zu kopieren`
    openPanel(null)
    toast(`Jetzt geteilt: ${sharedTitle() || 'neue Auswahl'}`)
  } catch (e) {
    error(String(e))
  } finally {
    updateStart()
  }
}

$('switch-btn').addEventListener('click', () => {
  if (currentPanel === 'picker') return openPanel(null)
  openPanel('picker')
  loadSources()
})

function showLive(live) {
  sharing = live
  document.body.classList.toggle('sharing', live)
  updateStart()
  $('name').hidden = live
  $('bar-idle').hidden = live
  $('bar-live').hidden = !live
  openPanel(null)
}

async function setMode(mode, send = true) {
  for (const b of document.querySelectorAll('.modes button')) b.classList.toggle('active', b.dataset.mode === mode)
  if (!send) return
  invoke('set_mode', { mode })
  if (mode !== 'control') invoke('dismiss_permission', { kind: 'accessibility' })
  else if (!(await invoke('permission_status')).accessibility) invoke('request_permission', { kind: 'accessibility' })
}

function renderAvatars(peers) {
  const viewers = peers.filter((p) => !p.host)
  const box = $('avatars')
  box.title = viewers.length ? viewers.map((p) => p.name).join('\n') : 'Noch keine Zuschauer'
  if (!viewers.length) {
    box.innerHTML = '<span class="none">0 Zuschauer</span>'
    return
  }
  box.replaceChildren(
    ...viewers.slice(0, 4).map((p) => {
      const avatar = document.createElement('span')
      avatar.style.background = p.color
      avatar.textContent = initials(p.name)
      return avatar
    }),
  )
  if (viewers.length > 4) box.insertAdjacentHTML('beforeend', `<span class="more">+${viewers.length - 4}</span>`)
}

$('start').addEventListener('click', start)
$('stop-btn').addEventListener('click', () => invoke('stop_share'))
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode))

$('code-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link)
  } catch {
    const tmp = Object.assign(document.createElement('textarea'), { value: link })
    document.body.append(tmp)
    tmp.select()
    document.execCommand('copy')
    tmp.remove()
  }
  markCopied()
})

function markCopied() {
  const chip = $('code-btn')
  chip.classList.add('copied')
  chip.lastElementChild.outerHTML = icon('check', 17)
  setTimeout(() => {
    chip.classList.remove('copied')
    chip.lastElementChild.outerHTML = icon('link', 17)
  }, 1500)
}

listen('peers', (e) => {
  renderAvatars(e.payload)
  voice.setPeers(e.payload)
})
listen('rtc', (e) => voice.handle(e.payload))
$('mic-btn').addEventListener('click', () => {
  if (voice.on) voice.stop()
  else voice.start().catch(() => toast('Kein Zugriff auf das Mikrofon.', 'info'))
})

listen('ended', (e) => {
  invoke('dismiss_permission', { kind: 'accessibility' })
  voice.stop()
  endRecordingUi()
  showLive(false)
  if (e.payload) error(e.payload)
})

// ------------------------------------------------------------------ invitations (peekaview://share?…)

function applyInvite(data) {
  invite = data
  saveUi()
  $('invite').hidden = !invite
  if (!invite) return
  if (invite.site) $('site').value = invite.site
  $('room').value = invite.room ?? ''
  if (invite.name) $('name').value = invite.name
  $('invite-room').textContent = 'Einladung zu einer Bildschirmfreigabe'
  // always show where the viewers will watch
  $('invite-server').textContent = invite.site ? `Zuschauer-Website: ${new URL(invite.site).host}` : 'Zuschauer sind über die einladende Anwendung verbunden'
  if (!sharing) {
    openPanel('picker')
    loadSources()
  }
}

$('invite-clear').addEventListener('click', () => {
  applyInvite(null)
  $('site').value = store.get('pv-site') ?? DEFAULT_SITE
  $('room').value = ''
})
listen('invite', (e) => applyInvite(e.payload))
invoke('take_invite').then((data) => data && applyInvite(data))

// ------------------------------------------------------------------ macOS permissions

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
    toast('Super – die Fernsteuerung ist freigeschaltet!')
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

// ------------------------------------------------------------------ session recording

// Own microphone + all voice chat partners, mixed to 16 kHz mono PCM and streamed to the
// recorder (which transcribes it in chunks).
async function startAudio(ctx) {
  const sink = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  sink.connect(mute).connect(ctx.destination)
  let mic = null
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch {
    toast('Kein Mikrofon – das Transkript enthält nur die anderen Stimmen.', 'info', 5000)
  }
  const nodes = new Map()
  const sync = () => {
    const streams = [mic, ...voice.remoteStreams()].filter((s) => s?.getAudioTracks().length)
    for (const s of streams) {
      if (nodes.has(s)) continue
      const node = ctx.createMediaStreamSource(s)
      node.connect(sink)
      nodes.set(s, node)
    }
    for (const [s, node] of nodes) {
      if (!streams.includes(s)) {
        node.disconnect()
        nodes.delete(s)
      }
    }
  }
  sync()
  let parts = []
  let count = 0
  sink.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    const pcm = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff
    parts.push(pcm)
    count += pcm.length
    if (count < ctx.sampleRate) return
    const all = new Int16Array(count)
    let offset = 0
    for (const p of parts) {
      all.set(p, offset)
      offset += p.length
    }
    parts = []
    count = 0
    invoke('recording_audio', new Uint8Array(all.buffer))
  }
  return {
    sync,
    stop() {
      sink.onaudioprocess = null
      mic?.getTracks().forEach((t) => t.stop())
      ctx.close()
    },
  }
}

async function startRecording() {
  // created inside the click so the browser lets it start
  const ctx = new AudioContext({ sampleRate: 16000 })
  const now = new Date()
  let engine
  try {
    engine = await invoke('start_recording', {
      local: $('local-stt').checked,
      key: $('openai-key').value.trim() || null,
      useEnv: $('use-env').checked,
      title: sharedTitle() || 'Bildschirmfreigabe',
      startedLabel: now.toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }),
      fileStamp: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`,
    })
  } catch (e) {
    ctx.close()
    return toast(String(e), 'info', 5000)
  }
  recording = { started: Date.now(), audio: await startAudio(ctx) }
  $('rec-btn').classList.add('live')
  $('rec-btn').title = 'Aufzeichnung beenden und Bericht erstellen'
  $('rec-time').hidden = false
  const tick = () => {
    const s = Math.floor((Date.now() - recording.started) / 1000)
    $('rec-time').textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
  }
  tick()
  recording.timer = setInterval(tick, 1000)
  toast(`Aufzeichnung läuft · Transkript: ${engine}`, 'info', 5000)
}

function endRecordingUi() {
  if (!recording) return
  recording.audio.stop()
  clearInterval(recording.timer)
  recording = null
  $('rec-btn').classList.remove('live')
  $('rec-btn').title = 'Sitzung aufzeichnen'
  $('rec-time').hidden = true
}

async function stopRecording() {
  endRecordingUi()
  toast('Bericht wird erstellt …', 'info', 60000)
  try {
    await invoke('stop_recording')
    toast('Bericht gespeichert und geöffnet')
  } catch (e) {
    toast(String(e), 'info', 5000)
  }
}

$('rec-btn').addEventListener('click', () => (recording ? stopRecording() : startRecording()))
listen('report', () => toast('Bericht gespeichert und geöffnet'))

// transcription settings (kept on this computer)
$('local-stt-row').hidden = !isMac
$('local-stt').checked = store.get('pv-local-stt') !== 'false'
$('openai-key').value = store.get('pv-openai-key') ?? ''
$('use-env').checked = store.get('pv-use-env') === 'true'
$('local-stt').addEventListener('change', () => store.set('pv-local-stt', String($('local-stt').checked)))
$('openai-key').addEventListener('change', () => store.set('pv-openai-key', $('openai-key').value.trim()))
$('use-env').addEventListener('change', () => {
  store.set('pv-use-env', String($('use-env').checked))
  $('openai-key').disabled = $('use-env').checked
})
$('openai-key').disabled = $('use-env').checked
invoke('env_key_status').then((at) => ($('env-status').textContent = at ? `– gefunden: ${at}` : '– nicht gefunden'))

// ------------------------------------------------------------------ continue after a restart

// e.g. macOS "Beenden & erneut öffnen" after granting a permission
function saveUi() {
  store.set('pv-ui', JSON.stringify({ at: Date.now(), panel: currentPanel, selected, kind, invite }))
}

async function restoreUi() {
  let ui
  try {
    ui = JSON.parse(store.get('pv-ui') ?? 'null')
  } catch {}
  if (!ui || Date.now() - ui.at > 3 * 60 * 1000) return
  if (ui.invite) applyInvite(ui.invite)
  kind = ui.kind ?? 'screen'
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.kind === kind)
  if (ui.panel) {
    openPanel(ui.panel)
    if (ui.panel === 'picker') {
      selected = Array.isArray(ui.selected) ? ui.selected : ui.selected ? [ui.selected] : []
      await loadSources()
    }
  }
}

invoke('resume')
  .then(async (hosted) => {
    if (!hosted) return restoreUi()
    if (hosted.site) $('site').value = hosted.site
    selected = hosted.sources ?? (hosted.source ? [hosted.source] : [])
    sources = await invoke('list_sources').catch(() => [])
    goLive(hosted, hosted.mode)
    const justGranted = await permissionCheck.catch(() => false)
    toast(justGranted ? 'Super – es kann losgehen! Deine Freigabe läuft weiter.' : 'Freigabe fortgesetzt – alle sind wieder verbunden.', 'ok', 5000)
  })
  .catch((e) => error(String(e)))
