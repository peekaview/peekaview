// The script of share.html (kept out of the page: the site's Content-Security-Policy allows
// scripts only from files of its own origin – see deploy/_headers).
// "Bildschirmfreigabe light": the presenter's page. Shares with getDisplayMedia (light-host.js).
//   - Takes a still picture when somebody points or starts to draw (light-capture.js).
//   - The helper (share-helper.html) lays the drawing over the very spot on the screen, when
//     they are done: embedded in the share's small window (share.html?panel), which moves
//     there itself – or, in a tab, a window of its own. On top only where the browser is the
//     active app: a browser window in the background cannot come to the front by itself (a
//     click on a notification can bring it, where they are allowed).
// The helper reaches this page through window.parent / window.opener .pvLight.
import { HOST_COLOR, LightHost, TURN_SERVICE } from './light-host.js'
import { cropCanvas, frameCanvas, takeCapture } from './light-capture.js'
import { cropSupported, makeCropper } from './light-crop.js'
import { scaledGray } from './light-locate.js'
import { findWindows, platformOf, titleLine } from './light-windows.js'
import { monitorRect, movesWindows, placeWindow, usableArea, windowRect } from './light-geometry.js'
import { readLine, readText, readable, readerState, sameTitle, titleBar } from './light-title.js'
import { WindowPicker } from './light-pick.js'
import { covered as windowCovered, follow, grabberOf, snapRect, titleOf, titleScore } from './light-track.js'
import { documentPip, openPip, resizePip } from './light-pip.js'
import { displayCode, offerCode } from './word-code.js'
import { MiniView } from './light-mini.js'
import { dialogKind, showScreenHelp } from './light-help.js'
import { ClipPanel, browserCopyable, filesFromClipboard, readSystemClipboard, saveBlob, asPng } from './clipboard.js'
import { icon, owl } from './icons.js'
import './legal.js'

// the window "Freigabe läuft" as Picture-in-Picture (Chrome, Edge): the running controls are
// moved into it, so elements are looked for there, too
let pip = null
const $ = (id) => document.getElementById(id) ?? pip?.document.getElementById(id)
$('logo').innerHTML = owl(28)
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 18)
$('start').innerHTML = icon('share', 20) + 'Bildschirm teilen'
$('copy').innerHTML = icon('copy', 15) + 'Link kopieren'
$('stop').innerHTML = icon('stop', 15) + 'Freigabe beenden'

const MODES = [
  { id: 'view', name: 'Zusehen', note: 'nur ansehen' },
  { id: 'draw', name: 'Zeigen & Malen', note: 'zeigen, malen' },
  { id: 'control', name: 'Steuern', note: 'nur mit Desktop' },
]
const HELPER_SIZE = { width: 300, height: 132 }
const PANEL_WIDTH = 360
// the browser's screen picker is shown inside the window that asks: it needs about this much
const PICKER_ROOM = { width: 760, height: 660 }
// Chrome, Edge: the share runs in this tab, the small window "Freigabe läuft" (always on top)
// opens along the way. Else the share runs in a small window of its own (share.html?panel),
// opened from this page: picking the window, who watches, what they may do – and it jumps to
// each drawing itself; this tab may then be closed. (Popups blocked: everything here.)
const params = new URLSearchParams(location.search)
let panelWindow = null
const panel = params.has('panel')
document.body.classList.toggle('panel', panel)
let mode = MODES.some((m) => m.id === params.get('mode') && m.id !== 'control') ? params.get('mode') : 'draw'
let host = null
let helper = null
let helperBlocked = false
// a window is shared: the whole screen as well, only here, to find the window on it (never sent)
let locator = null
let locateSkipped = false
// the last still picture could not be placed on the screen: 'other-screen' | 'not-found' | null
let placeProblem = null
// not seen yet, but this page lay in front (and maybe over the window): wait for the switch
let placeWaiting = false
// Chrome, Edge: the whole screen is captured, one window of it shared (cut out here)
let cropper = null
let screenStream = null
let windowLost = false
// strokes in progress (from -> {points, capture, name}) and the last spot shown
const strokes = new Map()
let lastReveal = null
// the last still picture taken while nothing of ours lay over the window (see holdPictures)
let cleanCapture = null
const listeners = new Set()

// ---------------------------------------------------------------- name, modes
try { $('name').value = localStorage.getItem('pv-name') ?? '' } catch {}
// (the small window: the name from the tab that opened it)
try { if (panel && !$('name').value) $('name').value = window.opener?.document.getElementById('name')?.value ?? '' } catch {}
if (panel) {
  $('setup').querySelector('h1').textContent = 'Was möchtest du teilen?'
  $('name').parentElement.hidden = !!$('name').value.trim()
  $('panel-close').hidden = false
  $('start').innerHTML = icon('share', 20) + 'Bildschirm auswählen'
  // ("Beenden", as in the desktop app's toolbar)
  Object.assign($('stop'), { innerHTML: icon('stop', 15) + 'Beenden', title: 'Freigabe beenden' })
  $('run-keep').textContent = 'Schließt du dieses Fenster, endet die Freigabe.'
  // what was picked in the tab's click, handed over (else the button below asks here)
  let handed = null
  try { handed = window.opener?.pvLightPicking ?? null } catch {}
  if (params.has('debug')) qaLog({ klein: 'geöffnet', x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, bildschirm: screenNumbers() })
  if (handed) setTimeout(() => supported && $('name').value.trim() && startHere({ picking: handed }), 0)
}
$('name').addEventListener('input', () => {
  try { localStorage.setItem('pv-name', $('name').value.trim()) } catch {}
  $('name-error').hidden = true
  $('name').classList.remove('invalid')
})

function renderModes(box, note) {
  box.replaceChildren(...MODES.map((m) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.mode = m.id
    b.innerHTML = icon(m.id, 18) + '<span></span><small></small>'
    b.querySelector('span').textContent = m.name
    b.querySelector('small').textContent = m.note
    b.setAttribute('aria-pressed', String(mode === m.id))
    if (m.id === 'control') {
      b.classList.add('unavailable')
      b.title = 'Steuern geht nur mit PeekaView Desktop'
    }
    b.addEventListener('click', () => {
      if (m.id === 'control') {
        note.innerHTML = 'Steuern lassen geht nur mit <a href="download.html" target="_blank" rel="noopener" style="color:#fafafa">PeekaView Desktop</a>.'
        return
      }
      note.textContent = ''
      mode = m.id
      host?.setMode(mode)
      renderAll()
    })
    return b
  }))
}

// ---------------------------------------------------------------- start
const supported = !!navigator.mediaDevices?.getDisplayMedia && typeof RTCPeerConnection !== 'undefined'
// (what to pick is said beside the browser's dialog – light-help.js; where there is no card, Safari: one line)
if (cropSupported && !dialogKind()) Object.assign($('start-hint'), { textContent: 'Wähle im Browser gleich den ganzen Bildschirm, nicht ein einzelnes Fenster.', hidden: false })
if (!supported) {
  $('start').disabled = true
  $('start-hint').hidden = false
  $('start-hint').textContent = 'Dieser Browser kann den Bildschirm nicht teilen (auf Handys und Tablets geht das nicht). Bitte am Computer Chrome, Edge, Firefox oder Safari verwenden – oder PeekaView Desktop.'
}

$('start').addEventListener('click', start)
$('again').addEventListener('click', () => {
  $('ended').hidden = true
  $('setup').hidden = false
  start()
})
$('panel-close').addEventListener('click', () => window.close())

function nameOrAsk() {
  const name = $('name').value.trim()
  if (!name) {
    $('name').parentElement.hidden = false
    $('name-error').hidden = false
    $('name').classList.add('invalid')
    $('name').focus()
  }
  return name
}

// in the tab: the small window takes over (it asks for the screen itself – the tab may be
// closed, and with it everything it captured)
// The browser's screen picker comes right in the click, here in the tab (it would not in a
// window opened by it, without a click there). What was picked is checked here – a single
// window or tab is turned away in this tab, the small window does not even open. Then the small
// window opens, gets what was picked and does the rest. The capture belongs to this tab: it
// stays open. (The click is spent by then – after about 5 s, or in Safari at once: one more
// click, "Freigabe starten".)
let readyStream = null
async function start() {
  if (panel || !supported || !nameOrAsk()) return startHere()
  $('start-error').hidden = true
  $('start').disabled = true
  const picking = askScreen()
  helpWhile(picking)
  let stream
  try {
    stream = await picking
    if (cropSupported && surfaceOf(stream.getVideoTracks()[0]) !== 'monitor') {
      for (const t of stream.getTracks()) t.stop()
      throw Object.assign(new Error('not the whole screen'), { name: 'NotWholeScreen' })
    }
  } catch (err) {
    $('start').disabled = !supported
    return showStartError(err)
  }
  $('start').disabled = !supported
  if (params.has('debug')) qaLog({ tab: 'Bildschirm gewählt', klickNochAktiv: navigator.userActivation?.isActive ?? null })
  // (answered before the small window opens – the tab has the focus now, the question shows there)
  await askClipboardEarly()
  // (the click spent: not even tried – the browser would only show "popup blocked")
  if (navigator.userActivation && !navigator.userActivation.isActive) return startReady(stream)
  openPanel(stream)
}
function startReady(stream) {
  readyStream = stream
  $('start').hidden = true
  $('start-hint').hidden = true
  $('start-ready').hidden = false
  $('start-open').focus()
  // (stopped in the browser's bar meanwhile: back to the start)
  stream.getVideoTracks()[0]?.addEventListener('ended', () => readyStream === stream && startUnready())
}
function startUnready() {
  readyStream = null
  $('start').hidden = false
  $('start-hint').hidden = !$('start-hint').textContent
  $('start-ready').hidden = true
}
$('start-open').addEventListener('click', () => {
  const stream = readyStream
  startUnready()
  if (stream?.getVideoTracks()[0]?.readyState === 'live') openPanel(stream)
})
$('start-cancel').addEventListener('click', () => {
  for (const t of readyStream?.getTracks() ?? []) t.stop()
  startUnready()
})
function openPanel(stream) {
  const picking = Promise.resolve(stream)
  window.pvLightPicking = picking
  const width = PANEL_WIDTH
  const height = 320
  // right where it stays: in the bottom right corner of this screen (usableArea: Firefox's numbers
  // for a second screen made whole). Where it cannot be moved later – Firefox on a second
  // screen – it can only grow downwards: as high as it gets while sharing (about 630 px with
  // who watches), reaching down to the bottom (dock) while it shows less.
  const area = usableArea(screen)
  const left = Math.round(area.left + area.width - width - 16)
  // (height: the page's; the window is taller by its title and address bar, about 75 px)
  const top = Math.round(area.top + area.height - (movesWindows(screen) ? height + 75 : PICKER_ROOM.height) - 16)
  if (params.has('debug')) qaLog({ tab: 'öffnet kleines Fenster', left, top, x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, bildschirm: screenNumbers() })
  const url = `share.html?panel&mode=${mode}${params.has('debug') ? '&debug' : ''}`
  panelWindow = window.open(url, 'pv-light-panel', `popup=yes,width=${width},height=${height},left=${left},top=${top}`)
  // (popups blocked: everything here)
  if (!panelWindow) return startHere({ picking })
  $('setup').hidden = true
  $('ended').hidden = true
  $('elsewhere').hidden = false
  document.title = '● Freigabe läuft – PeekaView light'
}

// beside the browser's dialog, while it asks: where to click (light-help.js)
function helpWhile(picking) {
  const hide = showScreenHelp($('screen-help'))
  picking.then(hide, hide)
}
function askScreen() {
  try {
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, displaySurface: 'monitor' }, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include' })
  } catch (err) {
    return Promise.reject(err)
  }
}
$('elsewhere-show').addEventListener('click', () => {
  try { panelWindow?.focus() } catch {}
})
// the share ended in the small window (which closes): said here, "Noch einmal teilen" here
window.pvLightEnded = (why) => {
  panelWindow = null
  $('elsewhere').hidden = true
  $('setup').hidden = true
  $('ended').hidden = false
  $('ended-why').textContent = why || 'Niemand sieht deinen Bildschirm mehr.'
  document.title = 'Im Browser teilen – PeekaView light'
}
// the small window closed: back to the start
setInterval(() => {
  if (!panelWindow?.closed) return
  panelWindow = null
  $('elsewhere').hidden = true
  $('setup').hidden = false
  document.title = 'Im Browser teilen – PeekaView light'
}, 1000)

/** @param picking what was picked in the tab's click (the small window gets it handed over) */
function startHere({ picking = null } = {}) {
  const name = nameOrAsk()
  if (!name) return
  $('start-error').hidden = true
  // Both need the click: the screen picker, and the helper window (popup blockers let
  // windows through only right in a click). The picker first – Safari spends the click on it,
  // then the helper waits for a click of its own.
  if (!picking) {
    // (the browser's screen picker shows inside this window: room for it)
    roomy()
    picking = askScreen()
    if (!panel) helpWhile(picking)
  }
  // the helper: waits in the corner and comes to each drawing by itself – the small window is
  // that helper itself
  if (!panel && !documentPip) openHelper()
  $('start').disabled = true
  picking.then((stream) => {
    const surface = surfaceOf(stream.getVideoTracks()[0])
    // the whole screen: pick the window to show from it (where the browser can cut it out)
    if (cropSupported && surface === 'monitor') return showPick(stream, name)
    // a single window or tab: not taken – the window is picked here, from the whole screen
    // (only so drawings land where it is, and it is followed when moved)
    if (cropSupported) {
      for (const t of stream.getTracks()) t.stop()
      throw Object.assign(new Error('not the whole screen'), { name: 'NotWholeScreen' })
    }
    return begin(stream, name)
  }).catch((err) => {
    $('start').disabled = !supported
    closeHelper()
    showStartError(err)
    dock()
  })
}

function showStartError(err) {
  const [title, text] = err?.name === 'NotWholeScreen'
    ? ['Bitte „Gesamter Bildschirm“ wählen', 'Nicht ein einzelnes Fenster oder einen Tab. Keine Sorge: Danach kannst du das Teilen trotzdem auf ein einzelnes Fenster beschränken – PeekaView braucht den ganzen Bildschirm nur, um zu erkennen, wo dein Fenster liegt. Klicke noch einmal auf den Knopf.']
    : err?.name === 'NotAllowedError'
      ? ['Nichts zum Teilen ausgewählt', 'Oder der Browser hat es nicht erlaubt. Klicke noch einmal auf den Knopf.']
      : ['Das Teilen hat nicht geklappt', String(err?.message || err)]
  const box = $('start-error')
  box.replaceChildren()
  const mark = Object.assign(document.createElement('span'), { className: 'error-icon', textContent: '!' })
  const body = document.createElement('div')
  body.append(Object.assign(document.createElement('strong'), { textContent: title }), text)
  box.append(mark, body)
  // shown again: shake again
  box.hidden = true; void box.offsetWidth; box.hidden = false
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// (share.html?debug: to the local test server's log)
function qaLog(entry) {
  fetch('qa-log', { method: 'POST', body: JSON.stringify(entry) }).catch(() => {})
}
function screenNumbers() {
  return { left: screen.left, top: screen.top, availLeft: screen.availLeft, availTop: screen.availTop, width: screen.width, height: screen.height, dpr: window.devicePixelRatio }
}

// what was picked in the browser's dialog (Firefox may not say: a picture as wide and as high
// as this screen is the screen)
function surfaceOf(track) {
  const settings = track?.getSettings?.() ?? {}
  if (settings.displaySurface) return settings.displaySurface
  if (!settings.width || !settings.height) return 'monitor'
  return Math.abs(settings.width / settings.height - screen.width / screen.height) < 0.02 ? 'monitor' : 'window'
}

/** @param crop the part of the whole screen to share (pixels), null for all of it; undefined: no cutting */
async function begin(stream, name, crop) {
  if (crop !== undefined && cropSupported) {
    screenStream = stream
    cropper = makeCropper(stream.getVideoTracks()[0])
    cropper.setRect(crop)
    // every picture: is the window's title bar still where it was? Not: looked for at once
    cropper.check = stillThere
    cropper.onMiss = () => {
      // (not to be seen at all: looked for once a second – the search costs)
      if (performance.now() - missAt < (cropper?.blank ? 1000 : 250)) return
      missAt = performance.now()
      track()
    }
  }
  host = new LightHost({
    stream: cropper ? cropper.stream : stream,
    sources: cropper ? stream.getVideoTracks() : [],
    surface: cropper ? () => (cropper.rect ? 'window' : 'monitor') : undefined,
    size: cropper ? () => cropper.size : undefined,
    name,
    mode,
    // TURN credentials are only handed to peekaview.de
    turnService: location.hostname === 'peekaview.de' ? TURN_SERVICE : null,
    onChange: () => {
      renderAll()
      emit({ kind: 'status', ...status() })
    },
    onAnnotation: (m) => {
      emit({ kind: 'ann', m })
      watch(m)
    },
    onEnded: (why) => ended(why),
  })
  await host.start()
  window.pvLight.host = host
  host.onClip = renderClip
  $('src-video').srcObject = stream
  // where the browser lets a page bring a window forward
  try { helper?.focus() } catch {}
  $('setup').hidden = true
  $('running').hidden = false
  $('link').value = host.link
  $('start').disabled = false
  document.title = '● Freigabe läuft – PeekaView light'
  renderAll()
  emit({ kind: 'status', ...status() })
  dock()
  copyLink(true)
  offerWordCode()
  // a whole screen: is it the one this browser is on?
  if (host.surface === 'monitor') setTimeout(checkPlace, 500)
}

// two words for the phone, as long as the share runs (word-code.js)
let wordCode = null
async function offerWordCode() {
  const sharing = host
  try {
    const offer = await offerCode({ link: host.link, name: host.name })
    if (host !== sharing) return offer.close()
    wordCode = offer
    $('word-code-words').textContent = displayCode(offer.code)
    $('word-code').hidden = false
    dock()
  } catch {}
}

function ended(why) {
  host = null
  wordCode?.close()
  wordCode = null
  $('word-code').hidden = true
  $('word-code-words').textContent = ''
  closeClip()
  renderClip()
  cropper = null
  cleanCapture = null
  renderLive()
  screenStream = null
  windowLost = false
  for (const t of locator?.getTracks() ?? []) t.stop()
  locator = null
  locateSkipped = false
  placeProblem = null
  placeWaiting = false
  strokes.clear()
  lastReveal = null
  $('src-video').srcObject = $('src-screen').srcObject = null
  window.pvLight.host = null
  emit({ kind: 'status', ...status() })
  closeHelper()
  $('running').hidden = true
  $('ended').hidden = false
  $('ended-why').textContent = why || 'Niemand sieht deinen Bildschirm mehr.'
  document.title = 'Im Browser teilen – PeekaView light'
  closePip()
  dock()
  // the small window: closes by itself – "Freigabe beendet" shows in the tab (if it is still there;
  // else nothing is left to show). (It stays only where the browser does not let it close.)
  if (panel) {
    try { window.opener?.pvLightEnded?.(why) } catch {}
    setTimeout(() => window.close(), 0)
  }
}

// ---------------------------------------------------------------- the small window's place
// With the window "Freigabe läuft" open (Picture-in-Picture: always in front): this one as small
// as it goes, hidden behind it – everything is done there
const TUCKED = { width: 160, height: 100 }
// (that one moved by the presenter: no event for it – looked at now and then)
if (panel) setInterval(() => pip && !pip.closed && dock(), 1500)
function tuck() {
  if (!pip || pip.closed) return
  try {
    if (Math.abs(window.outerWidth - TUCKED.width) > 2 || Math.abs(window.outerHeight - TUCKED.height) > 2) window.resizeTo(TUCKED.width, TUCKED.height)
    // (the browser may keep it larger: the middle of it behind the middle of that one)
    const left = Math.round(pip.screenX + (pip.outerWidth - window.outerWidth) / 2)
    const top = Math.round(pip.screenY + (pip.outerHeight - window.outerHeight) / 2)
    if (Math.abs(window.screenX - left) > 2 || Math.abs(window.screenY - top) > 2) window.moveTo(left, top)
  } catch {}
}
// In the bottom right corner, as large as its content; larger, in the middle, to pick a window.
let spotting = false
function dock() {
  // (before the share: as large as the browser's screen picker needs)
  // (a drawing as a preview: the size it has – the preview fills it)
  if (!panel || spotting || document.body.classList.contains('pip-spotting') || (!$('pick').hidden && pickDrawing) || (!host && $('ended').hidden && $('pick').hidden)) return
  if (pip && !pip.closed) return tuck()
  const cx = Math.max(0, window.outerWidth - window.innerWidth)
  const cy = Math.max(0, window.outerHeight - window.innerHeight)
  const width = PANEL_WIDTH + cx
  let height = Math.min(Math.round(screen.availHeight * 0.9), Math.ceil(naturalHeight(document.querySelector('main'))) + cy)
  const area = usableArea(screen)
  // (not to be moved – Firefox on a second screen: its top stays where it opened; down to the
  // bottom of the screen all the same, never floating above it)
  if (!movesWindows(screen)) height = Math.max(height, area.top + area.height - window.screenY - 16)
  const left = Math.round(area.left + area.width - width - 16)
  const top = Math.round(area.top + area.height - height - 16)
  const moved = movesWindows(screen) && (Math.abs(window.screenX - left) > 2 || Math.abs(window.screenY - top) > 2)
  if (moved || Math.abs(window.outerWidth - width) > 2 || Math.abs(window.outerHeight - height) > 2) placeWindow(window, { left, top, width, height })
}
// how tall it is by its content (small windows: without the room kept between it and the footer;
// the live preview as tall as it would like to be)
const LIVE_ROOM = 150
function naturalHeight(el) {
  const gap = $('run-gap')
  const live = $('live-view')
  let height = el.scrollHeight - (el.contains(gap) ? gap.offsetHeight : 0)
  if (el.contains(live) && !live.hidden) height += LIVE_ROOM - live.offsetHeight
  return height
}
function roomy() {
  if (!panel || (window.outerWidth >= PICKER_ROOM.width && window.outerHeight >= PICKER_ROOM.height)) return
  const width = Math.min(PICKER_ROOM.width, screen.availWidth)
  const height = Math.min(PICKER_ROOM.height, screen.availHeight)
  const area = usableArea(screen)
  placeWindow(window, { left: area.left + (area.width - width) / 2, top: area.top + (area.height - height) / 2, width, height })
}
function spread() {
  if (!panel) return
  const width = Math.round(Math.min(1100, screen.availWidth * 0.85))
  const height = Math.round(screen.availHeight * 0.88)
  const area = usableArea(screen)
  placeWindow(window, { left: area.left + (area.width - width) / 2, top: area.top + (area.height - height) / 2, width, height })
}
if (panel) {
  new ResizeObserver(() => requestAnimationFrame(dock)).observe(document.querySelector('main'))
  setTimeout(dock, 50)
}

$('stop').addEventListener('click', () => host?.stop())
window.addEventListener('pagehide', () => host?.stop())
window.addEventListener('beforeunload', (e) => {
  if (host) e.preventDefault()
})

// ---------------------------------------------------------------- link
// Written by the window clicked in (the always-on-top one, the small one, the helper): another
// window's clipboard is not focused – Chrome refuses, or asks where it cannot be seen.
async function copyLink(quiet, from = $('copy').ownerDocument.defaultView ?? window) {
  if (!host) return
  try {
    await from.navigator.clipboard.writeText(host.link)
    toast(quiet ? 'Der Link ist schon in deiner Zwischenablage – füge ihn z. B. in eine E-Mail oder einen Chat ein.' : 'Link kopiert.')
  } catch {
    // (the old way, in that window: a hidden field copied)
    if (!quiet && copyOldWay(from.document, host.link)) return toast('Link kopiert.')
    $('link').select()
    if (!quiet) toast('Bitte den Link markieren und kopieren.')
  }
}
function copyOldWay(doc, text) {
  try {
    const field = Object.assign(doc.createElement('textarea'), { value: text, readOnly: true })
    field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    doc.body.append(field)
    field.select()
    const ok = doc.execCommand('copy')
    field.remove()
    return ok
  } catch {
    return false
  }
}
$('copy').addEventListener('click', () => copyLink(false))
$('link').addEventListener('focus', () => $('link').select())

let toastTimer
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000)
}

// ---------------------------------------------------------------- requests, viewers
const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const who = (p) => {
  const el = document.createElement('span')
  el.className = 'who'
  el.textContent = initials(p.name || 'Gast')
  el.style.background = p.color || '#52525b'
  return el
}
let knownRequests = new Set()

// ---------------------------------------------------------------- the shared clipboard
// As in the desktop app: files, pictures, text put in by anybody, copied or saved by everybody
// else. Held in this tab (light-clip.js) until the share ends.
let clipPanel = null
const clipItems = () => host?.clip.all().map((it) => ({ ...host.clip.meta(it), preview: it.preview })) ?? []
// where the panel is (the window "Freigabe läuft" may be a Picture-in-Picture one)
const clipWindow = () => $('clip-box').ownerDocument.defaultView ?? window
async function clipboardReadState(w = window) {
  try {
    return (await w.navigator.permissions.query({ name: 'clipboard-read' })).state
  } catch {
    return 'unknown'
  }
}
// Chrome, Edge: reading the clipboard ("Einfügen" in the shared clipboard) is asked for right after
// the screen is picked, here in the tab – later its question would hide behind the always-on-top
// window. (Firefox, Safari ask differently, each time: not here.)
async function askClipboardEarly() {
  if (!documentPip || (await clipboardReadState()) !== 'prompt') return
  // (not answered: the share goes on all the same)
  await Promise.race([navigator.clipboard.readText().catch(() => {}), new Promise((done) => setTimeout(done, 20000))])
}
function renderClip() {
  const n = host?.clip.all().length ?? 0
  $('clip-count').hidden = !n
  $('clip-count').textContent = String(n)
  clipPanel?.setItems(clipItems())
}
function clipNotice(err) {
  clipPanel?.toast(String(err?.message ?? err), { error: true })
}
function clipAdd(files) {
  for (const f of files) host?.clip.addFile(f).catch(clipNotice)
}
function openClip() {
  if (!host) return
  if (clipPanel) return clipPanel.focus()
  const box = $('clip-box')
  box.hidden = false
  $('clip-open').setAttribute('aria-expanded', 'true')
  const win = clipWindow()
  clipPanel = new ClipPanel(box, {
    fill: true,
    peer: (id) => (id === 0 ? { name: `${host.name} (du)`, color: HOST_COLOR } : host.viewerList.find((v) => v.id === id) ?? {}),
    mine: () => true,
    canCopy: browserCopyable,
    onClose: closeClip,
    actions: {
      add: clipAdd,
      addFromPaste: (data) => clipAdd(filesFromClipboard(data)),
      // (read by the window clicked in – the always-on-top one: asked there, never hidden behind it;
      // not allowed yet there: pasting with the keys needs no asking)
      paste: async () => {
        const w = clipWindow()
        const keys = () => clipNotice(`Bitte hier ${/Mac/.test(navigator.platform) ? '⌘V' : 'Strg+V'} drücken.`)
        if (w !== window && (await clipboardReadState(w)) !== 'granted') return keys()
        readSystemClipboard(w.navigator)
          .then((list) => (list.length ? clipAdd(list) : clipNotice('Die Zwischenablage ist leer.')))
          .catch(keys)
      },
      copy: (item) => {
        const blob = host?.clip.blobOf(item.id)
        if (!blob) return clipNotice('Nicht mehr vorhanden.')
        const image = item.mime.startsWith('image/')
        const data = image ? asPng(blob) : Promise.resolve(new Blob([blob], { type: 'text/plain' }))
        // (the window clicked in writes: the always-on-top one, if the panel is there)
        const w = clipWindow()
        w.navigator.clipboard
          .write([new w.ClipboardItem({ [image ? 'image/png' : 'text/plain']: data })])
          .then(() => clipPanel?.toast('In die Zwischenablage kopiert'))
          .catch(() => clipNotice('Kopieren nicht möglich – bitte speichern.'))
      },
      save: (item) => {
        const blob = host?.clip.blobOf(item.id)
        if (blob) saveBlob(blob, item.name)
        else clipNotice('Nicht mehr vorhanden.')
      },
      remove: (item) => host?.clip.remove(item.id, 0),
    },
  })
  shareStyles(box.ownerDocument)
  clipPanel.setItems(clipItems())
  clipPanel.focus()
  if (pip && win === pip && !pipLarge) resizePip(pip, { width: PIP_SMALL.width, height: Math.min(720, Math.ceil(naturalHeight(pip.document.body)) + 8) })
  dock()
}
function closeClip() {
  clipPanel?.destroy()
  clipPanel = null
  $('clip-box').hidden = true
  $('clip-open').setAttribute('aria-expanded', 'false')
  dock()
}
$('clip-open').addEventListener('click', () => (clipPanel ? closeClip() : openClip()))
// styles made by scripts (adopted sheets) in another document too: the always-on-top window
function shareStyles(doc) {
  if (doc === document) return
  for (const sheet of document.adoptedStyleSheets ?? []) {
    const text = [...sheet.cssRules].map((r) => r.cssText).join('\n')
    const key = String(text.length) + text.slice(0, 40)
    if ([...doc.querySelectorAll('style[data-shared]')].some((st) => st.dataset.shared === key)) continue
    const style = doc.createElement('style')
    style.dataset.shared = key
    style.textContent = text
    doc.head.append(style)
  }
}

function renderAll() {
  renderLive()
  renderModes($('setup-modes'), $('setup-mode-note'))
  renderModes($('running-modes'), $('running-mode-note'))
  renderModes($('footer-modes'), $('footer-mode-note'))
  if (!host) return
  const requests = host.requestList
  const fresh = requests.some((r) => !knownRequests.has(r.peer))
  knownRequests = new Set(requests.map((r) => r.peer))
  if (fresh) dingDong()
  $('requests-box').hidden = !requests.length
  $('requests').replaceChildren(...requests.map((r) => {
    const row = document.createElement('div')
    row.className = 'request'
    row.style.animationDelay = `0s, -${Date.now() % 2000}ms`
    row.innerHTML = '<div><strong></strong><span>möchte deinen Bildschirm sehen</span></div><button class="pill" type="button" data-deny>Ablehnen</button><button class="pill primary" type="button" data-allow>Zulassen</button>'
    row.prepend(who(r))
    row.querySelector('strong').textContent = r.name
    row.querySelector('[data-allow]').addEventListener('click', () => host?.admit(r.peer, true))
    row.querySelector('[data-deny]').addEventListener('click', () => host?.admit(r.peer, false))
    return row
  }))
  if (requests.length > 1) {
    const all = Object.assign(document.createElement('button'), { type: 'button', className: 'pill primary' })
    all.innerHTML = icon('check', 14) + `Alle ${requests.length} zulassen`
    all.addEventListener('click', () => host?.admitAll())
    $('requests').append(all)
  }
  const viewers = host.viewerList
  $('viewers-title').textContent = viewers.length ? `Schauen zu (${viewers.length})` : 'Schauen zu'
  $('viewers').replaceChildren(...(viewers.length ? viewers.map((v) => {
    const li = document.createElement('li')
    li.append(who(v), v.name)
    return li
  }) : [Object.assign(document.createElement('li'), { className: 'none', textContent: 'Noch niemand – schicke den Link oben.' })]))
  renderHelper()
}

// ---------------------------------------------------------------- the helper window
// A popup (no tab): browsers only let a page move and resize windows it opened itself.
function openHelper() {
  if (helper && !helper.closed) return helper.focus()
  const area = usableArea(screen)
  const left = Math.round(area.left + area.width - HELPER_SIZE.width - 16)
  const top = Math.round(area.top + area.height - HELPER_SIZE.height - 16)
  helper = window.open('share-helper.html', 'pv-light-helper', `popup=yes,width=${HELPER_SIZE.width},height=${HELPER_SIZE.height},left=${left},top=${top}`)
  helperBlocked = !helper
  renderHelper()
}
function closeHelper() {
  try { helper?.close() } catch {}
  helper = null
}
// closed by the presenter (or never opened): offer it again
setInterval(() => {
  if (helper?.closed) {
    helper = null
    if (!panel && spotting) window.pvLight.spotDone()
    renderHelper()
  }
}, 1000)
$('helper-open').addEventListener('click', openHelper)

function renderHelper() {
  renderNotify()
  $('pip-step').hidden = !(documentPip && host && !pip)
  $('helper').hidden = documentPip && !panel
  if (host) {
    // (small windows: who watches, by name – there is no list there)
    const names = host.viewerList.map((v) => v.name)
    const who = names.length === 0 ? 'noch niemand schaut zu' : names.length === 1 ? `${names[0]} schaut zu` : names.length === 2 ? `${names[0]} und ${names[1]} schauen zu` : `${names[0]}, ${names[1]} und ${names.length - 2} weitere schauen zu`
    $('live-title').textContent = panel || pip
      ? `Freigabe läuft · ${who}`
      : host.surface === 'monitor' ? 'Dein Bildschirm wird geteilt' : host.surface === 'browser' ? 'Dein Tab wird geteilt' : 'Dein Fenster wird geteilt'
    $('live-title').title = panel || pip ? names.join(', ') : ''
    $('repick').hidden = !cropper
    $('repick-link').hidden = !cropper
  }
  const open = panel || (!!helper && !helper.closed)
  // (a window cut out here: its place is known – nothing to look for)
  const windowShared = !!host && host.surface !== 'monitor' && !cropper
  // not placed on the screen: the helper shows the drawing in the middle
  const middle = (windowShared && !locator) || !!placeProblem
  $('locate-step').hidden = !windowShared || !!locator || locateSkipped
  renderProblem(windowShared)
  $('helper-open').hidden = open || !host
  $('helper-locate').hidden = !windowShared || !!locator || !locateSkipped
  $('helper-text').textContent = !host
    ? ''
    : !open
      ? helperBlocked
        ? 'Dein Browser hat das Fenster „Freigabe läuft“ blockiert. Klicke auf „Hilfsfenster öffnen“ – sonst siehst du nicht, wo die Zuschauer zeigen.'
        : 'Ohne das Fenster „Freigabe läuft“ siehst du nicht, wo die Zuschauer zeigen und malen.'
      : `Das Fenster „Freigabe läuft“ wartet unten rechts. Malt jemand, springt es ${middle ? 'in die Mitte deines Bildschirms' : 'genau an die Stelle'} – mit der Zeichnung – und danach zurück.`
}

// ---------------------------------------------------------------- what viewers point at and draw

const nameOf = (id) => host?.peers().list.find((p) => p.id === id)?.name ?? 'Jemand'
const busyNames = () => [...strokes.values()].map((s) => s.name)
const sourceVideos = () => {
  let inHelper = []
  try {
    if (helper && !helper.closed) inHelper = [...helper.document.querySelectorAll('video')]
  } catch {}
  try {
    inHelper.push(...$('spot').contentDocument.querySelectorAll('video'))
  } catch {}
  return [$('src-video'), $('src-screen'), ...inHelper]
}
// (while pictures are held – something of ours shown over the window – the last one without it:
// else the preview would show itself)
// A still picture is never black or empty (a frame not there yet, not painted, a capture that
// failed): taken again a few times – else the last good one. While pictures are held (something
// of ours shown over the window) the last good one right away: else the preview would show itself.
const blackPicture = (image) => {
  if (!image?.width || !image?.height) return true
  try {
    return scaledGray(image, 48, 27).px.every((v) => v < 6)
  } catch {
    return false
  }
}
const takeOne = () =>
  cropper
    ? track().then(() => takeCapture({ stream: screenStream, crop: cropper?.rect ?? null, surface: host.surface, videos: sourceVideos(), frame: cropper?.snapshot() }))
    : takeCapture({ stream: host.stream, locator, surface: host.surface, videos: sourceVideos() })
async function capture() {
  if (cropper?.paused && cleanCapture) return cleanCapture
  for (let tries = 0; ; tries++) {
    const c = await takeOne()
    if (!host) return c
    if (!blackPicture(c?.image)) {
      if (!cropper?.paused) cleanCapture = c
      return c
    }
    if (tries >= 3) return cleanCapture ?? c
    await new Promise((done) => setTimeout(done, 120))
    if (cropper?.paused && cleanCapture) return cleanCapture
  }
}

// a point right away; a stroke when it is finished – with the picture from its start
function watch(m) {
  if (!host) return
  // (the preview follows the pointer of the one shown)
  if (m.t === 'ptr') return miniView?.pointer(m.from, m.x, m.y, host.peers().list.find((p) => p.id === m.from)?.color)
  if (m.t === 'hide') return miniView?.hidePointer(m.from)
  if (m.t === 'left') {
    miniView?.hidePointer(m.id)
    if (strokes.delete(m.id)) busyChanged()
    return
  }
  if (m.t === 'ping') return reveal({ from: m.from, points: [[m.x, m.y]], ping: true, capture: capture() })
  if (m.t !== 'draw') return
  let stroke = strokes.get(m.from)
  if (m.s === 'start' || !stroke) {
    stroke = { points: [], capture: capture(), name: nameOf(m.from) }
    strokes.set(m.from, stroke)
    busyChanged()
  }
  if (stroke.points.length < 4000) stroke.points.push([m.x, m.y])
  if (m.s !== 'end') return
  strokes.delete(m.from)
  busyChanged()
  reveal({ from: m.from, points: stroke.points, capture: stroke.capture })
}

function busyChanged() {
  emit({ kind: 'status', ...status() })
}

async function reveal(r) {
  const capture = await r.capture
  showDebug('Standbild', capture)
  if (!host || !capture?.image) return
  // could it be placed? (a window needs the whole screen picked first – that is the step above)
  const problem = host.surface !== 'monitor' && !locator ? null : capture.debug?.problem ?? null
  placed(problem)
  const peer = host.peers().list.find((p) => p.id === r.from)
  lastReveal = { ...r, capture, name: peer?.name ?? 'Jemand', color: peer?.color ?? '#ef4444', at: Date.now(), note: problem === 'not-found' ? 'Dein Fenster ist nicht zu finden' : problem ? 'Anderer Bildschirm' : '' }
  // at its place (the helper, or the small window jumping there) only while a window of ours is
  // the one in front: else it would open behind the others, and only confuse – then a preview in
  // the window "Freigabe läuft", and "Am Fenster zeigen" brings it there
  const inFront = frontWindow()
  const front = !!inFront
  waiting = null
  // (Chrome: the helper opens only in a click – one just made in our window in front will do; or
  // without one, where pop-ups are allowed for the page)
  if (front && !panel && !helperOpen() && jumpHelper(inFront, { unasked: !activated(inFront) })) return
  // (the PeekaView tab in front: the small window comes before it – it is the helper)
  if (panel && front) showPanel()
  emit({ kind: 'reveal', reveal: lastReveal, jump: front })
  if (pip || (panel && !front)) showSpot(lastReveal)
  // not at its place: it goes there once a window of ours comes to the front (see jumpByItself)
  if (!front || !(panel || helperOpen())) waiting = lastReveal
  if (!front) notify(lastReveal)
}

// ---------------------------------------------------------------- the always-on-top window
// Chrome, Edge: "Freigabe läuft" as a Picture-in-Picture window (light-pip.js), opened in a
// click (the one that picks the window, or its own): the running controls move into it. A
// drawing shows there as a preview; "Ansehen" makes the window as large as it gets (only a
// click may), "Zur Stelle" lays it over the very spot, "Kleiner" shrinks it again.
// (tall enough for the controls, the footer and a join request or two without a scrollbar – it may
// grow only in a click in it)
const PIP_SMALL = { width: 360, height: 444 }
const PIP_LARGE = { width: 4000, height: 3000 }
let pipLarge = false
let miniView = null
async function openPipWindow({ initial = true, size = PIP_SMALL } = {}) {
  if (pip && !pip.closed) return
  let win
  try {
    win = await openPip(size, { initial })
  } catch {
    return renderAll()
  }
  pip = win
  // (the helper opened from there – "Zur Stelle" – finds this page)
  win.pvLight = window.pvLight
  const running = $('running')
  const toastBox = $('toast')
  win.document.body.classList.add('panel', 'pip')
  shareStyles(win.document)
  win.document.body.append(running, toastBox)
  // more to show than room (requests, viewers, the live picture): grows with the next click in it –
  // the only time it may; right after the click (grown under the pointer first, the click would hit
  // something else)
  win.document.addEventListener('click', () => {
    setTimeout(() => {
      if (pip !== win || pipLarge || win.document.body.classList.contains('pip-spotting')) return
      const want = Math.ceil(naturalHeight(win.document.body))
      if (want > win.innerHeight + 2) resizePip(win, { width: win.innerWidth, height: Math.min(720, want) })
    }, 0)
  })
  $('in-pip').hidden = false
  // (the small window itself: it stays, small – the always-on-top one belongs to it)
  if (panel) {
    $('in-pip').querySelector('strong').textContent = 'Lass dieses Fenster bitte offen.'
    $('in-pip').querySelector('.stay p').textContent = 'Schließt du es, endet die Freigabe.'
    $('in-pip').querySelector('.lead').textContent = 'Alles andere machst du im Fenster „Freigabe läuft“ – es liegt immer vorne, über allen Programmen. Am besten minimierst du dieses Fenster, damit es nicht ablenkt!'
  }
  setTimeout(dock, 0)
  // (where the browser put it is known a moment later; it may be moved or made larger)
  setTimeout(dock, 400)
  win.addEventListener('resize', () => setTimeout(dock, 100))
  // closed (by the presenter, or here): the controls back into the tab
  pipGone = () => {
    if (pip !== win) return
    pip = null
    pipGone = null
    try {
      $('in-pip').before(document.adoptNode(running))
      document.body.append(document.adoptNode(toastBox))
    } catch (err) {
      console.warn('peekaview light: controls back', err)
    }
    $('in-pip').hidden = true
    $('pip-spot').hidden = true
    setLarge(false, { resize: false })
    renderAll()
    dock()
  }
  win.addEventListener('pagehide', () => pipGone?.())
  win.addEventListener('resize', fitSpot)
  // (in front: a drawing waiting goes to its place – see jumpByItself)
  win.addEventListener('focus', () => onOwnFocus(win))
  win.document.addEventListener('click', (e) => onOwnClick(e, win), true)
  win.document.addEventListener('keydown', (e) => onOwnKey(e, win), true)
  renderAll()
}
let pipGone = null
function closePip() {
  try { pip?.close() } catch {}
  pipGone?.()
}
$('pip-open').addEventListener('click', () => openPipWindow())

// small windows: another window, by a link
$('repick-link').addEventListener('click', repick)

// the window "Freigabe läuft" itself: the always-on-top one, or the small one (Firefox) – and its document
const liveWindow = () => (pip && !pip.closed ? pip : panel ? window : null)
const spotDoc = () => (pip && !pip.closed ? pip.document : document)
/** A drawing as a preview in the window "Freigabe läuft" (the always-on-top one, or the small one). */
function showSpot(r) {
  if (!miniView) {
    miniView = new MiniView($('pip-canvas'))
    miniView.onDone = () => {
      if (!pipLarge) endSpot()
    }
  }
  $('pip-spot').hidden = false
  spotDoc().body.classList.add('pip-spotting')
  // (before it is drawn: no picture with it goes out)
  holdPictures()
  renderHint()
  fitSpot()
  miniView.reveal(r)
  renderPipButtons()
}
// the preview shaped like the room it has (the window made larger, or smaller)
function fitSpot() {
  if (!miniView || $('pip-spot').hidden) return
  const r = $('pip-canvas').getBoundingClientRect()
  miniView.fit(r.width, r.height)
}
window.addEventListener('resize', fitSpot)

// large: nothing but the drawing – and no new pictures meanwhile (the window lies over the
// screen: viewers would see the drawing twice)
function setLarge(large, { resize = true } = {}) {
  pipLarge = large
  if (!large) overlayUntil = performance.now() + 1500
  holdPictures()
  if (miniView) {
    miniView.keep = large
    // (as sharp as the screen the window may grow to)
    const dpr = pip?.devicePixelRatio ?? 1
    miniView.setScale(large ? Math.min(4, (screen.availWidth * dpr) / 640, (screen.availHeight * dpr) / 400) : 1)
    if (miniView.showing) miniView.replay()
  }
  if (pip && !pip.closed) {
    pip.document.body.classList.toggle('pip-large', large)
    if (large && resize) resizePip(pip, PIP_LARGE)
  }
  if (!large && !miniView?.showing) endSpot()
  renderPipButtons()
  // (the footer gone, or back)
  fitSpot()
}
function renderPipButtons() {
  // ("Groß anzeigen": only the always-on-top window – the small one cannot lie over everything)
  $('pip-look').hidden = pipLarge || !pip
  $('pip-jump').hidden = pipLarge
  $('pip-small').hidden = !pipLarge
}
// the controls again in place of the drawing
function endSpot() {
  $('pip-spot').hidden = true
  spotDoc().body.classList.remove('pip-spotting')
  holdPictures()
}

// Something of ours shown over the shared window – the helper with a drawing, the window "Freigabe
// läuft" large, or small with its preview lying over the window: no new pictures meanwhile, viewers
// keep the last one (else they would see it, and the preview itself, in the picture). Going on a
// moment after it is gone (moving a window away takes a moment).
let unholdTimer = null
const previewOver = () => !!liveWindow() && spotDoc().body.classList.contains('pip-spotting') && overShared(liveWindow())
function holdPictures() {
  if (!cropper) return
  if (spotting || pipLarge || previewOver()) {
    clearTimeout(unholdTimer)
    unholdTimer = null
    cropper.paused = true
  } else if (cropper.paused && !unholdTimer) {
    unholdTimer = setTimeout(() => {
      unholdTimer = null
      if (!cropper || spotting || pipLarge || previewOver()) return
      cropper.paused = false
      // (a moment more without looking for the window: no "not in its place" while it repaints)
      overlayUntil = Math.max(overlayUntil, performance.now() + 1500)
    }, 300)
  }
}
// ---------------------------------------------------------------- live, in the small windows
// What viewers see now – the very picture that goes out (held while it is held, the note while the
// window is not to be seen) – a few times a second, in the room above the footer. Not where this
// window is in that picture itself (it would show itself, again and again): a note to move it
// aside; not at all when the whole screen is shared (it always is).
let liveTicker = null
const outgoing = () => (cropper ? cropper.picture() : $('src-video').videoWidth ? $('src-video') : null)
const liveWanted = () => !!host && !!(panel || pip) && (cropper ? !!cropper.rect : host.surface !== 'monitor')
function renderLive() {
  const small = !!host && !!(panel || pip)
  $('live-view').hidden = !liveWanted()
  if (small && !liveTicker) {
    try {
      liveTicker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 333)'], { type: 'text/javascript' })))
      liveTicker.onmessage = drawLive
    } catch {
      const id = setInterval(drawLive, 333)
      liveTicker = { terminate: () => clearInterval(id) }
    }
    drawLive()
  } else if (!small && liveTicker) {
    liveTicker.terminate()
    liveTicker = null
  }
}
function drawLive() {
  const view = $('live-view')
  // (the whole screen picked instead, or a window again: the room for it changes – dock sees it)
  if (view.hidden === liveWanted()) view.hidden = !liveWanted()
  if (view.hidden || !host || view.ownerDocument.body.classList.contains('pip-spotting') || document.body.classList.contains('spotting')) return
  const own = pip && !pip.closed ? pip : panel ? window : null
  const over = !!own && overShared(own)
  $('live-note').hidden = !over
  $('live-canvas').hidden = over
  if (over) return
  const src = outgoing()
  const w = src?.displayWidth ?? src?.videoWidth ?? src?.width
  const h = src?.displayHeight ?? src?.videoHeight ?? src?.height
  if (!w || !h) return
  const canvas = $('live-canvas')
  const width = 480
  const height = Math.max(1, Math.round((width * h) / w))
  if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height })
  try {
    canvas.getContext('2d').drawImage(src, 0, 0, width, height)
  } catch {}
}

// (the window may be moved over it, or away, meanwhile)
setInterval(() => liveWindow() && spotDoc().body.classList.contains('pip-spotting') && holdPictures(), 250)
/** Whether a window of ours lies over the shared one (unknown where: yes). */
function overShared(w) {
  if (!cropper) return false
  const full = cropper.full
  const r = cropper.rect ?? { x: 0, y: 0, width: full?.width, height: full?.height }
  const mon = (lastReveal?.capture ?? cleanCapture)?.monitor ?? monitorRect(screen, { mac: /Mac/.test(navigator.platform) })
  if (!mon || !full?.width || !full?.height) return true
  try {
    const a = { left: w.screenX, top: w.screenY, width: w.outerWidth, height: w.outerHeight }
    if (!(a.width > 0 && a.height > 0)) return true
    const p = windowRect({ x: r.x / full.width, y: r.y / full.height, w: r.width / full.width, h: r.height / full.height }, mon)
    return a.left < p.left + p.width && p.left < a.left + a.width && a.top < p.top + p.height && p.top < a.top + a.height
  } catch {
    return true
  }
}
$('pip-look').addEventListener('click', () => setLarge(true))
// small again – and back in its corner: a Picture-in-Picture window cannot be moved, but one
// opened anew goes to the browser's place for it (as tall as the controls)
$('pip-small').addEventListener('click', async () => {
  miniView?.clear()
  endSpot()
  const height = Math.min(600, Math.max(PIP_SMALL.height, Math.ceil(naturalHeight($('running'))) + 28))
  closePip()
  await openPipWindow({ initial: true, size: { width: PIP_SMALL.width, height } })
})
$('pip-jump').addEventListener('click', () => jumpFrom(pip && !pip.closed ? pip : window))

// A notification – its click brings the browser forward, and the helper with it (Chrome: opened
// in that click). (Not while a window of ours is in front anyway: then it shows by itself.)
function notify(r) {
  if (typeof Notification !== 'function' || Notification.permission !== 'granted' || ownFocus()) return
  try {
    const n = new Notification(r.ping ? `${r.name} zeigt dir etwas` : `${r.name} hat etwas gemalt`, { body: 'Klicke hier, dann siehst du es genau an der Stelle.', tag: 'pv-light' })
    n.onclick = () => {
      n.close()
      try { window.focus() } catch {}
      jumpFrom(window)
    }
  } catch {}
}

// Asked before the share, beside "Bildschirm teilen" – optional, quietly, with a click of its own
// (browsers want one). (Chrome, Edge, too: the always-on-top window shows a preview, the
// notification's click brings the drawing to its place.)
function renderNotify() {
  const can = typeof Notification === 'function'
  const permission = can ? Notification.permission : 'denied'
  $('notify-opt').hidden = !can
  $('notify-on').checked = permission === 'granted'
  $('notify-on').disabled = permission !== 'default'
  $('notify-text').hidden = permission === 'default'
  $('notify-text').textContent = permission === 'granted'
    ? 'Arbeitest du in einem anderen Programm, meldet sich PeekaView. Ein Klick auf die Meldung zeigt es dir genau an der Stelle.'
    : 'Benachrichtigungen sind für diese Seite gesperrt – erlauben kannst du sie über das Symbol links neben der Adresse.'
}
$('notify-on').addEventListener('change', () => {
  if (!$('notify-on').checked) return
  Notification.requestPermission().then(renderNotify, renderNotify)
})
renderNotify()
// (allowed meanwhile in the browser's settings)
window.addEventListener('focus', renderNotify)

/** The helper over the spot of the last drawing – from a click (notification). */
let jumps = 0
let jumped = { reveal: null, at: 0 }
// (without a click: tried once a drawing – a refused pop-up shows its sign in the address bar)
let triedUnasked = null
let popupsRefused = false
/** The drawing at its place: true when it went there. `unasked`: not in a click (Chrome then opens
 *  the helper only where pop-ups are allowed for the page – else the preview stays). */
function jumpHelper(from = window, { unasked = false } = {}) {
  if (!lastReveal || !host) return false
  // (once: a click that also brought the window forward – or a notification's – jumps by itself, too)
  if (jumped.reveal === lastReveal && performance.now() - jumped.at < 1000) return true
  // the small window is the helper: in front now (the click made the browser the active
  // program), it shows the drawing again. (From the always-on-top window: a helper of its own,
  // opened in that click – the small window would not come to the front from there.)
  if (panel && from === window) {
    done()
    try { window.focus() } catch {}
    emit({ kind: 'jump' })
    return true
  }
  if (unasked && triedUnasked === lastReveal) return false
  if (unasked) triedUnasked = lastReveal
  // a helper already open may lie behind other programs, and it cannot come to the front from a
  // click elsewhere: a new one, opened in this click, always does – it waits in the corner afterwards
  let opened = null
  try {
    opened = from.open(`share-helper.html?jump=1${panel || pip ? '&close=1' : ''}`, `pv-light-spot-${++jumps}`, 'popup=yes,width=560,height=400')
  } catch {}
  if (!opened) {
    if (unasked) popupsRefused = true
    else helperBlocked = true
    renderHint()
    renderHelper()
    return false
  }
  if (unasked) popupsRefused = false
  done()
  closeHelper()
  helper = opened
  helperBlocked = false
  renderHelper()
  return true
  function done() {
    waiting = null
    jumped = { reveal: lastReveal, at: performance.now() }
    // (the preview makes room)
    miniView?.clear()
    endSpot()
  }
}
/** From a window of ours (the small window jumps itself – unless from the always-on-top one). */
function jumpFrom(from, options) {
  if (panel && from !== pip) {
    showPanel()
    return jumpHelper(window)
  }
  return jumpHelper(from, options)
}
// under the preview: the key for it – or, where a pop-up was refused, how it goes without a click
function renderHint() {
  const hint = $('pip-hint')
  if (!hint) return
  // (the small window alone: it comes to the drawing by itself once it is in front)
  hint.hidden = panel && !pip
  if (popupsRefused) hint.textContent = 'Tipp: Erlaube Pop-ups für diese Seite (Symbol rechts in der Adresszeile) – dann kommt jede Zeichnung ohne Klick an ihre Stelle.'
  else hint.innerHTML = '<kbd>Leertaste</kbd> zeigt es am Fenster'
}
renderHint()

// what the window picker found (share.html?debug): frames, title bars, titles read – and the
// picture with the frames, open
let lastPickReport = ''
function showPickDebug() {
  if (!params.has('debug') || !picker) return
  const windows = picker.windows
  // (the small window shows nothing of it: the findings go to the test server only)
  if (!panel) {
    $('debug-box').hidden = false
    if ($('debug-box').previousElementSibling?.matches('.brand') !== true) document.querySelector('main .brand').after($('debug-box'))
    $('debug-view').hidden = true
  }
  // (the picture, to look at it closely elsewhere)
  if (!panel && !$('debug-save')) {
    const save = Object.assign(document.createElement('button'), { id: 'debug-save', type: 'button', className: 'pill', textContent: 'Auswahlbild speichern (zur Analyse)' })
    save.addEventListener('click', () => picker?.image?.toBlob(async (blob) => {
      // (to the test server where there is one; else a download)
      try {
        const res = await fetch('qa-upload', { method: 'POST', body: blob })
        if (res.ok) return toast('Auswahlbild an den Testserver geschickt.')
      } catch {}
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'peekaview-auswahl.png' })
      document.body.append(a)
      a.click()
      a.remove()
    }, 'image/png'))
    $('debug-box').append(save)
  }
  const report = {
    bild: picker.image ? `${picker.image.width}x${picker.image.height}` : null,
    massstab: picker.image ? +(picker.image.width / screen.width).toFixed(2) : null,
    weg_gewesen: sawAway,
    vorne: inFront(),
    fenster: windows.length,
    aktive: windows.filter((w) => w.titled).length,
    gewaehlt: picker.selection ? (picker.selection.drawn ? 'Bereich' : picker.selection.kind ?? 'Fenster') : null,
    tesseract: readerState.state,
    geaendert_prozent: pickChanged,
    eigenes_fenster: Object.fromEntries(Object.entries(ownWindow()).map(([k, v]) => [k, +v.toFixed(3)])),
    bildschirm: { left: screen.left, top: screen.top, availLeft: screen.availLeft, width: screen.width, height: screen.height, screenX: window.screenX, screenY: window.screenY, outer: [window.outerWidth, window.outerHeight] },
    als_eigenes_weggelassen: (picker.ownLeftOut ?? []).map((w) => [w.x, w.y, w.w, w.h].map((v) => v.toFixed(3)).join(',')),
    gefunden: picker.windows.slice(0, 8).map((w) => `${[w.x, w.y, w.w, w.h].map((v) => v.toFixed(3)).join(',')} ${w.kind}${w.titled ? ' aktiv' : ''}`),
  }
  $('debug').textContent = `Fensterauswahl ${new Date().toLocaleTimeString('de-DE')}\n` + JSON.stringify(report, null, 1)
  // (to the test server where there is one, to be read there)
  const sent = JSON.stringify(report)
  if (sent !== lastPickReport) {
    lastPickReport = sent
    fetch('qa-log', { method: 'POST', body: sent }).catch(() => {})
  }
}

// how the still picture and the search went: the console, and here with share.html?debug
function showDebug(what, capture) {
  console.info(`peekaview light: ${what}`, capture?.debug)
  if (!new URLSearchParams(location.search).has('debug') || panel) return
  $('debug-box').hidden = false
  // at the top: to be seen without scrolling
  if ($('debug-box').previousElementSibling?.matches('.brand') !== true) document.querySelector('main .brand').after($('debug-box'))
  $('debug').textContent = `${what} ${new Date().toLocaleTimeString('de-DE')}\n` + JSON.stringify({ ...capture?.debug, folgen: cropper ? trackInfo : undefined, vorne: inFront() }, null, 1)
  // left: the screen with the best match (red) and the found place (green); right: the window
  const view = $('debug-view')
  const ctx = view.getContext('2d')
  const searched = capture?.searched
  if (!searched) {
    view.hidden = true
    return
  }
  view.hidden = false
  const H = 220
  const sw = Math.round((searched.screen.width * H) / searched.screen.height)
  const ww = Math.round((searched.window.width * H) / searched.window.height)
  view.width = sw + 12 + ww
  view.height = H
  ctx.drawImage(searched.screen, 0, 0, sw, H)
  ctx.drawImage(searched.window, sw + 12, 0, ww, H)
  const mark = (r, color) => {
    if (!r) return
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.strokeRect(r.x * sw, r.y * H, r.w * sw, r.h * H)
  }
  mark(searched.best, '#ef4444')
  mark(capture.found, '#22c55e')
}

// this page in front – then the browser may well lie over the shared window
const inFront = () => !document.hidden && document.hasFocus()
// a window of ours is the one in front (this page – the small window or the tab –, the always-on-top
// one, the helper)
function ownFocus() {
  return !!frontWindow()
}
function frontWindow() {
  return [pip, window, helper, ...peekaviewWindows()].find(focused) ?? null
}
function focused(w) {
  try {
    return !!w && !w.closed && !w.document.hidden && w.document.hasFocus()
  } catch {
    return false
  }
}
// a click just made in it (Chrome: a window may open only then)
function activated(w) {
  try {
    return !!w?.navigator.userActivation?.isActive
  } catch {
    return false
  }
}
const helperOpen = () => !!helper && !helper.closed
// the PeekaView tab: the one that opened the small window (in the start page's dialog: that page,
// too) – or, in the dialog, the start page around this one
function peekaviewWindows() {
  const list = []
  const add = (get) => {
    try {
      const w = get()
      if (w && w !== window && !w.closed && !list.includes(w)) list.push(w)
    } catch {}
  }
  if (panel) {
    add(() => window.opener)
    add(() => window.opener.top)
  }
  add(() => window.top)
  return list
}
// the small window in front (the PeekaView tab may focus it: it opened it)
function showPanel() {
  try { window.focus() } catch {}
  try { window.opener?.pvLightShowPanel?.() } catch {}
}

// ---------------------------------------------------------------- at its place by itself
// A drawing that came while none of our windows was in front waits as a preview (and a
// notification). Once one of them comes to the front – the window "Freigabe läuft", the
// always-on-top one, the PeekaView tab – it goes to its place by itself, while it is fresh.
// (Chrome opens the helper only in a click: there it is the click that brings the window
// forward, or one on the preview.)
const WAIT_FOR = 60000
let waiting = null // the drawing not shown at its place yet
let focusedAt = -Infinity
const waitingFresh = () => !!waiting && waiting === lastReveal && !!host && Date.now() - waiting.at < WAIT_FOR
/** At its place now, where it may be without a click: true when it went there. */
function jumpByItself(from) {
  if (!waitingFresh()) return false
  if (panel && from !== pip) return jumpFrom(from)
  if (helperOpen()) {
    waiting = null
    miniView?.clear()
    endSpot()
    emit({ kind: 'jump' })
    return true
  }
  return focused(from) && jumpHelper(from, { unasked: !activated(from) })
}
function onOwnFocus(from) {
  focusedAt = performance.now()
  // (a moment later: in front then)
  setTimeout(() => jumpByItself(from), 50)
}
// the click that brought the window forward, or one on the preview (not on a button or so)
function onOwnClick(e, from) {
  if (!waitingFresh() || e.target.closest?.('button, a, input, select, textarea, label, summary')) return
  if (!e.target.closest?.('#pip-spot') && performance.now() - focusedAt > 1500) return
  // (nothing else for this click: the window "Freigabe läuft" would grow under it)
  e.stopPropagation()
  jumpFrom(from)
}
// the space bar, in a window of ours, while a drawing waits or shows as a preview (a key counts as
// a click: Chrome opens the helper then) – not while writing
function onOwnKey(e, from) {
  if (e.key !== ' ' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
  if (!waitingFresh() && !(lastReveal && spotDoc().body.classList.contains('pip-spotting') && !pipLarge)) return
  e.preventDefault()
  e.stopPropagation()
  jumpFrom(from)
}
window.addEventListener('focus', () => onOwnFocus(window))
document.addEventListener('click', (e) => onOwnClick(e, window), true)
document.addEventListener('keydown', (e) => onOwnKey(e, window), true)
for (const w of peekaviewWindows()) {
  try {
    w.addEventListener('focus', () => onOwnFocus(w))
    w.document.addEventListener('keydown', (e) => onOwnKey(e, w), true)
  } catch {}
}
// (the tab that opened the small window: brings it to the front)
window.pvLightShowPanel = () => {
  try { panelWindow?.focus() } catch {}
}

/** The result of a search: found (null) or a problem – said only when the window could be seen. */
function placed(problem) {
  if (!problem) {
    placeProblem = null
    placeWaiting = false
  } else if (problem === 'not-found' && inFront()) {
    // the browser in front covers it: look again once the presenter switched to it
    placeProblem = null
    placeWaiting = true
  } else {
    placeProblem = problem
    placeWaiting = false
  }
  renderAll()
}

function renderProblem(windowShared) {
  const box = $('place-problem')
  if (windowLost && host) {
    box.hidden = false
    box.classList.add('problem')
    $('problem-title').textContent = 'Dein Fenster ist nicht mehr an seinem Platz'
    $('problem-text').textContent = 'Ist es verdeckt, verschoben oder geschlossen? Deine Zuschauer sehen weiter diesen Ausschnitt. Wähle das Fenster neu aus.'
    $('problem-check').hidden = true
    $('problem-screen').hidden = false
    $('problem-screen').textContent = 'Fenster neu wählen'
    return
  }
  $('problem-screen').textContent = 'Anderen Bildschirm wählen'
  // the window is not to be seen right now (this browser over it?): viewers see black
  if (host && cropper?.blank) {
    box.hidden = false
    box.classList.remove('problem')
    $('problem-title').textContent = 'Wechsle zu deinem Fenster'
    $('problem-text').textContent = 'Es ist gerade nicht zu sehen – vielleicht liegt dieser Browser darüber. Solange sehen deine Zuschauer dein letztes Bild verschwommen, mit einem Hinweis.'
    $('problem-check').hidden = $('problem-screen').hidden = true
    return
  }
  box.hidden = !host || (!placeProblem && !placeWaiting)
  box.classList.toggle('problem', !!placeProblem)
  $('problem-check').hidden = $('problem-screen').hidden = !placeProblem
  if (!placeProblem) {
    $('problem-title').textContent = 'Wechsle jetzt zu deinem geteilten Fenster'
    $('problem-text').textContent = 'PeekaView sucht es auf dem Bildschirm, sobald es zu sehen ist – gerade liegt dieser Browser darüber.'
    return
  }
  $('problem-title').textContent = windowShared ? 'Dein Fenster ist auf dem Bildschirm nicht zu finden' : 'Du teilst einen anderen Bildschirm'
  $('problem-text').textContent = placeProblem === 'other-screen'
    ? windowShared
      ? 'Der gewählte Bildschirm ist nicht der, auf dem dieser Browser ist. Wähle den Bildschirm, auf dem dein Fenster liegt.'
      : 'Der geteilte Bildschirm ist nicht der, auf dem dieser Browser ist. Zeichnungen erscheinen deshalb in der Mitte.'
    : 'Ist es minimiert oder ganz verdeckt? Hol es nach vorne – PeekaView sucht weiter. Hast du mehrere Bildschirme? Dann wähle den, auf dem dein Fenster liegt (und dieser Browser). Bis dahin erscheinen Zeichnungen in der Mitte.'
  $('problem-screen').hidden = !windowShared
}

/** Can the shared picture be placed on the screen right now? Says so when not. */
let checking = false
async function checkPlace() {
  if (!host || checking) return
  checking = true
  try {
    const c = await capture()
    showDebug('Prüfung', c)
    if (!host || !c?.image) return
    placed(c.debug?.problem ?? null)
    return !c.debug?.problem
  } finally {
    checking = false
  }
}
// not found yet: looked for again while the presenter is elsewhere (their window in front)
const lookAgain = () => host && locator && host.surface !== 'monitor' && (placeProblem || placeWaiting) && !inFront() && checkPlace()
setInterval(lookAgain, 2500)
window.addEventListener('blur', () => setTimeout(lookAgain, 800))
document.addEventListener('visibilitychange', () => setTimeout(lookAgain, 800))
$('problem-check').addEventListener('click', async () => {
  $('problem-check').disabled = true
  const ok = await checkPlace()
  $('problem-check').disabled = false
  if (ok) toast('Gefunden – Zeichnungen erscheinen jetzt genau an der Stelle.')
})
$('problem-screen').addEventListener('click', () => (windowLost ? repick() : chooseScreen()))

// ---------------------------------------------------------------- picking the window (whole screen shared)
let picker = null
let pickStream = null
let pickName = ''
let pickTimer = null
let sawAway = false // a picture from while this page was in the background (the windows not covered by it)

function showPick(stream, name) {
  pickStream = stream
  pickName = name
  // (Firefox, Safari: pictures of it from a playing video – no ImageCapture there)
  if ($('src-video').srcObject !== stream) {
    $('src-video').srcObject = stream
    $('src-video').play().catch(() => {})
  }
  sawAway = false
  pickThumb = null
  pickActive = null
  glowKey = null
  $('setup').hidden = $('running').hidden = true
  $('pick').hidden = false
  document.querySelector('main').classList.add('wide')
  // (the small window stays small – it grows only to draw a part by hand)
  pickDrawing = false
  if (!panel) spread()
  else setTimeout(dock, 0)
  picker?.destroy()
  picker = new WindowPicker($('pick-view'), { onChange: renderPick })
  if (host && cropper?.rect) {
    const f = cropper.full
    picker.selection = { x: cropper.rect.x / f.width, y: cropper.rect.y / f.height, w: cropper.rect.width / f.width, h: cropper.rect.height / f.height }
  }
  freshPicture()
  clearInterval(pickTimer)
  // fetched anew now and then – while this page is in front only where it leaves most of the
  // screen to be seen (else it would cover the windows: the picture from before stays)
  pickTimer = setInterval(freshPicture, 1500)
  renderPick()
}

let fetching = false
let pickThumb = null // the picture last looked through, small
let pickActive = null // … taken while in another program
let pickChanged = null // % of it changed since (share.html?debug)
async function freshPicture() {
  if (fetching || !picker) return
  fetching = true
  try {
    const front = inFront()
    const own = ownWindow()
    if (front && sawAway && covered(own) > 0.5) return
    const c = await frameCanvas(pickStream, sourceVideos())
    if (!c || !picker) return
    // (the windows looked for again only when a quarter of the picture changed – or right after
    // switching to another program: the window worked in then)
    // In the background (the presenter in another program, clicking from window to window): looked
    // through whenever anything changed – another window activated changes only its title bar
    const thumb = scaledGray(c, 128, 72)
    const changed = pickThumb ? thumb.px.filter((v, i) => Math.abs(v - pickThumb.px[i]) > 8).length / thumb.px.length : 1
    pickChanged = Math.round(changed * 100)
    if (changed < (front ? 0.25 : 0.0005) && pickActive === !front) return renderPick()
    pickThumb = thumb
    pickActive = !front
    picker.setImage(c, { active: !front, own })
    if (!front) sawAway = true
    renderPick()
  } finally {
    fetching = false
  }
}
window.addEventListener('focus', () => setTimeout(freshPicture, 50))
// (just switched to another program: the windows to be seen in a moment)
window.addEventListener('blur', () => setTimeout(freshPicture, 400))
document.addEventListener('visibilitychange', () => document.hidden && setTimeout(freshPicture, 400))

// this browser's window on the screen's picture (0..1): never a window to pick
function ownWindow() {
  const m = monitorRect(screen, { mac: /Mac/.test(navigator.platform) })
  return { x: (window.screenX - m.left) / m.width, y: (window.screenY - m.top) / m.height, w: window.outerWidth / m.width, h: window.outerHeight / m.height }
}
// how much of the screen it covers
function covered(r) {
  const w = Math.max(0, Math.min(1, r.x + r.w) - Math.max(0, r.x))
  const h = Math.max(0, Math.min(1, r.y + r.h) - Math.max(0, r.y))
  return w * h
}

// In the small window: the window activated, as a small picture – the whole screen only to
// draw a part by hand (the window grows for that). In a tab: the whole screen right away.
let pickDrawing = false
let glowKey = null
function renderPick() {
  if (!picker) return
  const drawing = pickDrawing || !panel
  const sel = picker.selection
  const windowSel = sel && !sel.drawn ? sel : null
  $('pick-steps').hidden = pickDrawing || (sawAway && !!windowSel)
  $('pick-lead').hidden = !pickDrawing && !sawAway && !sel
  $('pick-lead').textContent = pickDrawing
    ? sel?.drawn ? 'Dein Bereich (rot umrandet). Er bleibt fest an seiner Stelle.' : 'Zieh mit der Maus einen Rahmen um den Bereich, den du zeigen möchtest.'
    : windowSel
      ? 'Erkannt: dein aktives Fenster. Ein anderes? Klicke einfach hinein.'
      : 'Kein aktives Fenster erkannt. Klicke einmal in das Fenster, das du zeigen möchtest.'
  $('pick-view').hidden = !drawing
  $('pick-draw').hidden = !drawing || !!sel?.drawn
  $('pick-note').hidden = !drawing
  $('pick-drawing').hidden = !panel
  $('pick-drawing').textContent = pickDrawing ? 'Zurück zum Fenster' : 'Bereich selbst einzeichnen'
  // the window picked, small
  const preview = $('pick-preview')
  preview.hidden = drawing || !windowSel
  // a window newly recognized: lights up (not again for the same one in a new picture)
  const key = windowSel ? [windowSel.x, windowSel.y, windowSel.w, windowSel.h].map((v) => Math.round(v * 200)).join() : null
  if (key && key !== glowKey && !preview.hidden) {
    preview.classList.remove('glow')
    void preview.offsetWidth
    preview.classList.add('glow')
  }
  glowKey = key
  if (!preview.hidden) {
    const img = picker.image
    const sw = windowSel.w * img.width
    const sh = windowSel.h * img.height
    preview.width = 640
    preview.height = Math.max(1, Math.round((640 * sh) / sw))
    preview.getContext('2d').drawImage(img, windowSel.x * img.width, windowSel.y * img.height, sw, sh, 0, 0, preview.width, preview.height)
  }
  showPickDebug()
  const usable = pickDrawing ? sel?.drawn : panel ? !!windowSel : !!sel
  $('pick-ok').disabled = !usable
  $('pick-ok').textContent = sel?.drawn && (pickDrawing || !panel) ? 'Diesen Bereich zeigen' : 'Dieses Fenster zeigen'
}
let windowBeforeDrawing = null
$('pick-drawing').addEventListener('click', () => {
  pickDrawing = !pickDrawing
  if (picker) picker.drawing = pickDrawing
  if (pickDrawing) {
    windowBeforeDrawing = picker?.selection?.drawn ? null : picker?.selection
    // (nothing picked yet: the part is drawn now)
    if (picker && !picker.selection?.drawn) picker.selection = null
    spread()
  } else {
    // (back: the window again, not the part drawn)
    if (picker) picker.selection = windowBeforeDrawing
  }
  renderPick()
  requestAnimationFrame(() => picker?.render())
  if (!pickDrawing) setTimeout(dock, 0)
})

function finishPick(selection) {
  clearInterval(pickTimer)
  pickDrawing = false
  const image = picker.image
  picker.destroy()
  picker = null
  $('pick').hidden = true
  document.querySelector('main').classList.remove('wide')
  setTimeout(dock, 0)
  // (Chrome, Edge: the always-on-top window, in this click)
  if (documentPip) openPipWindow()
  const f = cropper?.full?.width ? cropper.full : { width: image?.width ?? 1, height: image?.height ?? 1 }
  const rect = selection ? { x: Math.round(selection.x * f.width), y: Math.round(selection.y * f.height), width: Math.round(selection.w * f.width), height: Math.round(selection.h * f.height) } : null
  // a part drawn by hand stays where it is: not followed. A window: its real edges, its title bar
  // and picture to follow it by, from the picture in which it could be seen
  fixedPart = !!selection?.drawn
  const seen = rect && !fixedPart && image && image.width === f.width ? grabberOf(image) : null
  // (one found by its title bar is exact already)
  if (seen && !selection.drawn && !selection.titled) Object.assign(rect, snapRect(seen, rect, f))
  trackTitle = seen ? titleOf(seen, rect, f.width / screen.width) : null
  trackImage = seen ? cropCanvas(image, rect) : null
  titleTexts = []
  titleReadAt = 0
  if (seen && rect) learnTitle(image, rect, f.width / screen.width)
  trackMisses = 0
  windowLost = false
  if (host) {
    cropper.setBlank(null)
    cropper.setRect(rect)
    host.update()
    $('running').hidden = false
    renderAll()
    emit({ kind: 'status', ...status() })
    return
  }
  $('setup').hidden = false
  begin(pickStream, pickName, rect)
}
$('pick-ok').addEventListener('click', () => picker?.selection && finishPick(picker.selection))
$('pick-screen').addEventListener('click', () => finishPick(null))

function repick() {
  if (!host || !cropper) return
  // (picked here, in the tab: the always-on-top window would lie over the screen's picture)
  if (pip) {
    closePip()
    try { window.focus() } catch {}
  }
  showPick(screenStream, host.name)
}
$('repick').addEventListener('click', repick)

// the picked window moved (or changed): followed by its title bar – several times a second, and
// right before each still picture (a drawing then appears where the window is now). Not to be
// seen: viewers get black with a note, never what lies there instead.
const notSeen = () => `Fenster gerade nicht verfügbar\nbei ${host?.name ?? 'der Person, die teilt'} – gleich geht es weiter`
let trackImage = null
let trackTitle = null
let trackMisses = 0
let trackInfo = null // how the last search went (share.html?debug)
let tracking = null
let fixedPart = false // a part drawn by hand: not followed
// a drawing shown over the screen (the helper at its spot, the window "Freigabe läuft" large): it
// may lie over the shared window – followed where it is found, but not missed meanwhile (and a
// moment after): no blurred picture, no "not in its place"
let overlayUntil = 0
const overlaid = () => spotting || cropper?.paused || pipLarge || performance.now() < overlayUntil
function track() {
  if (!host || !cropper?.rect || picker || fixedPart) return Promise.resolve()
  return (tracking ??= followWindow().catch((err) => console.warn('peekaview light: follow', err)).finally(() => (tracking = null)))
}
async function followWindow() {
  const full = cropper?.snapshot() ?? (await frameCanvas(screenStream, sourceVideos()))
  const r = cropper?.rect
  if (!full || !r || picker) return
  const grab = grabberOf(full)
  const scale = full.width / screen.width
  const before = trackImage ?? cropCanvas(full, r)
  const scratch = document.createElement('canvas')
  const t0 = performance.now()
  // (the window being dragged is the active one: its coloured buttons say where it is, and how large)
  const places = () => {
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    scratch.width = full.width
    scratch.height = full.height
    ctx.drawImage(full, 0, 0)
    const data = ctx.getImageData(0, 0, full.width, full.height)
    return findWindows(data)
  }
  let found = follow(grab, full, r, { title: trackTitle, windowAt: (w, h) => scaledGray(before, w, h, scratch), places })
  // (found, but a quarter or more of it covered – also when it seems to have another shape, a
  // corner of it under another window: not to be seen)
  if (found && (await windowCovered((a) => grab(a, a.width, a.height), found.rect, full))) found = null
  // (this page in front may well cover the window: a frame alone does not count then)
  const front = inFront()
  if (found && front && found.by === 'frame' && found.how !== 'same') found = null
  trackInfo = { how: found?.how ?? 'nicht gefunden', by: found?.by ?? null, score: found ? +found.score.toFixed(3) : null, ms: Math.round(performance.now() - t0), vorne: front, titel: !!trackTitle, titeltexte: titleTexts }
  if (!found && overlaid()) {
    trackMisses = 0
    return
  }
  if (!found) {
    findByTitle(full, scale)
    if (!cropper.blank) {
      cropper.setBlank(notSeen())
      renderAll()
    }
    // (said on this page after a few seconds – not while this page lies over it)
    if (!front && ++trackMisses >= 8 && !windowLost) {
      windowLost = true
      renderAll()
    }
    return
  }
  if (cropper.blank) {
    cropper.setBlank(null)
    renderAll()
  }
  trackMisses = 0
  if (windowLost) {
    windowLost = false
    renderAll()
  }
  const next = found.rect
  if (next.x !== r.x || next.y !== r.y || next.width !== r.width || next.height !== r.height) {
    cropper.setRect(next)
    host.update()
    // (larger or smaller: its title bar is, too)
    if (next.width !== r.width || next.height !== r.height) trackTitle = titleOf(grab, cropper.rect, scale)
  }
  trackImage = cropCanvas(full, cropper.rect)
  // found without its title bar (it changed: another document, another tab): take the new one
  // – and read it at once
  if (found.by !== 'title') {
    trackTitle = titleOf(grab, cropper.rect, scale)
    titleReadAt = 0
  }
  learnTitle(full, cropper.rect, scale)
}
setInterval(track, 350)

// The window's title bar in a picture of the screen, right in the video's way (light-crop.js):
// read from the frame itself (only that strip), compared with the one known.
let missAt = 0
// (src: the screen's picture right now – its size, and the brightness of a part of it)
async function stillThere(src, r) {
  const title = trackTitle
  // (a plain title bar: nothing to compare – the timer's search has to do)
  if (!title) return true
  const bx = r.x + title.band.x
  const by = r.y + title.band.y
  const strip = await src.luma({ x: bx - 2, y: by - 2, width: title.tpl.width + 6, height: title.tpl.height + 6 })
  if (!strip || strip.width < title.tpl.width || strip.height < title.tpl.height) return false
  if (titleScore(strip, title, bx - strip.x, by - strip.y) < 0.7) return false
  // … and its borders where they were, to be seen (made larger or smaller: not; a quarter or more
  // of it under another window: covered)
  return !(await windowCovered(src.luma, r, src))
}

// The window's titles, read from its title bar (light-title.js): now and then while it stays,
// and at once when its title bar changed. Gone from its place (moved, maximized, minimized and
// back), the title bars on the screen are read and it is found again by a title it had.
let titleTexts = []
let titleReadAt = 0
let titleReading = false
let titleSearchAt = 0
// the line of a window's title (light-windows.js titleLine): looked for in its top
const platform = platformOf()
function lineOf(source, rect, scale) {
  const area = { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.round(rect.width), height: Math.round(Math.min(rect.height, 70 * scale)) }
  if (area.width < 40 || area.height < 20) return null
  const l = titleLine(grabberOf(source)(area, area.width, area.height), { x: 0, y: 0, width: area.width, height: area.height }, scale, platform)
  return l && { y: l.y + area.y, x0: l.x0 + area.x, x1: l.x1 + area.x }
}

async function learnTitle(full, rect, scale) {
  if (titleReading || Date.now() - titleReadAt < 5000) return
  titleReading = true
  // (exactly the line of its title, beside its buttons – where they are found)
  const shot = titleBar(full, rect, scale, lineOf(full, rect, scale))
  try {
    const { text, confidence } = await readLine(shot)
    titleReadAt = Date.now()
    // (letter salad is no title to find it by)
    if (readable(text, confidence) && !titleTexts.some((t) => sameTitle(t, text) >= 0.9)) titleTexts = [text, ...titleTexts].slice(0, 8)
  } catch (err) {
    // (no reading – Tesseract not to be loaded: following by the title bar's picture only)
    titleReadAt = Date.now() + 60000
    console.info('peekaview light: titles not read', err?.message ?? err)
  } finally {
    titleReading = false
  }
}
async function findByTitle(full, scale) {
  if (!titleTexts.length || titleReading || Date.now() - titleSearchAt < 2500) return
  titleSearchAt = Date.now()
  titleReading = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = full.width
    canvas.height = full.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(full, 0, 0)
    const data = ctx.getImageData(0, 0, full.width, full.height)
    // the windows by their title bars (light-windows.js findWindows)
    const candidates = findWindows(data).map((w) => ({ rect: { x: w.x, y: w.y, width: w.width, height: w.height }, line: w.line }))
    let best = null
    for (const { rect, line } of candidates.slice(0, 10)) {
      const text = await readText(titleBar(full, rect, scale, line))
      const score = Math.max(0, ...titleTexts.map((t) => sameTitle(t, text)))
      if (score >= 0.6 && (!best || score > best.score)) best = { rect, score, text }
    }
    // (meanwhile found again otherwise, or the share ended: nothing to do)
    if (!best || !host || !cropper?.blank || picker) return
    const rect = best.rect
    cropper.setRect(rect)
    cropper.setBlank(null)
    trackTitle = titleOf(grabberOf(full), cropper.rect, scale)
    trackImage = cropCanvas(full, cropper.rect)
    trackMisses = 0
    windowLost = false
    trackInfo = { ...trackInfo, how: 'titeltext', score: +best.score.toFixed(2), gelesen: best.text }
    host.update()
    renderAll()
  } catch (err) {
    console.info('peekaview light: titles not read', err?.message ?? err)
  } finally {
    titleReading = false
  }
}

// ---------------------------------------------------------------- finding a shared window
$('locate').innerHTML = icon('screen', 16) + 'Bildschirm auswählen'
$('locate').addEventListener('click', chooseScreen)
$('helper-locate').addEventListener('click', chooseScreen)
$('locate-skip').addEventListener('click', () => {
  locateSkipped = true
  renderAll()
})

async function chooseScreen() {
  const error = $('locate-error')
  error.hidden = true
  let stream
  roomy()
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 5 } }, audio: false, selfBrowserSurface: 'exclude', monitorTypeSurfaces: 'include' })
  } catch (err) {
    error.textContent = err?.name === 'NotAllowedError' ? 'Kein Bildschirm ausgewählt. Versuche es noch einmal oder klicke auf „Später“.' : 'Das hat nicht geklappt: ' + (err?.message || err)
    error.hidden = false
    return
  }
  const track = stream.getVideoTracks()[0]
  if ((track.getSettings?.().displaySurface ?? 'monitor') !== 'monitor') {
    for (const t of stream.getTracks()) t.stop()
    error.textContent = 'Bitte „Gesamter Bildschirm“ wählen – nicht ein Fenster oder einen Tab.'
    error.hidden = false
    return
  }
  if (!host) return track.stop()
  for (const t of locator?.getTracks() ?? []) t.stop()
  locator = stream
  $('src-screen').srcObject = stream
  // stopped in the browser's bar: back to "in the middle"
  track.addEventListener('ended', () => {
    if (locator !== stream) return
    locator = null
    renderAll()
    emit({ kind: 'status', ...status() })
  })
  renderAll()
  emit({ kind: 'status', ...status() })
  // right away: is the window to be seen there?
  if (await checkPlace()) toast('Fertig – dein Fenster ist gefunden. Zeichnungen erscheinen genau an der Stelle.')
}

// ---------------------------------------------------------------- for the helper (window.opener.pvLight)
function status() {
  return {
    sharing: !!host,
    mode,
    surface: host?.surface ?? null,
    video: host ? host.size : null,
    viewers: host?.viewerList ?? [],
    requests: host?.requestList ?? [],
    peers: host?.peers().list ?? [],
    locator: !!locator,
    // somebody draws right now (their names)
    busy: busyNames(),
  }
}
function emit(event) {
  for (const fn of listeners) {
    try { fn(event) } catch { listeners.delete(fn) }
  }
}
window.pvLight = {
  host: null,
  page: window,
  get stream() { return host?.stream ?? null },
  get locatorStream() { return locator },
  get lastReveal() { return lastReveal },
  // a drawing waiting to go to its place by itself (see jumpByItself)
  get waiting() { return waitingFresh() },
  // the picked part of the screen, and how following it went last
  get crop() { return cropper?.rect ?? null },
  get tracked() { return trackInfo },
  get frames() { return cropper ? { ...cropper.counts, paused: cropper.paused, pausedFrames: cropper.counts.paused } : null },
  // the preview's part of the still picture (image pixels), and the pointers it follows
  get preview() { return miniView?.spot ? { crop: miniView.spot.crop, pointers: miniView.activePointers().map((p) => [p.x, p.y]), image: { width: miniView.spot.capture.image.width, height: miniView.spot.capture.image.height } } : null },
  capture: () => (host ? capture() : null),
  // is the shared window to be seen on the screen? (says so on the page)
  check: () => checkPlace(),
  status,
  subscribe(fn) {
    listeners.add(fn)
    fn({ kind: 'status', ...status() })
    return () => listeners.delete(fn)
  },
  admit: (peer, allow) => host?.admit(peer, allow),
  admitAll: () => host?.admitAll(),
  annotate: (m) => host?.annotate(m),
  copyLink: (from) => copyLink(false, from),
  stop: () => host?.stop(),
  // the helper shows a drawing over its spot, and is done: meanwhile no new pictures go out –
  // the helper is part of the screen's picture, viewers would see the drawing twice. (Inside the
  // small window, share-helper.html embedded: shown instead of the panel, then the panel again.)
  spotShown: () => {
    spotting = true
    holdPictures()
    if (!panel) return
    $('spot').hidden = false
    document.body.classList.add('spotting')
  },
  spotDone: () => {
    spotting = false
    overlayUntil = performance.now() + 1500
    // (once the helper is out of the way: moving a window takes a moment)
    holdPictures()
    if (!panel) return
    $('spot').hidden = true
    document.body.classList.remove('spotting')
    dock()
  },
}
// (created here: it finds this page's pvLight right away)
if (panel) {
  const frame = document.createElement('iframe')
  frame.id = 'spot'
  frame.hidden = true
  frame.title = 'Wo deine Zuschauer zeigen'
  frame.src = 'share-helper.html'
  document.body.append(frame)
}

let audio
// a new join request: two soft bell tones (as in PeekaView Desktop)
function dingDong() {
  try {
    audio ??= new AudioContext()
    const now = audio.currentTime
    for (const [i, f] of [[0, 880], [1, 660]]) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0, now + i * 0.28)
      g.gain.linearRampToValueAtTime(0.15, now + i * 0.28 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.28 + 0.6)
      o.connect(g).connect(audio.destination)
      o.start(now + i * 0.28)
      o.stop(now + i * 0.28 + 0.65)
    }
  } catch {}
}

renderAll()
