// "Bildschirmfreigabe light": picking the window to show from a picture of the whole screen.
// The windows found by their title bars (light-windows.js findWindows) are outlined; the active
// one (coloured buttons) is picked right away. A click picks the window under it (again on the same
// spot: the next one), a drag draws a part by hand. Everything outside the picked part is darkened: that is what viewers will not see.

import { findWindows, windowsAt } from './light-windows.js'

const MIN_DRAG = 6 // CSS px before a press becomes a drag

export class WindowPicker {
  /** @param {HTMLCanvasElement} canvas  @param {{onChange?: (selection) => void}} options */
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas
    this.onChange = onChange ?? (() => {})
    this.image = null
    this.windows = []
    this.selection = null // {x, y, w, h} 0..1 of the picture
    this.hover = null
    this.drag = null
    this.lastClick = null
    this.observer = new ResizeObserver(() => this.render())
    this.observer.observe(canvas)
    canvas.addEventListener('pointerdown', (e) => this.down(e))
    canvas.addEventListener('pointermove', (e) => this.move(e))
    canvas.addEventListener('pointerup', (e) => this.up(e))
    canvas.addEventListener('pointerleave', () => {
      this.hover = null
      if (!this.drag) this.render()
    })
  }

  /**
   * A new picture of the screen: windows looked for again; a picked window stays picked.
   * @param {{active?: boolean, own?: {x, y, w, h}}} [options] active: taken while the presenter was
   *   in another program; own: this browser's window (0..1 of the picture) – never one to pick
   */
  setImage(image, { active = false, own = null } = {}) {
    this.image = image
    // the windows by their title bars (light-windows.js findWindows): a part of the screen without
    // the buttons of one is no window of its own
    const found = findWindows(imageData(image)).map((r) => ({ x: r.x / image.width, y: r.y / image.height, w: r.width / image.width, h: r.height / image.height, titled: r.active, line: r.line, kind: r.kind }))
    const overlap = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
      return (ix * iy) / (a.w * a.h + b.w * b.h - ix * iy)
    }
    const previous = this.selection
    const all = found
    this.windows = all.filter((w) => !own || overlap(w, own) < 0.6)
    // (for share.html?debug: what was taken for this browser's window)
    this.ownLeftOut = all.filter((w) => !this.windows.includes(w))
    // the picked window again among the new ones (the picture is fetched anew now and then)
    if (previous && !previous.drawn) {
      const again = this.windows.find((w) => overlap(w, previous) > 0.85)
      if (again) this.selection = again
    }
    // the window the presenter just worked in (not this browser): picked right away – unless they
    // picked one themselves
    const titled = this.windows.filter((w) => w.titled)
    if (active && titled.length && (!this.selection || this.auto)) {
      this.select(titled[0])
      this.auto = true
    }
    this.render()
  }

  select(rect) {
    this.auto = false
    this.single = false
    this.selection = rect
    this.render()
    this.onChange(rect)
  }

  destroy() {
    this.observer.disconnect()
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), cx: e.clientX, cy: e.clientY }
  }

  down(e) {
    if (!this.image) return
    e.preventDefault()
    this.canvas.setPointerCapture?.(e.pointerId)
    this.drag = { from: this.pos(e), to: null }
  }

  move(e) {
    const p = this.pos(e)
    if (this.drag) {
      if (this.drag.to || Math.hypot(p.cx - this.drag.from.cx, p.cy - this.drag.from.cy) > MIN_DRAG) this.drag.to = p
      return this.render()
    }
    const under = windowsAt(this.windows, p).sort((a, b) => (b.titled ? 1 : 0) - (a.titled ? 1 : 0) || b.w * b.h - a.w * a.h)
    const hover = under[0] ?? null
    if (hover !== this.hover) {
      this.hover = hover
      this.render()
    }
  }

  up(e) {
    const drag = this.drag
    this.drag = null
    if (!drag) return
    const p = this.pos(e)
    if (drag.to) {
      // a part drawn by hand
      const x = Math.min(drag.from.x, p.x)
      const y = Math.min(drag.from.y, p.y)
      const w = Math.abs(p.x - drag.from.x)
      const h = Math.abs(p.y - drag.from.y)
      if (w > 0.03 && h > 0.03) this.select({ x, y, w, h, drawn: true })
      else this.render()
      return
    }
    // a click: the window under it – on the same spot again, the next smaller one
    // (windows with a title bar first, the largest first)
    const under = windowsAt(this.windows, p).sort((a, b) => (b.titled ? 1 : 0) - (a.titled ? 1 : 0) || b.w * b.h - a.w * a.h)
    if (!under.length) return this.render()
    const again = this.lastClick && Math.hypot(p.cx - this.lastClick.cx, p.cy - this.lastClick.cy) < 8
    const i = again ? under.indexOf(this.selection) : -1
    this.lastClick = p
    this.select(under[(i + 1) % under.length])
  }

  render() {
    const { canvas, image } = this
    const css = canvas.getBoundingClientRect()
    if (!image || !css.width) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(css.width * dpr)
    canvas.height = Math.round((css.width * image.height * dpr) / image.width)
    canvas.style.height = `${canvas.height / dpr}px`
    const W = canvas.width
    const H = canvas.height
    const ctx = canvas.getContext('2d')
    const px = (r) => [r.x * W, r.y * H, r.w * W, r.h * H]
    const shown = this.drag?.to ? dragRect(this.drag) : this.selection
    ctx.drawImage(image, 0, 0, W, H)
    // outside of the part: darkened (viewers will not see it)
    if (shown) {
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,.55)'
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.rect(...px(shown))
      ctx.fill('evenodd')
      ctx.restore()
    }
    // the windows found
    ctx.lineWidth = Math.max(1, dpr)
    for (const r of this.windows) {
      if (r === shown) continue
      ctx.setLineDash([6 * dpr, 4 * dpr])
      ctx.strokeStyle = r === this.hover ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.45)'
      ctx.strokeRect(...px(r))
    }
    ctx.setLineDash([])
    if (this.hover && this.hover !== shown) {
      ctx.fillStyle = 'rgba(239,68,68,.12)'
      ctx.fillRect(...px(this.hover))
    }
    if (shown) {
      ctx.lineWidth = 3 * dpr
      ctx.strokeStyle = '#ef4444'
      ctx.strokeRect(...px(shown))
    }
  }
}

function dragRect({ from, to }) {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) }
}

/** A picture's pixels (RGBA, full size). */
function imageData(image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}
