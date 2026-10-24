// Renders everybody's colored cursor (with name label) and fading ink strokes.
// Used by the web viewer (on top of the video) and by the presenter's desktop overlay.
// All positions are normalized to 0..1 of the shared area.
// The label also shows the voice state: level bars while somebody speaks, a crossed-out
// microphone while their microphone is off.

import { icon } from './icons.js'

const HOLD = 4000 // ms a finished stroke stays fully visible
const FADE = 1000 // ms fade-out afterwards
const IDLE = 8000 // ms until a resting cursor fades out
const MAX_POINTS = 4000
const LEVEL_TIMEOUT = 1500 // ms without a level message -> silent

const CSS = `
.pv-ink, .pv-cursors { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.pv-cursors { overflow: hidden; }
.pv-cursor { position: absolute; transition: opacity .4s; will-change: left, top; pointer-events: none; }
.pv-cursor svg { display: block; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .5)); }
.pv-cursor.idle { opacity: 0; }
.pv-label {
  position: absolute; left: 18px; top: 18px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; color: #fff; font: 600 12px/1.4 system-ui, sans-serif;
  text-shadow: 0 1px 1px rgba(0, 0, 0, .4); box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
}
.pv-audio { display: inline-flex; align-items: center; height: 12px; }
.pv-audio:empty { display: none; }
.pv-audio svg { width: 12px; height: 12px; stroke-width: 2.2; opacity: .9; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .3)); }
.pv-bars { display: inline-flex; align-items: center; gap: 1.5px; height: 12px; }
.pv-bars b { width: 2.5px; height: 3px; border-radius: 1.5px; background: currentColor; opacity: .75; transition: height .09s ease-out; }
.speaking .pv-bars b { opacity: 1; animation: pv-eq .38s ease-in-out infinite alternate; }
.speaking .pv-bars b:nth-child(1) { height: calc(4px + var(--lv, 0) * 6px); animation-delay: -.12s; }
.speaking .pv-bars b:nth-child(2) { height: calc(5px + var(--lv, 0) * 7px); }
.speaking .pv-bars b:nth-child(3) { height: calc(4px + var(--lv, 0) * 5px); animation-delay: -.25s; }
@keyframes pv-eq { from { transform: scaleY(.55); } to { transform: scaleY(1); } }
.pv-ping {
  position: absolute; width: 60px; height: 60px; margin: -30px 0 0 -30px;
  border: 4px solid; border-radius: 50%; pointer-events: none;
  animation: pv-ping .9s ease-out forwards;
}
@keyframes pv-ping { from { transform: scale(.2); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
`

const injected = new Set()

/**
 * Adds a stylesheet to the document once. Uses a constructable stylesheet, which is not subject
 * to a nonce-based `style-src` CSP of an embedding app; falls back to a <style> element.
 */
export function injectStyle(id, css) {
  if (injected.has(id)) return
  injected.add(id)
  if ('adoptedStyleSheets' in Document.prototype && typeof CSSStyleSheet === 'function') {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      return
    } catch {}
  }
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
}

const clamp = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#888888')

export class Annotations {
  /** @param {{voice?: boolean}} [options] voice: show the voice state in labels (off when the host app has its own audio) */
  constructor(root, { voice = true } = {}) {
    injectStyle('pv-annotate-style', CSS)
    this.root = root
    this.voice = voice
    this.levels = new Map()
    this.peers = new Map()
    this.cursors = new Map()
    this.strokes = []
    this.active = new Map()
    this.raf = 0

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'pv-ink'
    this.layer = document.createElement('div')
    this.layer.className = 'pv-cursors'
    root.append(this.canvas, this.layer)
    this.ctx = this.canvas.getContext('2d')

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(root)
    this.resize()
  }

  destroy() {
    this.observer.disconnect()
    cancelAnimationFrame(this.raf)
    for (const id of [...this.cursors.keys()]) this.removeCursor(id)
    this.canvas.remove()
    this.layer.remove()
  }

  resize() {
    const r = this.root.getBoundingClientRect()
    const d = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(r.width * d))
    this.canvas.height = Math.max(1, Math.round(r.height * d))
    this.render()
  }

  peer(id) {
    const p = this.peers.get(id)
    return { name: p?.name ?? 'Gast', color: safeColor(p?.color), voice: !!p?.voice }
  }

  handle(m) {
    switch (m.t) {
      case 'peers':
        this.peers = new Map(m.list.map((p) => [p.id, p]))
        for (const [id, el] of this.cursors) this.paintCursor(id, el)
        break
      case 'ptr':
        this.cursor(m.from, m.x, m.y)
        break
      case 'hide':
        this.removeCursor(m.from)
        break
      case 'ping':
        this.cursor(m.from, m.x, m.y)
        this.ping(m.from, m.x, m.y)
        break
      case 'draw':
        this.cursor(m.from, m.x, m.y)
        this.draw(m.from, m.s, m.x, m.y)
        break
      case 'clear':
        this.clear(m.from)
        break
      case 'level':
        this.level(m.from, m.v)
        break
      case 'left':
        this.removeCursor(m.id)
        this.clear(m.id)
        break
      case 'state':
        if (m.mode === 'view') this.reset(0)
        break
      case 'reset':
        this.reset()
        break
    }
  }

  /** Remove all cursors and strokes (optionally keeping one id, e.g. the presenter's pointer). */
  reset(keep) {
    for (const id of [...this.cursors.keys()]) if (id !== keep) this.removeCursor(id)
    this.strokes = []
    this.active.clear()
    for (const ping of this.root.querySelectorAll('.pv-ping')) ping.remove()
    this.render()
  }

  cursor(id, x, y) {
    let el = this.cursors.get(id)
    if (!el) {
      el = document.createElement('div')
      el.className = 'pv-cursor'
      el.innerHTML =
        '<svg viewBox="0 0 16 16" width="22" height="22"><path d="M1 1v12.5l3.4-3.1 2.4 5.3 2.1-.9-2.4-5.2h4.9z" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg><span class="pv-label"><span class="pv-name"></span><span class="pv-audio"></span></span>'
      this.paintCursor(id, el)
      this.layer.append(el)
      this.cursors.set(id, el)
    }
    el.style.left = `${clamp(x) * 100}%`
    el.style.top = `${clamp(y) * 100}%`
    el.classList.remove('idle')
    clearTimeout(el.idleTimer)
    el.idleTimer = setTimeout(() => el.classList.add('idle'), IDLE)
  }

  paintCursor(id, el) {
    const { name, color, voice } = this.peer(id)
    el.querySelector('path').setAttribute('fill', color)
    const label = el.querySelector('.pv-label')
    label.querySelector('.pv-name').textContent = name
    label.style.background = color
    const audio = label.querySelector('.pv-audio')
    const kind = !this.voice ? '' : voice ? 'on' : 'off'
    if (audio.dataset.kind !== kind) {
      audio.dataset.kind = kind
      audio.innerHTML = kind === 'on' ? '<i class="pv-bars"><b></b><b></b><b></b></i>' : kind === 'off' ? icon('micOff', 12) : ''
      audio.title = kind === 'off' ? 'Mikrofon ist aus' : ''
    }
    this.paintLevel(id)
  }

  /** Microphone level (0..1) of a participant – drives the bars in their label. */
  level(id, v) {
    const entry = this.levels.get(id) ?? {}
    clearTimeout(entry.timer)
    entry.v = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
    entry.timer = entry.v > 0 ? setTimeout(() => this.level(id, 0), LEVEL_TIMEOUT) : undefined
    this.levels.set(id, entry)
    this.paintLevel(id)
  }

  paintLevel(id) {
    const label = this.cursors.get(id)?.querySelector('.pv-label')
    if (!label) return
    const v = this.levels.get(id)?.v ?? 0
    label.style.setProperty('--lv', v.toFixed(2))
    label.classList.toggle('speaking', v >= 0.1 && this.peer(id).voice)
  }

  removeCursor(id) {
    const el = this.cursors.get(id)
    if (!el) return
    clearTimeout(el.idleTimer)
    el.remove()
    this.cursors.delete(id)
  }

  ping(id, x, y) {
    const el = document.createElement('div')
    el.className = 'pv-ping'
    el.style.left = `${clamp(x) * 100}%`
    el.style.top = `${clamp(y) * 100}%`
    el.style.borderColor = this.peer(id).color
    el.addEventListener('animationend', () => el.remove())
    this.layer.append(el)
  }

  draw(id, phase, x, y) {
    const pt = [clamp(x), clamp(y)]
    let stroke = this.active.get(id)
    if (phase === 'start' || !stroke) {
      stroke = { id, color: this.peer(id).color, pts: [], done: 0 }
      this.strokes.push(stroke)
      this.active.set(id, stroke)
    }
    if (stroke.pts.length < MAX_POINTS) stroke.pts.push(pt)
    if (phase === 'end') {
      stroke.done = performance.now()
      this.active.delete(id)
    }
    this.kick()
  }

  clear(id) {
    this.strokes = this.strokes.filter((s) => s.id !== id)
    this.active.delete(id)
    this.render()
  }

  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render())
  }

  render() {
    this.raf = 0
    const { ctx, canvas } = this
    const now = performance.now()
    const d = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.lineWidth = 4 * d
    this.strokes = this.strokes.filter((s) => !s.done || now - s.done < HOLD + FADE)
    for (const s of this.strokes) {
      ctx.globalAlpha = s.done ? Math.min(1, 1 - (now - s.done - HOLD) / FADE) : 1
      ctx.strokeStyle = s.color
      ctx.beginPath()
      s.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * canvas.width, y * canvas.height))
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * canvas.width + 0.1, s.pts[0][1] * canvas.height)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (this.strokes.length) this.kick()
  }
}
