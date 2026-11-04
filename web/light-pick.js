// "Bildschirmfreigabe light": picking the window to show from a picture of the whole screen.
// The windows found (light-windows.js) are outlined; a click picks the window under it (again on
// the same spot: the next smaller one – a panel inside, a dialog over it), a drag draws a part by
// hand. Everything outside the picked part is darkened: that is what viewers will not see.

import { scaledGray } from './light-locate.js'
import { detectWindows, windowsAt } from './light-windows.js'

const DETECT_WIDTH = 640
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

  /** A new picture of the screen: windows looked for again; a picked window stays picked. */
  setImage(image) {
    this.image = image
    const h = Math.max(1, Math.round((image.height * DETECT_WIDTH) / image.width))
    this.windows = detectWindows(scaledGray(image, DETECT_WIDTH, h))
    this.render()
  }

  select(rect) {
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
    const under = windowsAt(this.windows, p)
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
    const under = windowsAt(this.windows, p)
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
