// What somebody points at or drew, drawn on a canvas – in the always-on-top window "Freigabe
// läuft" (a Picture-in-Picture document window, light-pip.js): that spot of the still picture,
// enlarged, with the stroke drawn again, plus a small map of the whole screen marking where that
// is. Then back to rest – unless it is kept (shown large, until made smaller). While viewers move
// their mice, the part shown follows them right away: one pointer in its middle, several within it
// (it grows to hold them all). A pointer at rest fades out and is no longer followed.
//
// It renders from a worker's clock: the share page sits in a background tab, where browsers slow
// down timers and stop requestAnimationFrame.

const W = 640
const H = 400
const SHOW = 6500 // ms a spot stays
const DRAW = 1000 // ms to draw a stroke again
const FOLLOW = 45 // ms: how softly the part shown follows the pointers (just enough not to jitter)
const IDLE = 2000 // ms: a pointer not moved this long fades out, no longer followed
const MARGIN = 90 // image pixels around the pointers
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

export class MiniView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, { requestsOnCanvas = false } = {}) {
    this.canvas = canvas
    canvas.width = W
    canvas.height = H
    this.ctx = canvas.getContext('2d')
    this.requestsOnCanvas = requestsOnCanvas
    this.state = { viewers: [], requests: [], busy: [], problem: '' }
    this.spot = null
    this.pointers = new Map() // viewer id -> {x, y (0..1 of the picture), color, at}
    this.ticker = null
    this.k = 1 // pixels per unit of the 640 × 400 layout (sharp when shown large)
    this.keep = false // the spot stays (shown large)
    this.onDone = null // called when a spot goes back to rest
    this.render()
  }

  /** Drawn sharper (the window shown large): k pixels per unit of the 640 × 400 layout. */
  setScale(k) {
    this.k = Math.max(1, k)
    this.canvas.width = Math.round(W * this.k)
    this.canvas.height = Math.round(H * this.k)
    if (this.spot && !this.ticker) this.renderKept()
    else this.render()
  }

  /** Back to rest at once. */
  clear() {
    this.spot = null
    this.keep = false
    this.stop()
    this.render()
  }

  /** The stroke drawn again (shown large now). */
  replay() {
    if (!this.spot) return
    this.spot.at = performance.now()
    this.start()
  }

  /** {viewers, requests, busy: names of people drawing right now, problem: a line to warn with} */
  set(state) {
    this.state = { ...this.state, ...state }
    if (!this.spot) this.render()
  }

  /**
   * Shows a spot: {capture: {image, picture, monitor, screenImage}, points: [[x, y], …] (0..1 of
   * the picture), color, name, ping}.
   */
  reveal(spot) {
    if (!spot.capture?.image) return
    this.spot = { ...spot, at: performance.now(), crop: crop(spot.capture.image, spot.points) }
    this.start()
  }

  get showing() {
    return !!this.spot
  }

  /** A viewer's pointer moved (0..1 of the picture): while something is shown, it is followed. */
  pointer(from, x, y, color = '#ef4444') {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return
    const now = performance.now()
    this.pointers.set(from, { x, y, color, at: now })
    const spot = this.spot
    if (!spot) return
    // (still shown while it moves: as just drawn)
    if (now - spot.at > DRAW) spot.at = now - DRAW
    this.start()
  }

  /** A viewer's pointer left the picture (or the viewer left). */
  hidePointer(from) {
    this.pointers.delete(from)
  }

  /** The pointers moved lately: [x, y, color, alpha]. */
  activePointers(now = performance.now()) {
    const list = []
    for (const [id, p] of this.pointers) {
      const age = now - p.at
      if (age > IDLE) {
        this.pointers.delete(id)
        continue
      }
      list.push({ ...p, alpha: age < IDLE - 400 ? 1 : (IDLE - age) / 400 })
    }
    return list
  }

  start() {
    if (this.ticker) return
    try {
      this.ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })))
      this.ticker.onmessage = () => this.render()
    } catch {
      // no workers: an ordinary timer (slow in a background tab)
      const id = setInterval(() => this.render(), 33)
      this.ticker = { terminate: () => clearInterval(id) }
    }
  }

  stop() {
    this.ticker?.terminate()
    this.ticker = null
  }

  destroy() {
    this.stop()
    clearTimeout(this.restTimer)
  }

  render() {
    const { ctx } = this
    // (kept: drawn on while pointers move or fade)
    if (this.spot && performance.now() - this.spot.at > (this.keep ? DRAW + 1500 : SHOW) && !(this.keep && this.pointers.size)) {
      if (this.keep) {
        // (kept: the stroke stays drawn – the clock may stop)
        this.spot.at = performance.now() - DRAW - 600
        this.renderKept()
        this.stop()
        return
      }
      this.spot = null
      this.stop()
      this.onDone?.()
    }
    ctx.save()
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0)
    ctx.fillStyle = '#18181b'
    ctx.fillRect(0, 0, W, H)
    if (this.spot) this.renderSpot()
    else this.renderRest()
    ctx.restore()
    // at rest, too, now and then: a captured canvas sends a frame only when drawn to, and the
    // "malt gerade" dot pulses
    clearTimeout(this.restTimer)
    if (!this.spot && !this.ticker) this.restTimer = setTimeout(() => !this.spot && this.render(), this.state.busy.length ? 300 : 1000)
  }

  renderKept() {
    const { ctx } = this
    ctx.save()
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0)
    ctx.fillStyle = '#18181b'
    ctx.fillRect(0, 0, W, H)
    this.renderSpot()
    ctx.restore()
  }

  renderRest() {
    const { ctx } = this
    const { viewers, requests, busy } = this.state
    dot(ctx, 40, 52, 9, '#ef4444')
    text(ctx, 'Freigabe läuft', 62, 62, 30, '#fafafa', 700)
    text(ctx, viewers.length === 0 ? 'Noch niemand schaut zu' : viewers.length === 1 ? `${viewers[0].name} schaut zu` : `${viewers.length} schauen zu`, 40, 110, 24, '#a1a1aa')
    let y = 170
    if (busy.length) {
      box(ctx, 28, y - 36, W - 56, 56, '#27272a')
      dot(ctx, 52, y - 8, 7, '#fafafa', 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 300)))
      text(ctx, busy.length === 1 ? `${busy[0]} malt gerade …` : `${busy.join(' und ')} malen gerade …`, 72, y, 24, '#fafafa', 600)
      y += 74
    }
    if (this.requestsOnCanvas && requests.length) {
      box(ctx, 28, y - 36, W - 56, 84, 'rgba(239,68,68,.16)')
      text(ctx, requests.length === 1 ? `${requests[0].name} möchte zusehen` : `${requests.length} möchten zusehen`, 48, y, 24, '#fafafa', 650)
      text(ctx, 'Im PeekaView-Tab zulassen', 48, y + 32, 20, '#fca5a5')
      y += 104
    }
    // the shared window is not to be found on the screen
    if (this.state.problem) {
      box(ctx, 28, y - 36, W - 56, 56, '#ef4444')
      text(ctx, this.state.problem, 48, y, 22, '#ffffff', 650)
      y += 74
    }
    if (y < H - 60) text(ctx, 'Hier erscheint, was jemand zeigt oder malt.', 40, H - 40, 22, '#71717a')
  }

  renderSpot() {
    const { ctx, spot } = this
    const pointers = this.activePointers()
    follow(spot, pointers)
    const { capture, crop: c, points, color, name, ping } = spot
    const t = performance.now() - spot.at
    const img = capture.image
    ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, W, H)
    const map = ([x, y]) => [((x * img.width - c.x) / c.w) * W, ((y * img.height - c.y) / c.h) * H]
    const fade = !this.keep && t > SHOW - 600 ? Math.max(0, (SHOW - t) / 600) : 1
    ctx.globalAlpha = fade
    if (ping) {
      const [x, y] = map(points[0])
      for (const delay of [0, 450, 900]) {
        const k = (t - delay) / 900
        if (k < 0 || k > 1) continue
        ctx.globalAlpha = fade * (1 - k)
        ring(ctx, x, y, 12 + k * 46, color)
      }
      ctx.globalAlpha = fade
      ring(ctx, x, y, 10, color)
    } else {
      const n = Math.max(1, Math.ceil(points.length * Math.min(1, t / DRAW)))
      ctx.strokeStyle = color
      ctx.lineWidth = 7
      ctx.lineCap = ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(0,0,0,.35)'
      ctx.shadowBlur = 4
      ctx.beginPath()
      points.slice(0, n).forEach((p, i) => {
        const [x, y] = map(p)
        ctx[i ? 'lineTo' : 'moveTo'](x, y)
      })
      if (n === 1) ctx.lineTo(...map(points[0]).map((v) => v + 0.1))
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    // the pointers, followed (fading out at rest)
    for (const p of pointers) {
      const [x, y] = map([p.x, p.y])
      ctx.globalAlpha = fade * p.alpha
      arrow(ctx, x, y, p.color)
    }
    ctx.globalAlpha = 1
    // who
    const label = `${name} zeigt hier`
    ctx.font = `600 22px ${FONT}`
    const lw = ctx.measureText(label).width
    box(ctx, 14, 14, lw + 54, 40, 'rgba(24,24,27,.88)')
    dot(ctx, 36, 34, 7, color)
    text(ctx, label, 52, 42, 22, '#fafafa', 600)
    // could not be placed on the screen: "Zur Stelle" shows it in the middle
    if (spot.note) {
      ctx.font = `600 20px ${FONT}`
      box(ctx, 14, H - 54, ctx.measureText(spot.note).width + 28, 40, '#ef4444')
      text(ctx, spot.note, 28, H - 27, 20, '#ffffff', 600)
    }
    this.renderMap()
  }

  // the whole screen (or the whole shared picture), small, with the shown part marked
  renderMap() {
    const { ctx, spot } = this
    const { capture, crop: c } = spot
    const img = capture.image
    const whole = capture.screenImage ?? img
    const mw = 168
    const mh = Math.round((mw * whole.height) / whole.width)
    const x0 = W - mw - 14
    const y0 = H - mh - 14
    ctx.fillStyle = '#09090b'
    ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6)
    ctx.drawImage(whole, x0, y0, mw, mh)
    // the shown part in the map's coordinates
    let r = { x: c.x / img.width, y: c.y / img.height, w: c.w / img.width, h: c.h / img.height }
    if (capture.screenImage && capture.picture) {
      const { picture: p, monitor: m } = capture
      r = { x: (p.left - m.left + r.x * p.width) / m.width, y: (p.top - m.top + r.y * p.height) / m.height, w: (r.w * p.width) / m.width, h: (r.h * p.height) / m.height }
    }
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 3
    ctx.strokeRect(x0 + r.x * mw, y0 + r.y * mh, Math.max(4, r.w * mw), Math.max(4, r.h * mh))
  }
}

/**
 * The part shown, a step nearer to holding the pointers (within the picture): one in its middle,
 * several within it – larger when they lie further apart, never smaller than at first.
 */
function follow(spot, pointers) {
  const now = performance.now()
  const dt = now - (spot.followed ?? now)
  spot.followed = now
  if (!pointers.length) return
  const img = spot.capture.image
  const c = spot.crop
  spot.base ??= { w: c.w, h: c.h }
  const t = span(img, pointers, spot.base)
  const k = 1 - Math.exp(-dt / FOLLOW)
  spot.crop = { x: c.x + (t.x - c.x) * k, y: c.y + (t.y - c.y) * k, w: c.w + (t.w - c.w) * k, h: c.h + (t.h - c.h) * k }
}

/** The part (image pixels, in the window's shape) holding all pointers, with a margin. */
export function span(img, pointers, base) {
  const xs = pointers.map((p) => p.x * img.width)
  const ys = pointers.map((p) => p.y * img.height)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  let w = Math.max(base.w, x1 - x0 + 2 * MARGIN, ((y1 - y0 + 2 * MARGIN) * W) / H)
  w = Math.min(w, img.width, (img.height * W) / H)
  const h = (w * H) / W
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return { x: Math.max(0, Math.min(img.width - w, cx - w / 2)), y: Math.max(0, Math.min(img.height - h, cy - h / 2)), w, h }
}

// a mouse pointer, as viewers see it
function arrow(ctx, x, y, color) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1.6, 1.6)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 12.5)
  ctx.lineTo(3.4, 9.4)
  ctx.lineTo(5.8, 14.7)
  ctx.lineTo(7.9, 13.8)
  ctx.lineTo(5.5, 8.6)
  ctx.lineTo(10.4, 8.6)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.2
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,.45)'
  ctx.shadowBlur = 2
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** The part of the picture (image pixels) shown: around the stroke, enlarged, in the window's shape. */
export function crop(img, points) {
  const xs = points.map((p) => p[0] * img.width)
  const ys = points.map((p) => p[1] * img.height)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  let w = Math.max((Math.max(...xs) - Math.min(...xs)) * 1.5, ((Math.max(...ys) - Math.min(...ys)) * 1.5 * W) / H, img.width * 0.3)
  w = Math.min(w, img.width, (img.height * W) / H)
  const h = (w * H) / W
  return { x: Math.max(0, Math.min(img.width - w, cx - w / 2)), y: Math.max(0, Math.min(img.height - h, cy - h / 2)), w, h }
}

function text(ctx, s, x, y, size, color, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.fillText(s, x, y, W - x - 24)
}

function dot(ctx, x, y, r, color, alpha = 1) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
}

function box(ctx, x, y, w, h, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 14)
  ctx.fill()
}
