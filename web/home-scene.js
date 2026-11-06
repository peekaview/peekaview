// The start page's teaser: a remote desktop – the owl peeking over its edge – on which someone else's mouse
// is at work – it clicks, drags a window, circles something in red and types (remote control,
// pointing, drawing). Next to it the PeekaView owl plays peek-a-boo and watches: the visitor's
// pointer, or – while that rests – the remote one. Plain canvas 2D, nothing loaded from
// elsewhere. Still with "prefers-reduced-motion"; paused while the tab is hidden and while a
// share is watched.

const TAU = Math.PI * 2
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
// the remote desktop, in its own units
const W = 960, H = 600
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
}

/**
 * The remote desktop on `canvas`. Returns {start, stop, cursor()} – cursor() is where the remote
 * mouse is on the page (client coordinates, roughly: the canvas is tilted by CSS).
 * @param {HTMLCanvasElement} canvas
 */
export function startScene(canvas) {
  const ctx = canvas.getContext('2d')
  const windows = [
    { kind: 'doc', title: 'Brief an die Versicherung.txt', x: 70, y: 70, w: 400, h: 270, typed: '' },
    { kind: 'chart', title: 'Haushaltsbuch', x: 500, y: 60, w: 380, h: 250 },
    { kind: 'app', title: 'Druckertreiber einrichten', x: 300, y: 330, w: 360, h: 210, done: -9 },
  ]
  const cur = { x: 640, y: 470, down: false }
  let strokes = [], ripples = [], time = 0, frame = 0, last = 0, running = false, scale = 1, dpr = 1
  let step = null, script = run()

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1)
    const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr)
    scale = Math.min(cw / W, ch / H)
  }

  // ------------------------------------------------------------- what the remote mouse does
  function move(x, y, drag) {
    const fx = cur.x, fy = cur.y, d = Math.hypot(x - fx, y - fy)
    // a slight curve, as a hand moves
    const bend = (Math.random() - 0.5) * d * 0.25, nx = -(y - fy) / (d || 1), ny = (x - fx) / (d || 1)
    const offset = drag && { dx: drag.x - fx, dy: drag.y - fy }
    return {
      dur: 0.45 + d / 700,
      update(t) {
        const e = ease(t), b = Math.sin(Math.PI * e) * bend
        cur.x = fx + (x - fx) * e + nx * b; cur.y = fy + (y - fy) * e + ny * b
        if (drag) { drag.x = cur.x + offset.dx; drag.y = cur.y + offset.dy }
      },
    }
  }
  const wait = (dur) => ({ dur, update() {} })
  const press = (down) => ({ dur: 0.12, update() { cur.down = down }, end() { if (down) ripples.push({ x: cur.x, y: cur.y, t: time }) } })
  function front(win) { windows.splice(windows.indexOf(win), 1); windows.push(win) }
  function draw(points) {
    const stroke = { points: [], t: Infinity }
    strokes.push(stroke)
    return {
      dur: 1.3,
      update(t) {
        const n = Math.max(1, Math.round(t * (points.length - 1)))
        stroke.points = points.slice(0, n + 1)
        ;[cur.x, cur.y] = points[n]
      },
      end() { stroke.t = time },
    }
  }
  function type(win, text) {
    return { dur: text.length / 16, update(t) { win.typed = text.slice(0, Math.round(t * text.length)) } }
  }
  function* run() {
    const [doc, chart, app] = windows
    for (;;) {
      // click "Einrichten" in the app
      yield move(app.x + app.w / 2, app.y + app.h - 46)
      front(app)
      yield press(true); yield press(false); app.done = time
      yield wait(0.9)
      // drag the chart somewhere else
      yield move(chart.x + 90, chart.y + 14)
      front(chart)
      yield press(true)
      const tx = 470 + Math.random() * 60, ty = 40 + Math.random() * 60
      yield move(tx + 90, ty + 14, chart)
      yield press(false)
      yield wait(0.4)
      // circle the tallest bar
      const bx = chart.x + 60 + 3 * 52 + 16, by = chart.y + 148
      const circle = Array.from({ length: 40 }, (_, i) => { const a = -Math.PI / 2 + (i / 39) * TAU * 1.08; return [bx + Math.cos(a) * 46, by + Math.sin(a) * 74] })
      yield move(circle[0][0], circle[0][1])
      yield draw(circle)
      yield wait(0.8)
      // type a line in the letter
      front(doc)
      yield move(doc.x + 40, doc.y + doc.h - 52)
      yield press(true); yield press(false)
      doc.typed = ''
      yield type(doc, 'Ich mach das mal eben für dich …')
      yield wait(1.6)
      doc.typed = ''
    }
  }
  function advance(dt) {
    let left = dt
    while (left > 0) {
      if (!step) { step = script.next().value; step.age = 0 }
      const use = Math.min(left, step.dur - step.age)
      step.age += use; left -= use
      step.update(Math.min(1, step.age / step.dur))
      if (step.age >= step.dur) { step.end?.(); step = null } else break
    }
  }

  // ------------------------------------------------------------- painting
  function paintWindow(win) {
    const { x, y, w, h } = win
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12
    roundRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#222228'; ctx.fill()
    ctx.restore()
    roundRect(ctx, x, y, w, h, 10); ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x + 1, y + 1, w - 2, 27)
    ;['#ef4444', '#3f3f46', '#3f3f46'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 16 + i * 14, y + 14, 4.5, 0, TAU); ctx.fill() })
    ctx.fillStyle = '#a1a1aa'; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(win.title, x + 64, y + 18)
    if (win.kind === 'doc') {
      ctx.fillStyle = 'rgba(255,255,255,.17)'
      ;[0.9, 0.75, 0.82, 0.6, 0.86, 0.4].forEach((k, i) => { roundRect(ctx, x + 24, y + 50 + i * 24, (w - 48) * k, 8, 4); ctx.fill() })
      ctx.fillStyle = '#fafafa'; ctx.font = '500 16px system-ui, sans-serif'
      ctx.fillText(win.typed, x + 24, y + h - 34)
      if (win.typed && Math.floor(time * 2) % 2) { ctx.fillRect(x + 26 + ctx.measureText(win.typed).width, y + h - 48, 2, 18) }
    } else if (win.kind === 'chart') {
      ;[0.35, 0.55, 0.45, 0.85, 0.6, 0.4].forEach((k, i) => {
        ctx.fillStyle = i === 3 ? 'rgba(239,68,68,.85)' : 'rgba(255,255,255,.22)'
        roundRect(ctx, x + 60 + i * 52, y + h - 30 - k * 170, 32, k * 170, 5); ctx.fill()
      })
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x + 40, y + h - 29, w - 80, 1)
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.12)'
      ;[0.8, 0.55].forEach((k, i) => { roundRect(ctx, x + 24, y + 52 + i * 22, (w - 48) * k, 8, 4); ctx.fill() })
      const pressed = cur.down && Math.abs(cur.x - (x + w / 2)) < 70 && Math.abs(cur.y - (y + h - 46)) < 22
      roundRect(ctx, x + w / 2 - 70, y + h - 66 + (pressed ? 1 : 0), 140, 40, 10)
      ctx.fillStyle = pressed ? '#dc2626' : '#ef4444'; ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'center'
      const done = time - win.done < 2.2
      ctx.fillText(done ? '✓ Eingerichtet' : 'Einrichten', x + w / 2, y + h - 41)
      ctx.textAlign = 'start'
    }
  }
  function paintCursor() {
    const { x, y } = cur
    ctx.save(); ctx.translate(x, y); ctx.scale(1.25, 1.25)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 13); ctx.lineTo(7.5, 20); ctx.lineTo(10.5, 18.8); ctx.lineTo(7.6, 12); ctx.lineTo(13, 12); ctx.closePath()
    ctx.fillStyle = '#fafafa'; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.fill(); ctx.stroke()
    ctx.restore()
    // whose mouse it is
    ctx.font = '700 12px system-ui, sans-serif'
    const label = 'Anna steuert', tw = ctx.measureText(label).width
    roundRect(ctx, x + 16, y + 22, tw + 16, 22, 11); ctx.fillStyle = '#ef4444'; ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(label, x + 24, y + 37)
  }
  function paint() {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
    ctx.clearRect(0, 0, W, H)
    // the remote screen
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0, '#16161b'); bg.addColorStop(1, '#0d0d10')
    roundRect(ctx, 0, 0, W, H, 18); ctx.fillStyle = bg; ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,.035)'
    for (let gx = 30; gx < W; gx += 30) for (let gy = 40; gy < H; gy += 30) ctx.fillRect(gx, gy, 1.5, 1.5)
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, 0, W, 24)
    for (const win of windows) paintWindow(win)
    // drawings fade a while after they are done
    strokes = strokes.filter((s) => time - s.t < 2.6)
    for (const s of strokes) {
      const a = Math.min(1, Math.max(0, 1 - (time - s.t - 1.4) / 1.2))
      ctx.strokeStyle = `rgba(239,68,68,${a})`; ctx.lineWidth = 5; ctx.lineCap = ctx.lineJoin = 'round'
      ctx.beginPath(); s.points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke()
    }
    ripples = ripples.filter((r) => time - r.t < 0.6)
    for (const r of ripples) {
      const k = (time - r.t) / 0.6
      ctx.strokeStyle = `rgba(239,68,68,${1 - k})`; ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(r.x, r.y, 6 + k * 28, 0, TAU); ctx.stroke()
    }
    paintCursor()
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now; time += dt
    advance(dt); paint()
    frame = requestAnimationFrame(loop)
  }
  const onResize = () => { resize(); if (!running || reduced()) paint() }
  function start() {
    if (running) return
    running = true; canvas.hidden = false
    resize()
    if (reduced()) {
      // a still: the mouse beside a red circle
      advance(9.5); paint(); return
    }
    last = 0; frame = requestAnimationFrame(loop)
  }
  function stop() { running = false; cancelAnimationFrame(frame); canvas.hidden = true }
  function cursor() {
    if (!running) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left + (cur.x / W) * r.width, y: r.top + (cur.y / H) * r.height }
  }
  addEventListener('resize', onResize)
  start()
  return { start, stop, cursor }
}

/**
 * The owl in the headline: peeks up, blinks, looks at the visitor's pointer – or, while that rests,
 * at `watch()` (the remote mouse) – and now and then ducks away and peeks up again.
 * @param {HTMLElement} root
 * @param {{watch?: () => ({x: number, y: number} | null)}} [options]
 */
export function mountOwl(root, { watch } = {}) {
  root.innerHTML = `<div class="owl-body"><svg class="hero-owl" viewBox="0 0 24 24" aria-hidden="true">
    <defs><clipPath id="owl-eye-l"><circle cx="8" cy="11.5" r="3.2"/></clipPath><clipPath id="owl-eye-r"><circle cx="16" cy="11.5" r="3.2"/></clipPath></defs>
    <path fill="currentColor" fill-rule="evenodd" d="M3 3.5 8 6Q12 4.5 16 6l5-2.5v9C21 18 17 21 12 21S3 18 3 12.5V3.5ZM11.2 11.5a3.2 3.2 0 1 0-6.4 0 3.2 3.2 0 0 0 6.4 0Zm8 0a3.2 3.2 0 1 0-6.4 0 3.2 3.2 0 0 0 6.4 0ZM10.4 15.5 12 18l1.6-2.5h-3.2Z"/>
    <g clip-path="url(#owl-eye-l)"><circle class="owl-pupil" cx="8" cy="11.5" r="1.3" fill="currentColor"/><rect class="owl-lid" x="4.6" y="8.2" width="6.8" height="6.6" fill="currentColor" style="transform:scaleY(0)"/></g>
    <g clip-path="url(#owl-eye-r)"><circle class="owl-pupil" cx="16" cy="11.5" r="1.3" fill="currentColor"/><rect class="owl-lid" x="12.6" y="8.2" width="6.8" height="6.6" fill="currentColor" style="transform:scaleY(0)"/></g>
  </svg></div>`
  const svg = root.querySelector('svg'), body = root.firstElementChild
  const pupils = [...root.querySelectorAll('.owl-pupil')]
  const lids = [...root.querySelectorAll('.owl-lid')]
  const still = reduced()
  let look = [0, 0], want = [0, 0], frame = 0, timer = 0, lastMove = 0

  function blink(times = 1) {
    if (still) return
    let n = 0
    const one = () => {
      lids.forEach((lid) => lid.animate([{ transform: 'translateY(0) scaleY(0)' }, { transform: 'translateY(0) scaleY(1)', offset: 0.5 }, { transform: 'translateY(0) scaleY(0)' }], { duration: 170, easing: 'ease-in-out' }))
      if (++n < times) setTimeout(one, 240)
    }
    one()
  }
  // the lids scale from their top edge
  lids.forEach((lid) => { lid.style.transformBox = 'fill-box'; lid.style.transformOrigin = 'top'; lid.style.transform = 'scaleY(0)' })

  function aim(x, y) {
    const r = svg.getBoundingClientRect()
    const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height * 0.48)
    const d = Math.hypot(dx, dy) || 1
    const k = Math.min(1, d / 220) * 1.55
    want = [(dx / d) * k, (dy / d) * k]
  }
  function tick() {
    if (performance.now() - lastMove > 2500) { const p = watch?.(); if (p) aim(p.x, p.y) }
    look = [look[0] + (want[0] - look[0]) * 0.18, look[1] + (want[1] - look[1]) * 0.18]
    pupils.forEach((p) => p.setAttribute('transform', `translate(${look[0].toFixed(2)} ${look[1].toFixed(2)})`))
    frame = requestAnimationFrame(tick)
  }
  // now and then: a blink, a look around, a tilt of the head – or duck away and peek again
  function idle() {
    const roll = Math.random()
    if (roll < 0.45) blink(Math.random() < 0.3 ? 2 : 1)
    else if (roll < 0.7 && performance.now() - lastMove > 2500 && !watch?.()) { const a = Math.random() * TAU; want = [Math.cos(a) * 1.5, Math.sin(a) * 1.1] }
    else if (roll < 0.85) svg.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-9deg)', offset: 0.3 }, { transform: 'rotate(-9deg)', offset: 0.7 }, { transform: 'rotate(0)' }], { duration: 1400, easing: 'ease-in-out' })
    else peek()
    timer = setTimeout(idle, 2200 + Math.random() * 3200)
  }
  function peek() {
    body.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(78%)', offset: 0.35 }, { transform: 'translateY(78%)', offset: 0.6 }, { transform: 'translateY(-6%)', offset: 0.85 }, { transform: 'translateY(0)' }], { duration: 1500, easing: 'cubic-bezier(.3,.7,.4,1)' })
    setTimeout(() => blink(2), 1250)
  }
  if (!still) {
    body.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(100%)', offset: 0.25 }, { transform: 'translateY(-8%)', offset: 0.8 }, { transform: 'translateY(0)' }], { duration: 1300, easing: 'cubic-bezier(.3,.7,.4,1)' })
    setTimeout(() => blink(2), 1400)
    addEventListener('pointermove', (e) => { lastMove = performance.now(); aim(e.clientX, e.clientY) }, { passive: true })
    frame = requestAnimationFrame(tick)
    timer = setTimeout(idle, 3000)
    root.addEventListener('click', peek)
  }
  return { stop: () => { cancelAnimationFrame(frame); clearTimeout(timer) } }
}
