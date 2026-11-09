// The script of share-helper.html (kept out of the page: the site's Content-Security-Policy allows
// scripts only from files of its own origin – see deploy/_headers).
// The helper of "Bildschirmfreigabe light": inside the share's small window (share.html?panel),
// or a window of its own (opened by share.html in a tab, or for one spot on a notification's click).
// Lays a drawing over the very spot on the presenter's screen: it jumps there, grows, and shows
// the still picture taken when the stroke started – like a pane of glass over the spot – with
// the stroke drawn again on top. The presenter can point and draw into it, too; that goes to
// the viewers. Afterwards it slips back into its corner (or closes, when it was only called
// for this spot).
//
// When it comes: the share page sends each finished stroke or point ("reveal"); it comes right
// away – but only shows on top where the browser is the active app: a browser window in the
// background never comes to the front by itself. A click on a notification does ("jump").
//
// Browser limits: only windows a page opened itself can be moved and resized (window.open
// with "popup"), and only within the screen; Firefox may forbid it
// (dom.disable_window_move_resize).
import { Annotations } from './annotate.js'
import { icon, owl } from './icons.js'
import { HOST_ID } from './light-host.js'
import { bounds, calmFollow, softMove, fit, inside, movesWindows, placeWindow, spotRect, stageInContent, usableArea, visiblePart } from './light-geometry.js'

const $ = (id) => document.getElementById(id)
$('owl').innerHTML = owl(20)
$('owl-waiting').innerHTML = owl(24)
$('stop').innerHTML = icon('stop', 14)
$('focus-close').innerHTML = icon('close', 15)
$('copy').prepend(document.createRange().createContextualFragment(icon('copy', 13)))
$('show').prepend(document.createRange().createContextualFragment(icon('draw', 13)))

const PARKED_WIDTH = 300
const SPOT = { width: 560, height: 400 }
// back into the corner after this long without anybody pointing or drawing
const AFTER_PING = 3500
const AFTER_DRAW = 6000
const params = new URLSearchParams(location.search)
// opened for a spot (a click on "Zur Stelle" or a notification): that first, then in the corner
// – or closed again (close=1: the share's own window waits in the corner)
const onDemand = params.has('jump')
const closeAfter = params.has('close')
// inside the share's own small window (share.html?panel): that window is moved, and it shows
// its own panel in the corner – this page only the spot
const embedded = window.parent !== window
const win = embedded ? window.top : window

const api = (embedded ? window.parent : window.opener)?.pvLight
if (!api) {
  document.body.textContent = 'Dieses Fenster gehört zu einer Bildschirmfreigabe im Browser. Starte sie auf peekaview.de.'
  throw new Error('no share')
}

let status = { sharing: false }
let started = false
let state = 'waiting' // waiting | parked | focus
let shown = null // the capture shown: {image, picture, monitor, screenImage} (picture: where it lies on the screen, null: unknown)
let part = null // the part of the picture (0..1) the focus shows
let stageBox = null // where the whole picture lies in the window (CSS px)
// how the picture lies in the focus: 'spot' (1:1 over its place on the screen), 'zoom' (the part
// around the drawing, fitted – where the window cannot jump there), 'whole'
let layout = null
let zoom = null // 'zoom': {center, extent} of the drawing
// 'zoom': the part shown – {x, y: its middle (0..1 of the picture), w, h: image pixels}; null: the
// drawing's. It follows the viewers' pointers calmly (calmFollow): one, the one moved last, at the
// same size – still while it moves in its middle 90 % (or only trembles); when it leaves that,
// softly once to a new part with the pointer in its middle (softMove), and still again.
let view = null
let viewFollow = {} // where it is going (calmFollow's state: goal in image pixels)
let viewMove = { done: true } // the way there (softMove)
let viewBase = null // what was seen first (image pixels)
let viewFrame = 0
const POINTER_IDLE = 2000 // ms: a pointer at rest is hidden, no longer followed
const pointers = new Map() // viewer id -> {x, y, at}
let idleTimer
// one jump after the other
let queue = Promise.resolve()
const ann = new Annotations($('stage'), { voice: false, idle: POINTER_IDLE })
if (onDemand) $('waiting').hidden = true

// ---------------------------------------------------------------- from the share page
function onStatus(s) {
  status = s
  if (s.peers) ann.handle({ t: 'peers', list: s.peers })
  if (s.sharing && !started) {
    started = true
    play($('video'), api.stream)
    if (onDemand && api.lastReveal) onJump()
    else park()
  } else if (!s.sharing && started) {
    if (!embedded) window.close()
    started = false
  }
  // (the page takes still pictures from these where the browser has no ImageCapture)
  if ((api.locatorStream ?? null) !== $('screen-video').srcObject) play($('screen-video'), api.locatorStream)
  renderBusy()
  if (state === 'parked') renderParked()
}

function play(video, stream) {
  try {
    video.srcObject = stream ?? null
    if (stream) video.play().catch(() => {})
  } catch {}
}

function onAnnotation(m) {
  if (m.t === 'peers' || m.t === 'state') return ann.handle(m)
  // cursors, hiding, clearing while something is shown (points and strokes come as "reveal")
  if (state === 'focus' && ['ptr', 'hide', 'clear', 'left'].includes(m.t)) ann.handle(m)
  if (m.t === 'ptr' && m.from !== HOST_ID && Number.isFinite(m.x) && Number.isFinite(m.y)) {
    pointers.set(m.from, { x: m.x, y: m.y, at: performance.now() })
    if (state === 'focus' && layout === 'zoom') follow()
  } else if (m.t === 'hide') pointers.delete(m.from)
  else if (m.t === 'left') pointers.delete(m.id)
}

function onReveal(r) {
  if (!started) return
  enqueue(() => showReveal(r))
}

function onJump() {
  const r = api.lastReveal
  if (r) enqueue(() => showReveal(r))
}

function enqueue(task) {
  queue = queue.then(task).catch((err) => console.warn('peekaview light helper', err))
}

async function showReveal(r) {
  const b = bounds(r.points)
  await show(r.capture, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, b)
  showWho(r.from)
  if (r.ping) {
    ann.handle({ t: 'ping', from: r.from, x: r.points[0][0], y: r.points[0][1] })
    // (the ring is short: once more)
    setTimeout(() => state === 'focus' && ann.ping(r.from, r.points[0][0], r.points[0][1]), 450)
  } else {
    await replay(r.from, r.points)
  }
  idle(r.ping ? AFTER_PING : AFTER_DRAW)
}

/** A stroke drawn again, quickly (it shows up as it was drawn). */
function replay(id, points) {
  return new Promise((done) => {
    const at = (i, s) => ann.handle({ t: 'draw', from: id, s, x: points[i][0], y: points[i][1] })
    at(0, 'start')
    if (points.length === 1) {
      at(0, 'end')
      return done()
    }
    const duration = Math.min(1200, Math.max(400, points.length * 12))
    const t0 = performance.now()
    let i = 1
    const step = () => {
      const until = Math.min(points.length, Math.ceil(((performance.now() - t0) / duration) * points.length))
      for (; i < until; i++) at(i, i === points.length - 1 ? 'end' : 'move')
      if (i < points.length) requestAnimationFrame(step)
      else done()
    }
    requestAnimationFrame(step)
  })
}

// ---------------------------------------------------------------- in the corner
function renderParked() {
  const viewers = status.viewers ?? []
  $('viewers').textContent = viewers.length === 0 ? 'Noch niemand schaut zu' : viewers.length === 1 ? `${viewers[0].name} schaut zu` : `${viewers.length} schauen zu`
  $('show').hidden = !viewers.length
  $('requests').replaceChildren(...(status.requests ?? []).map((r) => {
    const row = document.createElement('div')
    row.className = 'row request'
    row.style.animationDelay = `-${Date.now() % 2000}ms`
    row.innerHTML = '<span></span><button data-deny>Ablehnen</button><button class="primary" data-allow>Zulassen</button>'
    row.querySelector('span').textContent = `${r.name} möchte zusehen`
    row.querySelector('[data-allow]').addEventListener('click', () => api.admit(r.peer, true))
    row.querySelector('[data-deny]').addEventListener('click', () => api.admit(r.peer, false))
    return row
  }))
  placeParked()
}

// somebody draws: it shows up as soon as they let go
function renderBusy() {
  const names = status.busy ?? []
  const busy = $('busy')
  const was = busy.hidden
  busy.hidden = !names.length
  busy.querySelector('span').textContent = names.length === 1 ? `${names[0]} malt gerade …` : `${names.join(' und ')} malen gerade …`
  if (state === 'parked' && was !== busy.hidden) placeParked()
}

function park() {
  clearTimeout(idleTimer)
  if (state === 'focus') api.spotDone?.()
  if (onDemand && closeAfter) return window.close()
  state = 'parked'
  part = null
  shown = null
  ann.reset()
  $('waiting').hidden = true
  $('focus').hidden = true
  if (embedded) return
  $('parked').hidden = false
  renderParked()
}

function chrome() {
  return { x: Math.max(0, win.outerWidth - win.innerWidth), y: Math.max(0, win.outerHeight - win.innerHeight) }
}

// bottom right of the usable area of the screen
function placeParked() {
  if (state !== 'parked' || embedded) return
  const c = chrome()
  const height = Math.ceil($('parked').scrollHeight)
  const w = PARKED_WIDTH + c.x
  const h = height + c.y
  const area = usableArea(screen)
  moveWindow(area.left + area.width - w - 16, area.top + area.height - h - 16, w, h)
}

function moveWindow(left, top, width, height) {
  placeWindow(win, { left, top, width, height })
}

$('stop').addEventListener('click', () => api.stop())
// (written here, where it is clicked)
$('copy').addEventListener('click', () => api.copyLink(window))
// the presenter wants to show something: the whole picture, now
$('show').addEventListener('click', () => {
  enqueue(async () => {
    const capture = await api.capture()
    if (!capture?.image) return
    await show({ ...capture, picture: null }, null)
    showWho(HOST_ID)
    idle(AFTER_DRAW * 2)
  })
})
$('focus-close').addEventListener('click', park)
window.addEventListener('keydown', (e) => e.key === 'Escape' && state === 'focus' && park())

// ---------------------------------------------------------------- jumping to a spot

const insideShown = (p) => state === 'focus' && part && inside(p, part, layout === 'spot' ? 0.08 : 0)

/** Shows a capture: 1:1 over `center` (0..1 of the picture), large enough for `extent`. */
async function show(capture, center, extent = { w: 0, h: 0 }) {
  const stay = layout !== 'whole' && shown?.picture && capture.picture && center && insideShown(center) && Math.abs(shown.picture.left - capture.picture.left) < 2 && Math.abs(shown.picture.top - capture.picture.top) < 2
  shown = capture
  const shot = $('shot')
  shot.width = capture.image.width
  shot.height = capture.image.height
  shot.getContext('2d').drawImage(capture.image, 0, 0)
  const backdrop = $('backdrop')
  // (only 1:1 over its place: around a window that cannot jump it would be its own old picture)
  backdrop.hidden = !capture.screenImage || !center || !movesWindows(win.screen)
  if (!backdrop.hidden) {
    backdrop.width = capture.screenImage.width
    backdrop.height = capture.screenImage.height
    backdrop.getContext('2d').drawImage(capture.screenImage, 0, 0)
  }
  ann.reset()
  state = 'focus'
  // (no new pictures meanwhile – the drawing here would go out twice; the share's small window
  // shows this page instead of its panel)
  api.spotShown?.()
  $('waiting').hidden = true
  $('parked').hidden = true
  $('focus').hidden = false
  try { win.focus() } catch {}
  // the next stroke in the part shown already: no need to move
  if (stay && layout === 'zoom') {
    zoom = { center, extent }
    return
  }
  if (stay) return layoutSpot()
  const c = chrome()
  const { picture, monitor } = capture
  // (a window that cannot be moved – Firefox on a second screen – shows the whole picture instead)
  if (picture && center && movesWindows(win.screen)) {
    // large enough for the whole stroke (with a margin), at most most of the screen
    const size = {
      width: Math.min(monitor.width * 0.85, Math.max(SPOT.width, extent.w * picture.width + 160)),
      height: Math.min(monitor.height * 0.85, Math.max(SPOT.height, extent.h * picture.height + 160)),
    }
    const r = spotRect(center, picture, size, monitor)
    // the content area (not the title bar) over the spot
    moveWindow(r.left - c.x / 2, r.top - (c.y - c.x / 2), r.width + c.x, r.height + c.y)
    layoutSpot()
    // where the browser actually put it (it keeps windows on the screen)
    await new Promise((done) => setTimeout(done, 150))
    if (shown === capture) layoutSpot()
  } else if (center && !movesWindows(win.screen)) {
    // (a window that cannot be moved – Firefox on a second screen: 1:1 it would show its own old
    // picture) the part around the drawing, fitted into it – as large as it may get where it is
    zoom = { center, extent }
    view = null
    viewFollow = {}
    viewMove = { done: true }
    viewBase = null
    // (never smaller: it reaches down to the bottom)
    moveWindow(win.screenX, win.screenY, Math.max(win.outerWidth, SPOT.width + c.x), Math.max(win.outerHeight, SPOT.height + c.y))
    layoutZoom()
    await new Promise((done) => setTimeout(done, 150))
    if (shown === capture) layoutZoom()
  } else {
    const box = { width: screen.availWidth * 0.6, height: screen.availHeight * 0.6 }
    const f = fit(capture.image, box)
    const area = usableArea(screen)
    moveWindow(area.left + (area.width - f.width) / 2, area.top + (area.height - f.height) / 2, f.width + c.x, f.height + c.y)
    layoutWhole()
    await new Promise((done) => setTimeout(done, 150))
    if (shown === capture) layoutWhole()
  }
}

function layoutSpot() {
  layout = 'spot'
  const c = chrome()
  const content = { left: win.screenX + c.x / 2, top: win.screenY + c.y - c.x / 2, width: win.innerWidth, height: win.innerHeight }
  place(stageInContent(content, shown.picture))
  const b = stageInContent(content, shown.monitor)
  Object.assign($('backdrop').style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` })
  part = visiblePart(content, shown.picture)
}

function layoutWhole() {
  layout = 'whole'
  place(fit(shown.image, { width: window.innerWidth, height: window.innerHeight }))
  part = { x: 0, y: 0, w: 1, h: 1 }
}

// the drawing (with a margin, at least a quarter of the picture) as large as fits, in the middle
// where the picture's edges allow; part shown: all of the window
function layoutZoom() {
  layout = 'zoom'
  const W = window.innerWidth
  const H = window.innerHeight
  const { width: iw, height: ih } = shown.image
  const r = zoomRegion()
  const fitW = view ? view.w : r.width
  const fitH = view ? view.h : r.height
  const s = Math.min(W / fitW, H / fitH, 1)
  const sw = iw * s
  const sh = ih * s
  const at = (want, size, room) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, want)))
  const mx = view ? view.x * iw : r.x + r.width / 2
  const my = view ? view.y * ih : r.y + r.height / 2
  const left = at(W / 2 - mx * s, sw, W)
  const top = at(H / 2 - my * s, sh, H)
  place({ left, top, width: sw, height: sh })
  part = { x: Math.max(0, -left / sw), y: Math.max(0, -top / sh), w: Math.min(1, W / sw), h: Math.min(1, H / sh) }
}
/** Pointers moved: the part shown follows (a little each frame), and stays shown meanwhile. */
function follow() {
  if (idleTimer) idle(AFTER_DRAW)
  if (!viewFrame) {
    viewFrame = requestAnimationFrame(followStep)
  }
}
// (pointers coming to rest: no longer followed)
setInterval(() => state === 'focus' && layout === 'zoom' && pointers.size && follow(), 300)
/** The part holding the pointers moved lately: {x, y (middle, 0..1), w, h (image pixels)} or null. */
function viewTarget(now) {
  const active = []
  for (const [id, p] of pointers) {
    if (now - p.at > POINTER_IDLE) pointers.delete(id)
    else active.push({ ...p, id })
  }
  if (!active.length) return viewFollow.goal ? toView(viewFollow.goal) : null
  const { width: iw, height: ih } = shown.image
  // (from what is seen now: the first time, without a jump)
  viewBase ??= { x: part.x * iw, y: part.y * ih, w: part.w * iw, h: part.h * ih }
  const points = active.map((p) => ({ id: p.id, x: Math.min(1, Math.max(0, p.x)) * iw, y: Math.min(1, Math.max(0, p.y)) * ih }))
  const dt = Math.max(0, now - (viewFollow.at ?? now))
  viewFollow.at = now
  return toView(calmFollow(viewFollow, viewBase, points, dt, { width: iw, height: ih }))
}
function toView(r) {
  const { width: iw, height: ih } = shown.image
  return { x: (r.x + r.w / 2) / iw, y: (r.y + r.h / 2) / ih, w: r.w, h: r.h }
}
function followStep(now) {
  viewFrame = 0
  if (state !== 'focus' || layout !== 'zoom' || !shown) return
  const target = viewTarget(now)
  if (!target) return
  if (!view) view = toView(viewBase)
  view = softMove(viewMove, view, target, now)
  layoutZoom()
  // (there: rests)
  if (!viewMove.done) viewFrame = requestAnimationFrame(followStep)
}

/** The drawing's part of the picture (image pixels). */
function zoomRegion() {
  const { width: iw, height: ih } = shown.image
  const width = Math.min(iw, Math.max(zoom.extent.w * iw + 160, iw / 4))
  const height = Math.min(ih, Math.max(zoom.extent.h * ih + 160, ih / 4))
  const x = Math.min(iw - width, Math.max(0, zoom.center.x * iw - width / 2))
  const y = Math.min(ih - height, Math.max(0, zoom.center.y * ih - height / 2))
  return { x, y, width, height }
}

window.addEventListener('resize', () => {
  if (state !== 'focus' || !shown) return
  if (layout === 'whole') layoutWhole()
  else if (layout === 'zoom') layoutZoom()
})

function place(box) {
  // (only moved – following a pointer, each frame: the drawings move with it)
  const resized = !stageBox || Math.abs(stageBox.width - box.width) > 0.5 || Math.abs(stageBox.height - box.height) > 0.5
  stageBox = box
  Object.assign($('stage').style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
  if (resized) ann.resize()
}

function showWho(id) {
  const p = (status.peers ?? []).find((x) => x.id === id)
  const chip = $('focus-who')
  chip.textContent = ''
  const dot = document.createElement('i')
  dot.className = 'dot'
  dot.style.background = p?.color ?? '#a1a1aa'
  dot.style.boxShadow = 'none'
  chip.append(dot, id === HOST_ID ? 'Du zeigst' : `${p?.name ?? 'Jemand'} zeigt hier`)
}

function idle(ms) {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(function check() {
    // nobody lets go of a stroke halfway: wait for it
    if ((status.busy ?? []).length || down) return (idleTimer = setTimeout(check, 1000))
    park()
  }, ms)
}

// ---------------------------------------------------------------- the presenter draws here
let down = null
let lastMove = 0
const pos = (e) => {
  const r = $('stage').getBoundingClientRect()
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
}
const focusEl = $('focus')
focusEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || state !== 'focus') return
  e.preventDefault()
  focusEl.setPointerCapture?.(e.pointerId)
  const p = pos(e)
  down = { x: e.clientX, y: e.clientY, p, drawing: false }
  clearTimeout(idleTimer)
  showWho(HOST_ID)
})
focusEl.addEventListener('pointermove', (e) => {
  if (state !== 'focus') return
  const now = performance.now()
  if (now - lastMove < (down ? 16 : 33)) return
  lastMove = now
  const p = pos(e)
  if (down && !down.drawing && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
    down.drawing = true
    ann.draw(HOST_ID, 'start', down.p.x, down.p.y)
    api.annotate({ t: 'draw', s: 'start', ...down.p })
  }
  if (down?.drawing) {
    ann.draw(HOST_ID, 'move', p.x, p.y)
    api.annotate({ t: 'draw', s: 'move', ...p })
  } else {
    api.annotate({ t: 'ptr', ...p })
  }
})
const release = (e) => {
  if (!down) return
  const p = pos(e)
  if (down.drawing) {
    ann.draw(HOST_ID, 'end', p.x, p.y)
    api.annotate({ t: 'draw', s: 'end', ...p })
  } else {
    // a click: a ping
    ann.ping(HOST_ID, p.x, p.y)
    api.annotate({ t: 'ping', ...p })
  }
  down = null
  idle(AFTER_DRAW)
}
focusEl.addEventListener('pointerup', release)
focusEl.addEventListener('pointercancel', release)
focusEl.addEventListener('pointerleave', () => !down && state === 'focus' && api.annotate({ t: 'hide' }))

// (tests and debugging)
window.pvHelper = {
  get state() { return state },
  get part() { return part },
  get stage() { return stageBox },
  get layout() { return layout },
  get picture() { return shown?.picture ?? null },
  get found() { return shown?.found ?? null },
  get busy() { return $('busy').hidden ? '' : $('busy').textContent },
  onDemand,
  park,
  // (tests: it stays where it is until parked – a slow test would miss it)
  hold: () => {
    clearTimeout(idleTimer)
    idleTimer = null
  },
  get view() { return view },
}

// ---------------------------------------------------------------- connected to the share page
const unsubscribe = api.subscribe((e) => {
  if (e.kind === 'status') onStatus(e)
  else if (e.kind === 'ann') onAnnotation(e.m)
  // (not while none of the share's windows is in front: it would open behind the others)
  else if (e.kind === 'reveal' && e.jump !== false) onReveal(e.reveal)
  else if (e.kind === 'jump') onJump()
})
window.addEventListener('pagehide', () => {
  unsubscribe()
  if (state === 'focus') api.spotDone?.()
})
// the share page is gone (closed, reloaded): so is the share
setInterval(() => {
  let gone = true
  try { gone = !api.page || api.page.closed } catch {}
  if (gone && !embedded) window.close()
}, 1000)
