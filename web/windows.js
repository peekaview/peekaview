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
const NAV = 56 // soft buttons below a shared phone screen (CSS px)
const GAP = 12
const MIN_SCALE = 0.12

const STYLE = `
.pv-wins { position: absolute; inset: 0; overflow: hidden; }
.pv-win { position: absolute; display: flex; flex-direction: column; border-radius: 10px; background: #000;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .1), 0 12px 32px rgba(0, 0, 0, .5); }
.pv-win.active { box-shadow: 0 0 0 1px rgba(255, 255, 255, .28), 0 14px 38px rgba(0, 0, 0, .6); }
.pv-win[hidden] { display: none !important; }
.pv-win-bar { flex: none; display: flex; align-items: center; gap: 7px; height: ${BAR}px; padding: 0 4px 0 10px; border-radius: 10px 10px 0 0; background: #18181b; color: #a1a1aa; font-size: 12px; cursor: grab; touch-action: none; user-select: none; }
.pv-win.active .pv-win-bar { background: #27272a; color: #fafafa; }
.pv-win-bar:active { cursor: grabbing; }
.pv-win-app { flex: none; display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; color: #fff; font-size: 9px; font-weight: 700; }
.pv-win-title { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-win-title b { font-weight: 650; }
.pv-win-flag { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fde68a; font-size: 11px; }
.pv-win-bar button { flex: none; display: grid; place-items: center; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.pv-win-bar button:hover { background: rgba(255, 255, 255, .12); }
.pv-win .pv-view { position: relative; flex: none; overflow: hidden; border-radius: 0 0 10px 10px; }
.pv-win-paused { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(9, 9, 11, .72); color: #a1a1aa; font-size: 13px; text-align: center; padding: 12px; }
/* grab zones for resizing lie outside the picture – a near miss never clicks into the shared window */
.pv-grab { position: absolute; z-index: 2; touch-action: none; }
.pv-grab[data-edge="r"] { top: ${BAR}px; right: -9px; width: 9px; bottom: 6px; cursor: ew-resize; }
.pv-grab[data-edge="b"] { left: 6px; bottom: -9px; height: 9px; right: 6px; cursor: ns-resize; }
.pv-grab[data-edge="rb"] { right: -12px; bottom: -12px; width: 20px; height: 20px; cursor: nwse-resize; }
.pv-grab[data-edge="rb"]::after { content: ""; position: absolute; left: 3px; top: 3px; width: 9px; height: 9px; border-right: 2px solid rgba(255, 255, 255, .45); border-bottom: 2px solid rgba(255, 255, 255, .45); border-radius: 0 0 4px 0; opacity: 0; transition: opacity .15s; }
.pv-win:hover .pv-grab[data-edge="rb"]::after, .pv-win.sizing .pv-grab[data-edge="rb"]::after { opacity: 1; }
/* live preview while resizing: the new size (on the presenter's screen, if allowed) */
.pv-win-ghost { position: absolute; left: 0; top: 0; z-index: 3; border: 2px dashed #ef4444; border-radius: 10px; background: rgba(239, 68, 68, .07); pointer-events: none; }
.pv-win-ghost.scale { border-color: transparent; background: none; }
.pv-win-ghost span { position: absolute; right: 8px; bottom: 8px; padding: 3px 8px; border-radius: 7px; background: rgba(9, 9, 11, .85); color: #fafafa; font: 600 12px/1.3 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.pv-win-ghost small { display: block; color: #a1a1aa; font-weight: 500; font-size: 11px; }
.pv-wins.solo .pv-win { border-radius: 0; box-shadow: none; background: transparent; }
.pv-nav { position: absolute; left: 0; right: 0; top: 100%; height: ${NAV}px; display: flex; align-items: center; justify-content: center; gap: 22px; }
.pv-nav[hidden] { display: none; }
.pv-nav button { display: grid; place-items: center; width: 56px; height: 38px; padding: 0; border: 0; border-radius: 12px; background: rgba(255, 255, 255, .08); color: #e4e4e7; cursor: pointer; transition: background .15s; }
.pv-nav button:hover { background: rgba(255, 255, 255, .16); }
.pv-nav button:active { background: rgba(255, 255, 255, .26); }
.pv-wins.solo .pv-win .pv-view { border-radius: 0; }
.pv-wins.solo .pv-win-bar, .pv-wins.solo .pv-grab { display: none; }
.pv-wins.moving .pv-view { pointer-events: none; }
/* covered completely on the presenter's screen */
.pv-win.covered .pv-view video { filter: grayscale(1) brightness(.5); transition: filter .3s; }
.pv-win.covered .pv-win-bar { color: #71717a; }
/* mirror of the presenter's screen ("Resize/Anordnen erlauben") */
.pv-desk { position: absolute; border-radius: 8px; border: 1px solid rgba(255, 255, 255, .14);
  background: radial-gradient(ellipse at 30% 20%, rgba(59, 130, 246, .10), transparent 60%), linear-gradient(160deg, #1f1f24, #121215); }
.pv-desk span { position: absolute; left: 10px; bottom: 7px; color: #52525b; font: 600 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .03em; }
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
   *          onActivate?: (slot: number) => void, onArrange?: (slot: number, x: number, y: number) => void,
   *          onPlace?: (slot: number, frame: {x?: number, y?: number, hw?: number, hh?: number}) => void}} options
   *   onPlace: mirror mode – the presenter's window gets this frame (their screen coordinates)
   */
  constructor(stage, options = {}) {
    injectStyle('pv-windows-style', STYLE)
    this.options = options
    this.root = document.createElement('div')
    this.root.className = 'pv-wins solo'
    this.desks = document.createElement('div')
    this.root.append(this.desks)
    stage.prepend(this.root)
    this.mirror = false
    this.screens = []
    this.wins = new Map() // slot -> win
    this.streams = new Map() // slot -> MediaStream
    this.active = null
    this.z = 1
    this.arranged = false // the viewer moved / scaled windows themselves
    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(this.root)
    // this page lost the focus right after a window was activated: the presenter's screen is
    // this computer's (testing), and every activation takes the focus from the browser
    this.local = false
    this.onBlur = () => {
      if (Date.now() - (this.activatedAt ?? 0) < 1000) this.local = true
    }
    window.addEventListener('blur', this.onBlur)
  }

  destroy() {
    this.observer.disconnect()
    window.removeEventListener('blur', this.onBlur)
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

  /**
   * Shared windows from the presenter's state: [{w, kind, title, app, paused, reachable, rect, z}].
   * `mirror`: the viewer may arrange the presenter's windows – show them where they are on the
   * presenter's `screens`.
   */
  setWindows(list, { control = false, mirror = false, screens = [] } = {}) {
    const mirrored = !!mirror && list.length > 0 && list.every((w) => w.kind === 'window' && w.rect) && screens.length > 0
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
      // covered completely on the presenter's screen: greyed out
      const covered = info.reachable === false && !info.paused
      win.el.classList.toggle('covered', covered)
      win.el.querySelector('.pv-win-flag').textContent = covered ? 'verdeckt' : ''
      const paused = win.el.querySelector('.pv-win-paused')
      paused.hidden = !info.paused
      paused.textContent = 'Fenster ist beim Host gerade nicht sichtbar (minimiert oder auf einem anderen Desktop).'
      // a phone screen with remote control: soft buttons below it
      const nav = !!info.nav && control
      win.el.querySelector('.pv-nav').hidden = !nav
      if (nav !== !!win.nav) {
        win.nav = nav
        changed = true
      }
    })
    if (mirrored !== this.mirror) changed = true
    this.mirror = mirrored
    this.screens = screens
    this.root.classList.toggle('solo', !mirrored && this.wins.size <= 1)
    this.root.classList.toggle('mirror', mirrored)
    if (!this.active || !this.wins.has(this.active)) this.focus(this.list[0]?.slot ?? null)
    if (changed) {
      this.arranged = false
      this.layout()
    } else if (mirrored) {
      // the presenter moved / resized / restacked windows
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
      <div class="pv-nav" hidden>
        <button data-nav="back" title="Zurück"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 4.5v15L5.5 12z"/></svg></button>
        <button data-nav="home" title="Startbildschirm"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="7.5"/></svg></button>
        <button data-nav="recents" title="Zuletzt verwendete Apps"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="5" y="5" width="14" height="14" rx="2"/></svg></button>
      </div>
      <div class="pv-grab" data-edge="r"></div><div class="pv-grab" data-edge="b"></div><div class="pv-grab" data-edge="rb" title="Größe ändern"></div>`
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
        win.ghost?.remove()
      }
      // the presenter resized the window: keep the scale, the frame follows
      this.layout(first ? undefined : win)
      this.options.onFrame?.()
    }
    video.addEventListener('loadeddata', onFrame)
    video.addEventListener('resize', onFrame)
    // a click (not a drag) brings the window to the front – also at the presenter's, which is
    // done on release: activating it there may take the focus away from this page mid-drag
    el.addEventListener(
      'pointerdown',
      (e) => {
        this.focus(slot)
        const start = { x: e.clientX, y: e.clientY }
        const up = (ev) => {
          window.removeEventListener('pointerup', up, true)
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) this.activate(win)
        }
        window.addEventListener('pointerup', up, true)
      },
      true,
    )
    el.querySelector('[data-min]').addEventListener('click', () => this.minimize(slot))
    el.querySelector('[data-max]').addEventListener('click', () => this.toggleMax(slot))
    el.querySelector('.pv-win-bar').addEventListener('dblclick', (e) => !e.target.closest('button') && this.toggleMax(slot))
    el.querySelector('.pv-win-bar').addEventListener('pointerdown', (e) => !e.target.closest('button') && this.drag(win, e))
    for (const g of el.querySelectorAll('.pv-grab')) g.addEventListener('pointerdown', (e) => this.resize(win, e, g.dataset.edge))
    // a shared phone: its back / home / recents buttons
    for (const b of el.querySelectorAll('[data-nav]')) b.addEventListener('click', () => this.options.onNav?.(slot, b.dataset.nav))
    return win
  }

  // ------------------------------------------------------------ geometry

  /**
   * Size of a window's picture in CSS px at scale 1 (= one of the presenter's pixels per screen
   * pixel). From the presenter's full window size, not from the video: the presenter sends fewer
   * pixels when we show it smaller – sizing by the video would shrink it step by step.
   */
  native(win) {
    const d = window.devicePixelRatio || 1
    const { pw, ph } = win.info ?? {}
    if (pw && ph) return { w: pw / d, h: ph / d }
    return { w: (win.video.videoWidth || 1280) / d, h: (win.video.videoHeight || 800) / d }
  }

  area() {
    const r = this.root.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  /** Largest scale (≤ maxScale) at which a window fits into w × h (title bar included). */
  fitScale(win, w, h, bar = BAR) {
    const n = this.native(win)
    return Math.max(MIN_SCALE, Math.min(this.maxScale(win), (w - 2) / n.w, (h - bar - 2) / n.h))
  }

  /**
   * Pixel for pixel on a desktop. A phone's screen is two to three times as dense – pixel for
   * pixel would show a window a fraction of its size, so there it may grow to the size it has on
   * the presenter's screen (rect is in the presenter's points).
   */
  maxScale(win) {
    if (!matchMedia('(pointer: coarse)').matches || !win.info?.rect?.w) return 1
    return Math.max(1, win.info.rect.w / this.native(win).w)
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
    if (this.mirror) return this.layoutMirror()
    this.desks.replaceChildren()
    const wins = this.list
    if (wins.length <= 1) {
      // a single window: centred, as large as allowed, no frame
      for (const win of wins) {
        win.min = false
        const n = this.native(win)
        // room for the soft buttons of a phone below it (above the viewer's dock)
        const h = a.h - (win.nav ? NAV + (this.options.bottomSpace?.() ?? 0) : 0)
        win.s = this.fitScale(win, a.w, h, 0)
        win.x = (a.w - n.w * win.s) / 2
        win.y = (h - n.h * win.s) / 2
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

  // ------------------------------------------------------------ mirror of the presenter's screen

  /** Scale and offset that map the presenter's screen coordinates onto this view. */
  mirrorMap() {
    const a = this.area()
    const xs = this.screens
    const D = { x: Math.min(...xs.map((r) => r.x)), y: Math.min(...xs.map((r) => r.y)) }
    D.w = Math.max(...xs.map((r) => r.x + r.w)) - D.x
    D.h = Math.max(...xs.map((r) => r.y + r.h)) - D.y
    const M = 14
    let k = Math.min((a.w - 2 * M) / D.w, (a.h - 2 * M - BAR) / D.h)
    // never enlarged beyond one of the presenter's pixels per screen pixel
    for (const win of this.wins.values()) if (win.info.rect?.w) k = Math.min(k, this.native(win).w / win.info.rect.w)
    return { D, k, ox: (a.w - D.w * k) / 2, oy: BAR + M + (a.h - 2 * M - BAR - D.h * k) / 2 }
  }

  layoutMirror() {
    const { D, k, ox, oy } = (this.map = this.mirrorMap())
    this.desks.replaceChildren(
      ...this.screens.map((r, i) => {
        const el = document.createElement('div')
        el.className = 'pv-desk'
        el.style.left = `${ox + (r.x - D.x) * k}px`
        el.style.top = `${oy + (r.y - D.y) * k}px`
        el.style.width = `${r.w * k}px`
        el.style.height = `${r.h * k}px`
        el.innerHTML = `<span>${this.screens.length > 1 ? `Bildschirm ${i + 1} des Hosts` : 'Bildschirm des Hosts'}</span>`
        return el
      }),
    )
    for (const win of this.wins.values()) {
      if (win.busy) continue // being dragged / resized here
      if (win.ghost && win.lastRect && (win.lastRect.w !== win.info.rect.w || win.lastRect.h !== win.info.rect.h)) win.ghost.remove()
      win.lastRect = win.info.rect
      const r = win.info.rect
      const n = this.native(win)
      win.max = false
      win.s = (r.w * k) / n.w
      win.x = ox + (r.x - D.x) * k
      win.y = oy + (r.y - D.y) * k - BAR
      // the presenter's stacking order
      win.el.style.zIndex = String(1000 - (win.info.z ?? 0))
      this.paint(win)
    }
  }

  /** Mirror position of a window → the presenter's screen coordinates. */
  toHost(win) {
    const { D, k, ox, oy } = this.map ?? this.mirrorMap()
    return { x: D.x + (win.x - ox) / k, y: D.y + (win.y + BAR - oy) / k }
  }

  screenOf(win) {
    const r = win.info.rect
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    return this.screens.find((s) => cx >= s.x && cy >= s.y && cx < s.x + s.w && cy < s.y + s.h) ?? this.screens[0]
  }

  /** "Resize/Anordnen erlauben": the presenter's window moves to the same relative place. */
  arrangeThere(win) {
    if (!this.options.canResize?.()) return
    const a = this.area()
    this.options.onArrange?.(win.slot, Math.max(0, win.x / a.w), Math.max(0, win.y / a.h))
  }

  /** The viewer arranged everything side by side: the presenter's windows follow (if allowed). */
  tileThere() {
    if (!this.options.canResize?.() || this.mirror) return
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
    if (this.mirror) return this.tileHost()
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

  /** Mirror mode: the presenter's windows side by side on their screen. */
  tileHost() {
    const wins = this.list.filter((w) => !w.min)
    if (!wins.length) return
    const sc = this.screenOf(wins[0])
    const top = 25 // menu bar
    const cols = Math.ceil(Math.sqrt(wins.length * (sc.w / sc.h) / 1.6)) || 1
    const rows = Math.ceil(wins.length / cols)
    const g = 8
    const cw = (sc.w - g * (cols + 1)) / cols
    const ch = (sc.h - top - g * (rows + 1)) / rows
    wins.forEach((win, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      this.options.onPlace?.(win.slot, { x: sc.x + g + col * (cw + g), y: sc.y + top + g + row * (ch + g), hw: cw, hh: ch })
    })
  }

  clamp(win) {
    const a = this.area()
    win.s = Math.min(win.s, this.fitScale(win, a.w, a.h))
    this.clampPos(win)
  }

  /** Position only (also in the mirror, where the size is the presenter's). */
  clampPos(win) {
    const a = this.area()
    const w = this.native(win).w * win.s
    // it may hang over the edges, a part of the title bar always stays reachable
    win.x = Math.min(Math.max(win.x, 48 - w), a.w - 48)
    win.y = Math.min(Math.max(win.y, 0), a.h - BAR)
  }

  /** Reports (debounced) how large each window is displayed – 0 when minimized or the tab is hidden. */
  reportSizes(delay = 0) {
    clearTimeout(this.sizeTimer)
    this.sizeTimer = setTimeout(() => {
      const d = window.devicePixelRatio || 1
      const sizes = [...this.wins.values()].map((w) => ({ w: w.slot, pw: document.hidden || w.min ? 0 : Math.round(w.view.getBoundingClientRect().width * d) }))
      if (sizes.length) this.options.onSizes?.(sizes)
    }, delay)
  }

  paint(win, bar = BAR) {
    this.reportSizes(500)
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

  /** With "Resize/Anordnen erlauben" the window the viewer picked comes to the front at the presenter's, too. */
  activate(win) {
    if (!win || !this.options.canResize?.() || Date.now() - (win.activated ?? 0) < 800) return
    win.activated = this.activatedAt = Date.now()
    this.options.onActivate?.(win.slot)
  }

  focus(slot) {
    const win = this.wins.get(slot)
    this.active = win ? slot : null
    for (const w of this.wins.values()) w.el.classList.toggle('active', w === win)
    // in the mirror the presenter's stacking order rules
    if (win && !this.mirror) win.el.style.zIndex = String(++this.z)
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
      this.focus(slot)
      this.activate(win)
    } else if (this.active === slot) {
      this.minimize(slot)
    } else {
      this.focus(slot)
      this.activate(win)
    }
  }

  toggleMax(slot) {
    const win = this.wins.get(slot)
    if (win && this.mirror) {
      // the presenter's window fills its screen (or gets its previous frame back)
      const sc = this.screenOf(win)
      if (win.hostPrev) {
        this.options.onPlace?.(slot, win.hostPrev)
        win.hostPrev = null
      } else {
        const r = win.info.rect
        win.hostPrev = { x: r.x, y: r.y, hw: r.w, hh: r.h }
        this.options.onPlace?.(slot, { x: sc.x, y: sc.y + 25, hw: sc.w, hh: sc.h - 25 })
      }
      return
    }
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
    if (this.wins.size <= 1 && !this.mirror) return
    e.preventDefault()
    const bar = e.currentTarget
    try {
      bar.setPointerCapture(e.pointerId)
    } catch {}
    const start = { x: e.clientX, y: e.clientY, wx: win.x, wy: win.y }
    this.root.classList.add('moving')
    win.busy = true
    const move = (ev) => {
      win.x = start.wx + ev.clientX - start.x
      win.y = start.wy + ev.clientY - start.y
      win.max = false
      if (this.mirror) this.clampPos(win)
      else this.clamp(win)
      this.paint(win)
    }
    const up = () => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      bar.removeEventListener('pointercancel', up)
      this.root.classList.remove('moving')
      this.arranged = true
      win.busy = false
      if (win.x === start.wx && win.y === start.wy) return
      if (this.mirror) this.options.onPlace?.(win.slot, this.toHost(win))
      else this.arrangeThere(win)
      // moved windows come to the front there – unless that takes the focus from this page
      if (!this.local) this.activate(win)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
  }

  /**
   * Resizing from an edge or the corner, previewed live:
   * - "Resize/Anordnen erlauben": a dashed frame shows the new size of the presenter's window
   *   (any size and aspect ratio, in their pixels); it takes that size on release.
   * - otherwise the picture scales proportionally – never beyond one video pixel per screen pixel.
   */
  resize(win, e, edge = 'rb') {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {}
    const n = this.native(win)
    const r = win.el.getBoundingClientRect()
    const a = this.root.getBoundingClientRect()
    const d = window.devicePixelRatio || 1
    const remote = !!this.options.canResize?.()
    const ghost = document.createElement('div')
    ghost.className = `pv-win-ghost${remote ? '' : ' scale'}`
    ghost.innerHTML = '<span></span>'
    win.el.append(ghost)
    win.el.classList.add('sizing')
    this.root.classList.add('moving')
    win.busy = true
    let target = { w: r.width, h: r.height - BAR }
    const show = () => {
      ghost.style.width = `${Math.round(remote ? target.w : win.el.offsetWidth)}px`
      ghost.style.height = `${Math.round(remote ? target.h + BAR : win.el.offsetHeight)}px`
      const label = ghost.querySelector('span')
      if (remote) {
        label.innerHTML = '<b></b><small>neue Fenstergröße beim Host</small>'
        const k = this.mirror ? (this.map ?? this.mirrorMap()).k : 1 / d
        label.querySelector('b').textContent = `${Math.round(target.w / k)} × ${Math.round(target.h / k)}`
      } else {
        label.textContent = `${Math.round(win.s * 100)} %`
      }
    }
    const move = (ev) => {
      const w = edge.includes('r') ? ev.clientX - r.left : r.width
      const h = edge.includes('b') ? ev.clientY - r.top - BAR : r.height - BAR
      if (remote) {
        // free size, within the viewer's area
        target = { w: Math.max(200 / d, Math.min(a.right - r.left - 2, w)), h: Math.max(150 / d, Math.min(a.bottom - r.top - BAR - 2, h)) }
      } else {
        const s = edge === 'r' ? w / n.w : edge === 'b' ? h / n.h : Math.max(w / n.w, h / n.h)
        win.s = Math.max(MIN_SCALE, Math.min(this.maxScale(win), s))
        win.max = false
        this.clamp(win)
        this.paint(win)
      }
      show()
    }
    show()
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      this.root.classList.remove('moving')
      win.el.classList.remove('sizing')
      this.arranged = true
      win.busy = false
      if (!remote) return ghost.remove()
      // the presenter's window takes this size; the frame stays until the new picture arrives
      win.ghost = ghost
      setTimeout(() => ghost.remove(), 4000)
      if (this.mirror) {
        const { k } = this.map ?? this.mirrorMap()
        this.options.onPlace?.(win.slot, { hw: target.w / k, hh: target.h / k })
        return
      }
      win.resized = true
      this.options.onResize?.(win.slot, Math.round(target.w * d), Math.round(target.h * d))
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
