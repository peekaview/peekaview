// The viewer's window manager. Every shared window arrives as its own video track; here each
// gets a frame of its own that the viewer can move, scale (proportionally), minimize, maximize or
// tile – only in this browser, the presenter's windows stay as they are.
//
// Pictures are never enlarged beyond one video pixel per screen pixel (sharp text); they are
// only made smaller when there is not enough room. A single shared window or screen is shown
// without a frame, as large as possible.

import { Annotations, injectStyle } from './annotate.js'
import { icon } from './icons.js'

const BAR = 30 // title bar height (CSS px)
const GAP = 12
const MIN_SCALE = 0.12

const STYLE = `
.pv-wins { position: absolute; inset: 0; overflow: hidden; }
.pv-win { position: absolute; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; background: #000;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .1), 0 12px 32px rgba(0, 0, 0, .5); }
.pv-win.active { box-shadow: 0 0 0 1px rgba(255, 255, 255, .28), 0 14px 38px rgba(0, 0, 0, .6); }
.pv-win[hidden] { display: none !important; }
.pv-win-bar { flex: none; display: flex; align-items: center; gap: 7px; height: ${BAR}px; padding: 0 4px 0 10px; background: #18181b; color: #a1a1aa; font-size: 12px; cursor: grab; touch-action: none; user-select: none; }
.pv-win.active .pv-win-bar { background: #27272a; color: #fafafa; }
.pv-win-bar:active { cursor: grabbing; }
.pv-win-app { flex: none; display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; color: #fff; font-size: 9px; font-weight: 700; }
.pv-win-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-win-title b { font-weight: 650; }
.pv-win-flag { flex: none; color: #fde68a; font-size: 11px; }
.pv-win-bar button { flex: none; display: grid; place-items: center; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.pv-win-bar button:hover { background: rgba(255, 255, 255, .12); }
.pv-win .pv-view { position: relative; flex: none; }
.pv-win-paused { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(9, 9, 11, .72); color: #a1a1aa; font-size: 13px; text-align: center; padding: 12px; }
.pv-win-size { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none;
  background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, .35) 50%, rgba(255, 255, 255, .35) 58%, transparent 58%, transparent 70%, rgba(255, 255, 255, .35) 70%, rgba(255, 255, 255, .35) 78%, transparent 78%); }
.pv-wins.solo .pv-win { border-radius: 0; box-shadow: none; background: transparent; }
.pv-wins.solo .pv-win-bar, .pv-wins.solo .pv-win-size { display: none; }
.pv-wins.moving .pv-view { pointer-events: none; }
`

const PALETTE = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899', '#eab308', '#14b8a6']
const appColor = (name) => {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export class WindowManager {
  /**
   * @param {HTMLElement} stage
   * @param {{voice?: boolean, onChange?: () => void, onFrame?: () => void,
   *          canResize?: () => boolean, onResize?: (slot: number, pw: number, ph: number) => void,
   *          onActivate?: (slot: number) => void, onArrange?: (slot: number, x: number, y: number) => void}} options
   */
  constructor(stage, options = {}) {
    injectStyle('pv-windows-style', STYLE)
    this.options = options
    this.root = document.createElement('div')
    this.root.className = 'pv-wins solo'
    stage.prepend(this.root)
    this.wins = new Map() // slot -> win
    this.streams = new Map() // slot -> MediaStream
    this.active = null
    this.z = 1
    this.arranged = false // the viewer moved / scaled windows themselves
    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(this.root)
  }

  destroy() {
    this.observer.disconnect()
    for (const win of this.wins.values()) win.ann.destroy()
    this.root.remove()
  }

  get list() {
    return [...this.wins.values()].sort((a, b) => a.order - b.order)
  }

  get hasFrame() {
    return [...this.wins.values()].some((w) => w.frame)
  }

  /** A video track arrived (stream id "w<slot>"). */
  setStream(slot, stream) {
    this.streams.set(slot, stream)
    const win = this.wins.get(slot)
    if (win && win.video.srcObject !== stream) {
      win.video.srcObject = stream
      win.video.play().catch(() => {})
    }
  }

  /** Shared windows from the presenter's state: [{w, kind, title, app, paused, reachable}]. */
  setWindows(list, { control = false } = {}) {
    const slots = new Set(list.map((w) => w.w))
    let changed = false
    for (const [slot, win] of this.wins) {
      if (!slots.has(slot)) {
        win.ann.destroy()
        win.el.remove()
        this.wins.delete(slot)
        changed = true
      }
    }
    list.forEach((info, order) => {
      let win = this.wins.get(info.w)
      if (!win) {
        win = this.create(info.w)
        changed = true
      }
      win.order = order
      win.info = info
      const name = info.kind === 'window' ? info.app || info.title : info.title
      win.el.querySelector('.pv-win-title').innerHTML = '<b></b> <span></span>'
      win.el.querySelector('.pv-win-title b').textContent = info.kind === 'window' ? info.app : info.title
      win.el.querySelector('.pv-win-title span').textContent = info.kind === 'window' && info.title !== info.app ? info.title : ''
      win.el.title = info.kind === 'window' ? `${info.app} – ${info.title}` : info.title
      const badge = win.el.querySelector('.pv-win-app')
      badge.textContent = (name || '?').slice(0, 1).toUpperCase()
      badge.style.background = appColor(name)
      win.el.querySelector('.pv-win-flag').textContent = control && info.reachable === false && !info.paused ? 'verdeckt' : ''
      const paused = win.el.querySelector('.pv-win-paused')
      paused.hidden = !info.paused
      paused.textContent = 'Fenster ist beim Host gerade nicht sichtbar (minimiert oder auf einem anderen Desktop).'
    })
    this.root.classList.toggle('solo', this.wins.size <= 1)
    if (!this.active || !this.wins.has(this.active)) this.focus(this.list[0]?.slot ?? null)
    if (changed) {
      this.arranged = false
      this.layout()
    }
    this.options.onChange?.()
  }

  create(slot) {
    const el = document.createElement('div')
    el.className = 'pv-win'
    el.dataset.w = slot
    el.innerHTML = `
      <div class="pv-win-bar"><span class="pv-win-app"></span><span class="pv-win-title"></span><span class="pv-win-flag"></span>
        <button data-min title="Minimieren">${icon('minimize', 15)}</button><button data-max title="Maximieren">${icon('maximize', 13)}</button></div>
      <div class="pv-view"><video class="pv-screen" autoplay playsinline muted></video><div class="pv-ann"></div><div class="pv-win-paused" hidden></div></div>
      <div class="pv-win-size" title="Größe ändern (nur hier, nicht beim Host)"></div>`
    this.root.append(el)
    const video = el.querySelector('video')
    const win = { slot, el, video, view: el.querySelector('.pv-view'), ann: new Annotations(el.querySelector('.pv-ann'), { voice: this.options.voice }), x: 0, y: 0, s: 1, min: false, max: false, prev: null, frame: false, order: 0, info: {} }
    this.wins.set(slot, win)
    const stream = this.streams.get(slot)
    if (stream) {
      video.srcObject = stream
      video.play().catch(() => {})
    }
    const onFrame = () => {
      const first = !win.frame
      win.frame = true
      // the presenter's window took the size we asked for: show it 1:1 now
      if (win.resized) {
        win.resized = false
        win.s = 1
      }
      // the presenter resized the window: keep the scale, the frame follows
      this.layout(first ? undefined : win)
      this.options.onFrame?.()
    }
    video.addEventListener('loadeddata', onFrame)
    video.addEventListener('resize', onFrame)
    el.addEventListener('pointerdown', () => this.focus(slot, true), true)
    el.querySelector('[data-min]').addEventListener('click', () => this.minimize(slot))
    el.querySelector('[data-max]').addEventListener('click', () => this.toggleMax(slot))
    el.querySelector('.pv-win-bar').addEventListener('dblclick', (e) => !e.target.closest('button') && this.toggleMax(slot))
    el.querySelector('.pv-win-bar').addEventListener('pointerdown', (e) => !e.target.closest('button') && this.drag(win, e))
    el.querySelector('.pv-win-size').addEventListener('pointerdown', (e) => this.resize(win, e))
    return win
  }

  // ------------------------------------------------------------ geometry

  /** Size of a window's picture in CSS px at scale 1 (= one video pixel per screen pixel). */
  native(win) {
    const d = window.devicePixelRatio || 1
    return { w: (win.video.videoWidth || 1280) / d, h: (win.video.videoHeight || 800) / d }
  }

  area() {
    const r = this.root.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  /** Largest scale (≤ 1) at which a window fits into w × h (title bar included). */
  fitScale(win, w, h, bar = BAR) {
    const n = this.native(win)
    return Math.max(MIN_SCALE, Math.min(1, (w - 2) / n.w, (h - bar - 2) / n.h))
  }

  /** Room for one maximized window in device pixels – the presenter can resize to it. */
  viewport() {
    const a = this.area()
    const d = window.devicePixelRatio || 1
    const bar = this.wins.size > 1 ? BAR : 0
    return { w: Math.floor(a.w * d), h: Math.floor((a.h - bar) * d) }
  }

  layout(only) {
    const a = this.area()
    if (!a.w || !a.h) return
    const wins = this.list
    if (wins.length <= 1) {
      // a single window: centred, as large as allowed, no frame
      for (const win of wins) {
        win.min = false
        const n = this.native(win)
        win.s = this.fitScale(win, a.w, a.h, 0)
        win.x = (a.w - n.w * win.s) / 2
        win.y = (a.h - n.h * win.s) / 2
        this.paint(win, 0)
      }
      return
    }
    if (only) {
      this.clamp(only)
      return this.paint(only)
    }
    if (!this.arranged) return this.tile()
    for (const win of wins) {
      this.clamp(win)
      this.paint(win)
    }
  }

  /** "Resize/Anordnen erlauben": the presenter's window moves to the same relative place. */
  arrangeThere(win) {
    if (!this.options.canResize?.()) return
    const a = this.area()
    this.options.onArrange?.(win.slot, Math.max(0, win.x / a.w), Math.max(0, win.y / a.h))
  }

  /** The viewer arranged everything side by side: the presenter's windows follow (if allowed). */
  tileThere() {
    if (!this.options.canResize?.()) return
    const d = window.devicePixelRatio || 1
    for (const win of this.list.filter((w) => !w.min)) {
      const n = this.native(win)
      win.resized = true
      this.options.onResize?.(win.slot, Math.round(n.w * win.s * d), Math.round(n.h * win.s * d))
      this.arrangeThere(win)
    }
  }

  /** Side by side in a grid, each as large as it may be in its cell. */
  tile() {
    const a = this.area()
    const wins = this.list.filter((w) => !w.min)
    if (!wins.length) return
    const cols = Math.ceil(Math.sqrt(wins.length * (a.w / a.h) / 1.6)) || 1
    const rows = Math.ceil(wins.length / cols)
    const cw = (a.w - GAP * (cols + 1)) / cols
    const ch = (a.h - GAP * (rows + 1)) / rows
    wins.forEach((win, i) => {
      const n = this.native(win)
      win.max = false
      win.s = this.fitScale(win, cw, ch)
      const col = i % cols
      const row = Math.floor(i / cols)
      win.x = GAP + col * (cw + GAP) + (cw - n.w * win.s) / 2
      win.y = GAP + row * (ch + GAP) + (ch - n.h * win.s - BAR) / 2
      this.paint(win)
    })
    this.arranged = false
  }

  clamp(win) {
    const a = this.area()
    const n = this.native(win)
    win.s = Math.min(win.s, this.fitScale(win, a.w, a.h))
    const w = n.w * win.s
    // the title bar always stays reachable
    win.x = Math.min(Math.max(win.x, 60 - w), a.w - 60)
    win.y = Math.min(Math.max(win.y, 0), a.h - BAR)
  }

  paint(win, bar = BAR) {
    const n = this.native(win)
    const w = Math.round(n.w * win.s)
    const h = Math.round(n.h * win.s)
    win.el.hidden = win.min
    win.el.style.left = `${Math.round(win.x)}px`
    win.el.style.top = `${Math.round(win.y)}px`
    win.el.style.width = `${w}px`
    win.el.style.height = `${h + bar}px`
    win.view.style.width = `${w}px`
    win.view.style.height = `${h}px`
    win.el.querySelector('[data-max]').innerHTML = icon(win.max ? 'restore' : 'maximize', 13)
    win.el.querySelector('[data-max]').title = win.max ? 'Wiederherstellen' : 'Maximieren'
  }

  // ------------------------------------------------------------ window actions

  /** `byUser`: the viewer picked it – with "Resize/Anordnen erlauben" it comes to the front there, too. */
  focus(slot, byUser = false) {
    const win = this.wins.get(slot)
    if (byUser && win && this.active !== slot && this.wins.size > 1 && this.options.canResize?.()) this.options.onActivate?.(slot)
    this.active = win ? slot : null
    for (const w of this.wins.values()) w.el.classList.toggle('active', w === win)
    if (win) win.el.style.zIndex = String(++this.z)
    this.options.onChange?.()
  }

  minimize(slot) {
    const win = this.wins.get(slot)
    if (!win) return
    win.min = true
    this.paint(win)
    const next = this.list.filter((w) => !w.min).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0]
    this.focus(next?.slot ?? null)
  }

  /** From the taskbar: restore + front, or minimize the active one. */
  toggle(slot) {
    const win = this.wins.get(slot)
    if (!win) return
    if (win.min) {
      win.min = false
      this.clamp(win)
      this.paint(win)
      this.focus(slot, true)
    } else if (this.active === slot) {
      this.minimize(slot)
    } else {
      this.focus(slot, true)
    }
  }

  toggleMax(slot) {
    const win = this.wins.get(slot)
    if (!win || this.wins.size <= 1) return
    const a = this.area()
    if (win.max && win.prev) {
      Object.assign(win, win.prev, { max: false, prev: null })
    } else {
      win.prev = { x: win.x, y: win.y, s: win.s }
      const n = this.native(win)
      win.s = this.fitScale(win, a.w, a.h)
      win.x = (a.w - n.w * win.s) / 2
      win.y = (a.h - n.h * win.s - BAR) / 2
      win.max = true
    }
    this.arranged = true
    this.paint(win)
    this.focus(slot)
  }

  drag(win, e) {
    if (this.wins.size <= 1) return
    e.preventDefault()
    const bar = e.currentTarget
    bar.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY, wx: win.x, wy: win.y }
    this.root.classList.add('moving')
    const move = (ev) => {
      win.x = start.wx + ev.clientX - start.x
      win.y = start.wy + ev.clientY - start.y
      win.max = false
      this.clamp(win)
      this.paint(win)
    }
    const up = () => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      bar.removeEventListener('pointercancel', up)
      this.root.classList.remove('moving')
      this.arranged = true
      if (win.x !== start.wx || win.y !== start.wy) this.arrangeThere(win)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
  }

  /** Proportional scaling – never larger than one video pixel per screen pixel. */
  resize(win, e) {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const n = this.native(win)
    const r = win.el.getBoundingClientRect()
    this.root.classList.add('moving')
    const move = (ev) => {
      const sw = (ev.clientX - r.left) / n.w
      const sh = (ev.clientY - r.top - BAR) / n.h
      win.s = Math.max(MIN_SCALE, Math.min(1, Math.max(sw, sh)))
      win.max = false
      this.clamp(win)
      this.paint(win)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      this.root.classList.remove('moving')
      this.arranged = true
      // allowed by the presenter: their window gets this size (in our device pixels)
      if (this.options.canResize?.()) {
        const d = window.devicePixelRatio || 1
        const n = this.native(win)
        win.resized = true
        this.options.onResize?.(win.slot, Math.round(n.w * win.s * d), Math.round(n.h * win.s * d))
      }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  // ------------------------------------------------------------ input helpers

  /** The window whose picture is under a pointer event. */
  at(e) {
    const view = e.target?.closest?.('.pv-view')
    const el = view?.closest('.pv-win')
    return el ? this.wins.get(Number(el.dataset.w)) ?? null : null
  }

  /** Normalized (0..1) position of a pointer event in a window's picture. */
  pos(win, e) {
    const r = win.view.getBoundingClientRect()
    const c = (v) => Math.min(1, Math.max(0, v))
    return { x: c((e.clientX - r.left) / r.width), y: c((e.clientY - r.top) / r.height) }
  }

  /** Annotation messages: to the window they belong to, or to all. */
  handle(m) {
    if (m.w != null) this.wins.get(m.w)?.ann.handle(m)
    else for (const win of this.wins.values()) win.ann.handle(m)
  }

  reset() {
    for (const win of this.wins.values()) win.ann.reset()
  }

  clearOwn(id) {
    for (const win of this.wins.values()) win.ann.clear(id)
  }
}
