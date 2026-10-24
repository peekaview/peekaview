// Toolbar of a running share: a small bar at the top edge of the screen – link, what viewers may
// do, who watches, clipboard, voice, recording. Exists only while sharing; picking what to share
// happens in the PeekaView window.
import { icon, owl } from '../icons.js'
import { Voice } from '../voice.js'
import { renderRequests } from './requests.js'

const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const $ = (id) => document.getElementById(id)
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const pad = (n) => String(n).padStart(2, '0')

let link = ''
let title = ''
let recording = null
// the next steps below the bar, until the first viewer knocks (or "Verstanden")
let viewerCount = 0
let requestCount = 0
let guideDone = false

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

// errors of this window go to PeekaView's log
window.addEventListener('error', (e) => invoke('log_js', { message: `toolbar: ${e.message} (${e.filename}:${e.lineno})` }).catch(() => {}))
window.addEventListener('unhandledrejection', (e) => invoke('log_js', { message: `toolbar: ${e.reason}` }).catch(() => {}))

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 17)
$('logo').innerHTML = owl(24)

// ------------------------------------------------------------------ window size follows the content

// the bar's left edge stays where the user dragged it, also when requests fold out below
new ResizeObserver(() => {
  const shell = $('shell')
  const barLeft = shell.querySelector('.bar').offsetLeft
  invoke('toolbar_resize', { width: Math.ceil(shell.offsetWidth), height: Math.ceil(shell.offsetHeight), barLeft })
}).observe($('shell'))

$('grip').addEventListener('mousedown', (e) => e.button === 0 && invoke('toolbar_drag'))

function setCollapsed(collapsed) {
  document.body.classList.toggle('collapsed', collapsed)
  store.set('pv-collapsed', collapsed ? '1' : '')
  const b = $('fold-btn')
  b.title = collapsed ? 'Ausklappen' : 'Einklappen'
  b.innerHTML = icon(collapsed ? 'expand' : 'collapse', 17)
}
$('fold-btn').addEventListener('click', () => setCollapsed(!document.body.classList.contains('collapsed')))
setCollapsed(!!store.get('pv-collapsed'))

// ------------------------------------------------------------------ the running share

function updateGuide() {
  if (viewerCount || requestCount) guideDone = true
  $('guide').hidden = guideDone || !link
}
$('paste-key').textContent = /Mac/i.test(navigator.platform) ? '⌘V' : 'Strg+V'
$('guide-close').addEventListener('click', () => {
  guideDone = true
  updateGuide()
})
$('guide-copy').addEventListener('click', () => $('code-btn').click())

function show(live) {
  link = live.link
  title = live.title || ''
  $('code-btn').title = `${title ? `Geteilt: ${title}\n` : ''}Klicken, um den Link zum Zuschauen zu kopieren`
  voice.setSelf(0, live.ice)
  setMode(live.mode, false)
  updateGuide()
}
invoke('live_info').then((live) => {
  if (!live) return
  $('guide-copied').textContent = live.copied ? 'Er ist schon kopiert.' : 'Unten auf „Link nochmal kopieren“ klicken.'
  show(live)
  if (live.copied) markCopied()
})
listen('live', (e) => e.payload && show(e.payload))

async function setMode(mode, send = true) {
  for (const b of document.querySelectorAll('.modes button')) b.classList.toggle('active', b.dataset.mode === mode)
  if (!send) return
  invoke('set_mode', { mode })
  if (mode !== 'control') invoke('dismiss_permission', { kind: 'accessibility' })
  else if (!(await invoke('permission_status')).accessibility) invoke('request_permission', { kind: 'accessibility' })
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode))
// changed in the tray menu
listen('mode', (e) => setMode(String(e.payload), false))

$('code-btn').addEventListener('click', async () => {
  await invoke('copy_text', { text: link }).catch(() => navigator.clipboard.writeText(link))
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
listen('copied', markCopied)

// other windows / another screen: picked in the PeekaView window
$('switch-btn').addEventListener('click', () => invoke('show_picker', { switching: true }))
$('stop-btn').addEventListener('click', () => invoke('stop_share'))

function renderAvatars(peers) {
  const viewers = peers.filter((p) => !p.host)
  viewerCount = viewers.length
  updateGuide()
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
renderAvatars([])
invoke('peers').then((list) => Array.isArray(list) && renderAvatars(list))
listen('peers', (e) => {
  renderAvatars(e.payload)
  voice.setPeers(e.payload)
})
listen('rtc', (e) => voice.handle(e.payload))
$('mic-btn').addEventListener('click', () => {
  if (voice.on) voice.stop()
  else voice.start().catch(() => toast('Kein Zugriff auf das Mikrofon.', 'info'))
})

// ------------------------------------------------------------------ join requests (with doorbell)

listen('join-requests', (e) => {
  const list = e.payload ?? []
  requestCount = list.length
  updateGuide()
  renderRequests($('requests'), list)
  if (list.length) setCollapsed(false)
})

// ------------------------------------------------------------------ shared clipboard (own window)

$('clip-btn').addEventListener('click', () => invoke('clip_window', {}).catch((e) => toast(String(e), 'info')))
listen('clip-window', (e) => $('clip-btn').classList.toggle('open', !!e.payload))
listen('clip', (e) => {
  const n = e.payload?.length ?? 0
  $('clip-btn').title = n ? `Gemeinsame Zwischenablage (${n})` : 'Gemeinsame Zwischenablage'
})

// ------------------------------------------------------------------ toasts

let toastTimer
function toast(text, kind = 'ok', ms = 3500) {
  $('toast').querySelector('span').textContent = text
  $('toast').classList.toggle('info', kind === 'info')
  $('toast').firstElementChild.outerHTML = icon(kind === 'info' ? 'record' : 'check', 17)
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), ms)
}
listen('toast', (e) => toast(String(e.payload)))
listen('permission-granted', (e) => e.payload !== 'screen' && toast('Super – die Fernsteuerung ist freigeschaltet!'))

// the share ends: voice and recording stop; the window goes
listen('ended', () => {
  invoke('dismiss_permission', { kind: 'accessibility' })
  voice.stop()
  endRecordingUi()
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
    // transcription settings: settings window (kept on this computer)
    engine = await invoke('start_recording', {
      local: store.get('pv-local-stt') !== 'false',
      key: store.get('pv-openai-key') || null,
      useEnv: store.get('pv-use-env') === 'true',
      title: title || 'Bildschirmfreigabe',
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
