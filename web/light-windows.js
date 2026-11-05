// Window frames in a picture of the whole screen – for "Bildschirmfreigabe light": the
// presenter shares the whole screen and picks one window of it; viewers only get that part.
//
// Browsers do not tell a page where windows are, so they are looked for in the picture: long
// straight edges (rows or columns where the brightness jumps), joined where a horizontal and a
// vertical edge meet in a corner, and each rectangle scored by how much of its four sides really
// are edges. A window partly covered by another one keeps most of its sides.

const T = 10 // brightness jump (0..255) that counts as an edge
const GAP = 2 // pixels an edge may be interrupted
const CORNER = 5 // pixels between the ends of two edges that still make a corner (rounded corners)

/**
 * @param {{width, height, px: Float32Array}} g the screen in grayscale (about 640 px wide is enough)
 * @returns {{x, y, w, h, score}[]} rectangles, 0..1 of the picture, largest first
 */
export function detectWindows(g) {
  const { width: W, height: H, px } = g
  const at = (x, y) => px[y * W + x]
  // edge strength across a row boundary (horizontal edges) and a column boundary (vertical ones)
  const hEdge = (x, y) => (y > 0 && y < H ? Math.abs(at(x, y) - at(x, y - 1)) : 0)
  const vEdge = (x, y) => (x > 0 && x < W ? Math.abs(at(x, y) - at(x - 1, y)) : 0)
  const minLen = Math.max(20, Math.round(W * 0.035))

  const runs = (length, count, edge) => {
    const out = []
    for (let i = 1; i < count; i++) {
      let start = -1
      let gap = 0
      for (let j = 0; j <= length; j++) {
        const on = j < length && edge(i, j) > T
        if (on) {
          if (start < 0) start = j
          gap = 0
        } else if (start >= 0 && ++gap > GAP) {
          const end = j - gap
          if (end - start + 1 >= minLen) out.push({ at: i, from: start, to: end })
          start = -1
          gap = 0
        }
      }
    }
    return out
  }
  // horizontal: at = y, from/to = x; vertical: at = x, from/to = y
  const horizontal = runs(W, H, (y, x) => hEdge(x, y))
  const vertical = runs(H, W, (x, y) => vEdge(x, y))

  // how much of a side really is an edge (±1 px: a border can lie on either side of the line)
  const sideH = (y, x0, x1) => {
    let on = 0
    for (let x = x0; x <= x1; x++) if (hEdge(x, y) > T || hEdge(x, y - 1) > T || hEdge(x, y + 1) > T) on++
    return on / Math.max(1, x1 - x0 + 1)
  }
  const sideV = (x, y0, y1) => {
    let on = 0
    for (let y = y0; y <= y1; y++) if (vEdge(x, y) > T || vEdge(x - 1, y) > T || vEdge(x + 1, y) > T) on++
    return on / Math.max(1, y1 - y0 + 1)
  }
  const near = (a, b) => Math.abs(a - b) <= CORNER

  // corners: a horizontal and a vertical edge meeting at their ends
  const candidates = []
  const consider = (x0, y0, x1, y1) => {
    if (x1 - x0 < W * 0.08 || y1 - y0 < H * 0.08) return
    if (x1 - x0 > W * 0.97 && y1 - y0 > H * 0.9) return // the screen itself
    const sides = [sideH(y0, x0, x1), sideH(y1, x0, x1), sideV(x0, y0, y1), sideV(x1, y0, y1)]
    sides.sort((a, b) => b - a)
    // three sides well, the fourth at least partly (covered by another window)
    const score = (sides[0] + sides[1] + sides[2]) / 3
    if (score >= 0.6 && sides[3] >= 0.25) candidates.push({ x0, y0, x1, y1, score })
  }
  for (const h of horizontal) {
    for (const v of vertical) {
      // top left: both edges start there
      if (near(h.from, v.at) && near(h.at, v.from)) consider(v.at, h.at, h.to, v.to)
      // bottom right: both edges end there
      if (near(h.to, v.at) && near(h.at, v.to)) consider(h.from, v.from, v.at, h.at)
      // top right and bottom left: a window whose other corners are covered
      if (near(h.to, v.at) && near(h.at, v.from)) consider(h.from, h.at, v.at, v.to)
      if (near(h.from, v.at) && near(h.at, v.to)) consider(v.at, v.from, h.to, h.at)
    }
  }

  // the same window found from several corners: the best of each
  candidates.sort((a, b) => b.score - a.score)
  const kept = []
  const iou = (a, b) => {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
    const inter = ix * iy
    return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter)
  }
  for (const c of candidates) if (!kept.some((k) => iou(k, c) > 0.8)) kept.push(c)
  return kept
    .map((c) => ({ x: c.x0 / W, y: c.y0 / H, w: (c.x1 - c.x0) / W, h: (c.y1 - c.y0) / H, score: +c.score.toFixed(3) }))
    .sort((a, b) => b.w * b.h - a.w * a.h)
}

/**
 * The windows under a point (0..1), largest first – a click picks the first; clicking again on
 * the same spot the next smaller one (a panel inside a window, a dialog over it).
 */
export function windowsAt(windows, p) {
  return windows.filter((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
}

// ---------------------------------------------------------------- by the title bar's buttons
// A macOS window's title bar starts with three round buttons – red, yellow, green, about 20 points
// apart – in colour on the active window (the one the presenter just worked in). Found in the
// screen's picture at full size, they give a window's top left corner for sure; its top and left
// borders, followed from there, give its width and height.

const T_FULL = 8 // brightness jump that counts as a border, at full size

/**
 * The three coloured buttons on a screen's picture (RGBA at full size).
 * @returns {{x, y, gap}[]} the red button's centre and the distance between two buttons (pixels)
 */
export function trafficLights({ width: W, height: H, data }) {
  const kind = new Uint8Array(W * H)
  for (let i = 0, j = 0; i < kind.length; i++, j += 4) {
    const r = data[j]
    const g = data[j + 1]
    const b = data[j + 2]
    if (r > 190 && g > 50 && g < 140 && b > 40 && b < 135 && r - g > 90) kind[i] = 1
    else if (r > 200 && g > 140 && g < 225 && b < 110 && r - b > 110) kind[i] = 2
    else if (g > 150 && r < 120 && b < 130 && g - r > 60) kind[i] = 3
  }
  // round blobs of one colour, 8 to 30 pixels across
  const blobs = [[], [], [], []]
  const seen = new Uint8Array(W * H)
  const stack = []
  for (let i = 0; i < kind.length; i++) {
    if (!kind[i] || seen[i]) continue
    const k = kind[i]
    let n = 0
    let x0 = W
    let x1 = 0
    let y0 = H
    let y1 = 0
    let sx = 0
    let sy = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const p = stack.pop()
      const x = p % W
      const y = (p - x) / W
      n++
      sx += x
      sy += y
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (n > 1200) continue // far too large: not a button (keep marking it seen)
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= kind.length || seen[q] || kind[q] !== k) continue
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue
        seen[q] = 1
        stack.push(q)
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    // (a symbol inside on hover leaves less of it coloured)
    if (n <= 1200 && w >= 8 && w <= 30 && Math.abs(w - h) <= Math.max(2, w * 0.25) && n >= w * h * 0.45) blobs[k].push({ x: sx / n, y: sy / n, d: w })
  }
  const lights = []
  for (const red of blobs[1]) {
    const yellow = blobs[2].find((b) => Math.abs(b.y - red.y) <= 2 + red.d * 0.15 && b.x - red.x > red.d * 1.2 && b.x - red.x < red.d * 2.6)
    if (!yellow) continue
    const gap = yellow.x - red.x
    const green = blobs[3].find((b) => Math.abs(b.y - red.y) <= 2 + red.d * 0.15 && Math.abs(b.x - yellow.x - gap) <= 2 + gap * 0.15)
    if (green) lights.push({ x: red.x, y: red.y, gap: (green.x - red.x) / 2 })
  }
  return lights
}

/**
 * The window whose title bar starts with these buttons: its top and left borders followed from
 * there (pixels, on the picture at full size).
 * @param {{width, height, px}} g the screen's picture in grayscale, full size
 */
export function windowOfLights(g, light) {
  const { width: W, height: H, px } = g
  const at = (x, y) => px[y * W + x]
  const hEdge = (x, y) => (x >= 0 && x < W && y > 0 && y < H ? Math.abs(at(x, y) - at(x, y - 1)) : 0)
  const vEdge = (x, y) => (x > 0 && x < W && y >= 0 && y < H ? Math.abs(at(x, y) - at(x - 1, y)) : 0)
  const gap = Math.max(4, Math.round(light.gap * 0.2))
  // a border followed from a point, along a row or a column (±1 pixel), as long as it goes on
  const runRight = (y, x) => {
    let end = x
    for (let miss = 0; x < W && miss <= gap; x++) {
      if (hEdge(x, y) > T_FULL || hEdge(x, y - 1) > T_FULL || hEdge(x, y + 1) > T_FULL) {
        end = x
        miss = 0
      } else miss++
    }
    return end
  }
  const runDown = (x, y) => {
    let end = y
    for (let miss = 0; y < H && miss <= gap; y++) {
      if (vEdge(x, y) > T_FULL || vEdge(x - 1, y) > T_FULL || vEdge(x + 1, y) > T_FULL) {
        end = y
        miss = 0
      } else miss++
    }
    return end
  }
  const cx = Math.round(light.x)
  const cy = Math.round(light.y)
  // the top border: the nearest row above the buttons with a long border to the right (further up
  // there may be other lines: the wallpaper, another window); then the strongest of it and its
  // neighbours (the run allows ±1)
  let top = null
  for (let y = Math.round(cy - light.gap * 0.4); y >= Math.max(1, cy - light.gap * 2.4); y--) {
    const end = runRight(y, cx)
    if (end - cx >= light.gap * 4) {
      top = { y, end }
      break
    }
  }
  // the left border: the nearest column left of the buttons with a long border downwards
  let left = null
  for (let x = Math.round(cx - light.gap * 0.3); x >= Math.max(1, cx - light.gap * 2); x--) {
    const end = runDown(x, cy)
    if (end - cy >= light.gap * 3) {
      left = { x, end }
      break
    }
  }
  if (!top || !left) return null
  const along = (n, a, b) => Array.from({ length: n }, (_, i) => Math.round(a + ((b - a) * (i + 0.5)) / n))
  const rowStrength = (y) => along(32, cx, top.end).reduce((s, x) => s + hEdge(x, y), 0)
  const colStrength = (x) => along(32, cy, left.end).reduce((s, y) => s + vEdge(x, y), 0)
  top.y = [top.y - 1, top.y, top.y + 1].sort((a, b) => rowStrength(b) - rowStrength(a))[0]
  left.x = [left.x - 1, left.x, left.x + 1].sort((a, b) => colStrength(b) - colStrength(a))[0]
  // the rounded corners at the other end: the right and bottom borders themselves, nearby
  const reach = Math.round(light.gap * 0.8)
  const strongest = (from, edge, along) => {
    let best = { at: from, s: -1 }
    for (let v = from - 2; v <= from + reach; v++) {
      let s = 0
      for (const a of along) s += edge(v, a)
      if (s > best.s) best = { at: v, s }
    }
    return best.at
  }
  const rows = (y0, y1) => Array.from({ length: 24 }, (_, i) => Math.round(y0 + ((y1 - y0) * (i + 0.5)) / 24))
  const bottom = strongest(left.end + 1, (y, x) => hEdge(x, y), rows(left.x + light.gap, top.end))
  // the right side: where both the top and the bottom border end (a line on the wallpaper may go on
  // from one of them, hardly from both)
  const bottomEnd = runRight(bottom, Math.round(left.x + light.gap))
  const right = strongest(Math.min(top.end, bottomEnd > left.x + light.gap * 4 ? bottomEnd : top.end) + 1, (x, y) => vEdge(x, y), rows(cy, left.end))
  return { x: left.x, y: top.y, width: right - left.x, height: bottom - top.y }
}

/**
 * The three round buttons at the start of a window's title bar – in colour or grey (inactive),
 * on a light or dark bar – near the top left corner of `rect` (pixels of `g`, the screen in
 * grayscale at full size). scale: pixels per point. Their shape is compared, not their colour
 * (normalized cross-correlation, either sign: darker or lighter than the bar).
 * @returns {{x, y, gap, score} | null} x: the first button's centre, y: their centre line
 */
export function titleButtons(g, rect, scale = 1) {
  // (sizes differ between macOS versions – newer ones draw them larger, further apart, as rings –
  // and the pixels per point may not be known for sure: several sizes, around the expected one)
  let top = null
  const seen = new Set()
  for (const k of [scale, 1, 2]) {
    for (const [d, gap] of [[12, 20], [14, 22], [16, 24], [17, 26]]) {
      const key = `${Math.round(d * k)},${Math.round(gap * k)}`
      if (seen.has(key)) continue
      seen.add(key)
      const b = buttonsOfSize(g, rect, d * k, gap * k, k)
      if (b && (!top || b.score > top.score)) top = { ...b, k }
    }
  }
  // (on a real screen: the grey buttons of an inactive window about 0.65–0.7, elsewhere at most 0.4)
  return top && top.score >= 0.5 ? top : null
}

function buttonsOfSize(g, rect, d, gap, scale) {
  const tw = Math.round(2 * gap + d + 4 * scale)
  const th = Math.round(d + 4 * scale)
  // the three buttons on the bar, as templates without their mean: filled discs, and rings (a
  // darker edge around a light fill, as newer macOS draws inactive ones)
  const r = d / 2
  const template = (ring) => {
    const tpl = new Float32Array(tw * th)
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        let v = 0
        for (let i = 0; i < 3; i++) {
          const dist = Math.hypot(x + 0.5 - (2 * scale + r + i * gap), y + 0.5 - th / 2)
          v = Math.max(v, ring ? Math.max(0, 1 - Math.abs(dist - r + 0.5)) : Math.min(1, Math.max(0, r + 0.5 - dist)))
        }
        tpl[y * tw + x] = v
      }
    }
    let mean = 0
    for (const v of tpl) mean += v
    mean /= tpl.length
    let vt = 0
    for (let i = 0; i < tpl.length; i++) {
      tpl[i] -= mean
      vt += tpl[i] * tpl[i]
    }
    return { tpl, vt }
  }
  const disc = template(false)
  const ring = template(true)
  const { width: W, height: H, px } = g
  // (a little above and left of the frame, too: with large rounded corners the frame found may
  // start a few pixels inside the window)
  const x0 = Math.max(0, Math.round(rect.x - 6 * scale))
  const x1 = Math.min(W - tw, Math.round(rect.x + 30 * scale))
  const y0 = Math.max(0, Math.round(rect.y - 12 * scale))
  const y1 = Math.min(H - th, Math.round(rect.y + 46 * scale))
  let top = null
  const n = tw * th
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let s = 0
      let ss = 0
      let c1 = 0
      let c2 = 0
      for (let ty = 0; ty < th; ty++) {
        let i = (y + ty) * W + x
        let k = ty * tw
        for (let tx = 0; tx < tw; tx++, i++, k++) {
          const v = px[i]
          s += v
          ss += v * v
          c1 += v * disc.tpl[k]
          c2 += v * ring.tpl[k]
        }
      }
      const vi = ss - (s * s) / n
      // (a plain bar: nothing round on it)
      if (vi < n * 2) continue
      const score = Math.max(Math.abs(c1) / Math.sqrt(vi * disc.vt), Math.abs(c2) / Math.sqrt(vi * ring.vt))
      if (!top || score > top.score) top = { x: x + 2 * scale + r, y: y + th / 2, gap, score }
    }
  }
  return top
}

/**
 * The close button of a Windows, GNOME or KDE title bar: an "✕" near the top right corner of
 * `rect` (in a circle or not, either sign). Same method as titleButtons.
 * @returns {{x, y, size, score} | null} its centre
 */
export function closeButton(g, rect, scale = 1) {
  const { width: W, height: H, px } = g
  let top = null
  for (const size of [10, 14]) {
    const s = Math.max(6, Math.round(size * scale))
    const t = s + Math.round(6 * scale)
    const tpl = new Float32Array(t * t)
    const c = (t - 1) / 2
    const half = s / 2
    const line = Math.max(1, 0.8 * scale)
    for (let y = 0; y < t; y++) {
      for (let x = 0; x < t; x++) {
        const dx = x - c
        const dy = y - c
        if (Math.abs(dx) > half || Math.abs(dy) > half) continue
        // distance to either diagonal
        const d = Math.min(Math.abs(dx - dy), Math.abs(dx + dy)) / Math.SQRT2
        tpl[y * t + x] = Math.max(0, Math.min(1, line + 0.5 - d))
      }
    }
    let mean = 0
    for (const v of tpl) mean += v
    mean /= tpl.length
    let vt = 0
    for (let i = 0; i < tpl.length; i++) {
      tpl[i] -= mean
      vt += tpl[i] * tpl[i]
    }
    const n = t * t
    const x0 = Math.max(0, Math.round(rect.x + rect.width - 64 * scale))
    const x1 = Math.min(W - t, Math.round(rect.x + rect.width - t))
    const y0 = Math.max(0, Math.round(rect.y + 1 * scale))
    const y1 = Math.min(H - t, Math.round(rect.y + 46 * scale))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let sum = 0
        let ss = 0
        let cov = 0
        for (let ty = 0; ty < t; ty++) {
          let i = (y + ty) * W + x
          let k = ty * t
          for (let tx = 0; tx < t; tx++, i++, k++) {
            const v = px[i]
            sum += v
            ss += v * v
            cov += v * tpl[k]
          }
        }
        const vi = ss - (sum * sum) / n
        if (vi < n * 4) continue
        const score = Math.abs(cov) / Math.sqrt(vi * vt)
        if (!top || score > top.score) top = { x: x + c, y: y + c, size: s, score }
      }
    }
  }
  return top && top.score >= 0.6 ? top : null
}

/**
 * The line of a window's title, to read – and whether it has a title bar at all: beside the three
 * buttons of a Mac (left), else left of the close button (Windows: the title at the left, after
 * minimize and maximize; GNOME, KDE: in the middle). null: no title bar found.
 * @param {'mac' | 'windows' | 'linux'} platform
 * @returns {{y, x0, x1} | null} pixels of g
 */
export function titleLine(g, rect, scale = 1, platform = 'mac') {
  // (the Mac's buttons first, wherever: a Mac shared from another computer's browser looks the same)
  const b = titleButtons(g, rect, scale)
  // (measured by the buttons themselves: their size says the pixels per point)
  if (b) return { y: b.y, x0: b.x + 2.7 * b.gap, x1: rect.x + rect.width - 0.6 * b.gap, k: b.gap / 20 }
  const c = closeButton(g, rect, scale)
  if (!c) return null
  // (Windows: minimize and maximize, 46 points each, left of it)
  const buttons = platform === 'windows' ? 2 * 46 * scale + 24 * scale : 3 * 26 * scale
  return { y: c.y, x0: rect.x + 8 * scale, x1: c.x - buttons, k: scale }
}

/** The platform as the browser says (for titleLine). */
export function platformOf(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const p = nav.userAgentData?.platform ?? nav.platform ?? ''
  return /mac/i.test(p) ? 'mac' : /win/i.test(p) ? 'windows' : 'linux'
}

// ---------------------------------------------------------------- windows by their title bar's buttons
// The surest sign of a window is its title bar: on a Mac three round buttons at its top left (in
// colour on the active window, grey or as rings on the others), on Windows "─ □ ✕" at its top right.
// They are looked for on the whole picture – small marks that stand out from their surroundings,
// in the right shape and arrangement – and each window is followed from them: its top border and
// its side border, as far as they go. A part of the screen without such buttons (a panel, the
// content of a window) is no window of its own.

const MARK = 7 // brightness difference from the surroundings that makes a pixel part of a mark
const AROUND = 7 // … the surroundings: (2·7+1)² pixels

/**
 * The windows on a picture of the screen (RGBA at full size), found by their title bars.
 * @returns {{x, y, width, height, kind: 'mac' | 'windows', active: boolean, line: {y, x0, x1, k}}[]}
 *   pixels; line: where its title is (light-title.js titleBar); active: coloured buttons
 */
export function findWindows({ width: W, height: H, data }) {
  const n = W * H
  const g = new Float32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  // the surroundings' mean brightness, from an integral image
  const iw = W + 1
  const sum = new Float64Array(iw * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      row += g[y * W + x]
      sum[(y + 1) * iw + x + 1] = sum[y * iw + x + 1] + row
    }
  }
  const mean = (x, y) => {
    const x0 = Math.max(0, x - AROUND)
    const y0 = Math.max(0, y - AROUND)
    const x1 = Math.min(W, x + AROUND + 1)
    const y1 = Math.min(H, y + AROUND + 1)
    return (sum[y1 * iw + x1] - sum[y0 * iw + x1] - sum[y1 * iw + x0] + sum[y0 * iw + x0]) / ((x1 - x0) * (y1 - y0))
  }
  // marks: darker (1) or lighter (2) than their surroundings
  const mark = new Uint8Array(n)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = g[y * W + x] - mean(x, y)
      if (d < -MARK) mark[y * W + x] = 1
      else if (d > MARK) mark[y * W + x] = 2
    }
  }
  // the marks as connected parts, small ones only (buttons, glyphs)
  const parts = []
  const seen = new Uint8Array(n)
  const stack = []
  for (let i = 0; i < n; i++) {
    if (!mark[i] || seen[i]) continue
    const kind = mark[i]
    let x0 = W
    let y0 = H
    let x1 = 0
    let y1 = 0
    let count = 0
    let r = 0
    let gr = 0
    let b = 0
    const pixels = []
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const p = stack.pop()
      const x = p % W
      const y = (p - x) / W
      count++
      if (count <= 2000) pixels.push(p)
      r += data[p * 4]
      gr += data[p * 4 + 1]
      b += data[p * 4 + 2]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * W + dx
          if (q < 0 || q >= n || seen[q] || mark[q] !== kind || Math.abs((q % W) - x) > 1) continue
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (w > 48 || h > 48 || w < 5 || h < 5) continue
    parts.push({ x0, y0, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, count, kind, pixels, width: W, colour: [r / count, gr / count, b / count] })
  }

  const windows = []
  const edges = edgeTools(g, W, H)
  for (const a of macButtons(parts)) {
    const r = edges.fromTopLeft(a.x, a.y, a.gap)
    if (r && r.width >= Math.max(150, 7 * a.gap) && r.height >= Math.max(100, 4 * a.gap)) windows.push({ ...r, kind: 'mac', active: a.coloured, line: { y: a.y, x0: a.x + 2.7 * a.gap, x1: r.x + r.width - 0.6 * a.gap, k: a.gap / 20 } })
  }
  for (const c of windowsButtons(parts, W)) {
    const r = edges.fromTopRight(c.x, c.y, c.size)
    const k = c.size / 10
    if (r && r.width >= Math.max(200, 20 * c.size) && r.height >= Math.max(120, 12 * c.size)) windows.push({ ...r, kind: 'windows', active: false, line: { y: c.y, x0: r.x + 8 * k, x1: c.x - 2 * 46 * k - 12 * k, k } })
  }
  // one each (a window's buttons found twice, or a window inside another found by the same buttons)
  const kept = []
  for (const w of windows.sort((a, b) => b.width * b.height - a.width * a.height)) {
    if (!kept.some((k) => Math.abs(k.x - w.x) < 8 && Math.abs(k.y - w.y) < 8)) kept.push(w)
  }
  return kept
}

// three round marks in a row, equally far apart, of one size – the Mac's buttons
function macButtons(parts) {
  const round = parts.filter((p) => {
    const fill = p.count / (p.w * p.h)
    if (p.w < 7 || p.w > 34 || Math.abs(p.w - p.h) > Math.max(2, p.w * 0.25) || fill < 0.2 || fill > 0.95) return false
    // really round – a disc or a ring, not an arrow or a letter: nothing outside the circle, and
    // something in each quarter of it
    const r = Math.max(p.w, p.h) / 2
    const W = p.width
    let outside = 0
    const quarter = [0, 0, 0, 0]
    for (const q of p.pixels) {
      const x = (q % W) + 0.5 - (p.cx + 0.5)
      const y = Math.floor(q / W) + 0.5 - (p.cy + 0.5)
      if (Math.hypot(x, y) > r + 0.75) outside++
      quarter[(x < 0 ? 0 : 1) + (y < 0 ? 0 : 2)]++
    }
    const total = p.pixels.length
    return outside / total < 0.1 && quarter.every((c) => c / total > 0.15)
  })
  round.sort((a, b) => a.cy - b.cy || a.cx - b.cx)
  const found = []
  const near = (p, x, y, d) => round.find((q) => q !== p && Math.abs(q.cx - x) <= Math.max(2, d * 0.2) && Math.abs(q.cy - y) <= Math.max(2, d * 0.2) && Math.abs(q.w - d) <= Math.max(2, d * 0.3))
  for (const a of round) {
    const d = a.w
    for (const b of round) {
      if (b === a || Math.abs(b.cy - a.cy) > Math.max(2, d * 0.15) || Math.abs(b.w - d) > Math.max(2, d * 0.3)) continue
      const gap = b.cx - a.cx
      if (gap < 1.3 * d || gap > 2.4 * d) continue
      if (!near(a, b.cx + gap, a.cy, d)) continue
      // (a longer row of dots – colours to pick, a page indicator – is no title bar)
      if (near(a, a.cx - gap, a.cy, d) || near(a, b.cx + 2 * gap, a.cy, d)) continue
      const coloured = a.colour[0] - a.colour[1] > 60 && a.colour[0] > 150
      found.push({ x: a.cx, y: (a.cy + b.cy) / 2, gap, d, coloured })
    }
  }
  return found
}

// an "✕" with a "□" to its left, about four times its size away – the buttons of a Windows title bar
function windowsButtons(parts, W) {
  const glyph = parts.filter((p) => p.w >= 7 && p.w <= 24 && Math.abs(p.w - p.h) <= Math.max(2, p.w * 0.2))
  const isX = (p) => {
    const on = new Set(p.pixels)
    let diag = 0
    let mid = 0
    const steps = p.w
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1)
      const x = Math.round(p.x0 + t * (p.w - 1))
      const y1 = Math.round(p.y0 + t * (p.h - 1))
      const y2 = Math.round(p.y0 + (1 - t) * (p.h - 1))
      const hit = (xx, yy) => [-1, 0, 1].some((d) => on.has(yy * W + xx + d))
      if (hit(x, y1)) diag++
      if (hit(x, y2)) diag++
      // the middle row and column, away from the crossing
      if (Math.abs(t - 0.5) > 0.3) {
        if (on.has(Math.round(p.cy) * W + x)) mid++
        if (on.has(Math.round(p.y0 + t * (p.h - 1)) * W + Math.round(p.cx))) mid++
      }
    }
    return diag / (2 * steps) > 0.75 && mid / (steps * 0.8) < 0.35
  }
  const isBox = (p) => {
    const fill = p.count / (p.w * p.h)
    return fill > 0.25 && fill < 0.6
  }
  const found = []
  for (const x of glyph.filter(isX)) {
    const s = x.w
    const box = glyph.find((q) => q !== x && isBox(q) && Math.abs(q.cy - x.cy) <= 3 && Math.abs(q.w - s) <= Math.max(3, s * 0.4) && x.cx - q.cx > 2.5 * s && x.cx - q.cx < 7 * s)
    if (box) found.push({ x: x.cx, y: x.cy, size: s })
  }
  return found
}

// following a window's borders from a corner of its title bar
function edgeTools(g, W, H) {
  const T = 8
  const at = (x, y) => g[y * W + x]
  const hEdge = (x, y) => (x >= 0 && x < W && y > 0 && y < H ? Math.abs(at(x, y) - at(x, y - 1)) : 0)
  const vEdge = (x, y) => (x > 0 && x < W && y >= 0 && y < H ? Math.abs(at(x, y) - at(x - 1, y)) : 0)
  const onRow = (x, y) => hEdge(x, y) > T || hEdge(x, y - 1) > T || hEdge(x, y + 1) > T
  const onCol = (x, y) => vEdge(x, y) > T || vEdge(x - 1, y) > T || vEdge(x + 1, y) > T
  // a border followed along a row or column as long as it goes on (gaps up to `gap`)
  const run = (from, to, step, on, gap) => {
    let end = from
    for (let v = from, miss = 0; v !== to && miss <= gap; v += step) {
      if (on(v)) {
        end = v
        miss = 0
      } else miss++
    }
    return end
  }
  const strongest = (from, to, strength) => {
    let best = null
    for (let v = Math.round(from); v <= Math.round(to); v++) {
      const s = strength(v)
      if (!best || s > best.s) best = { v, s }
    }
    return best?.v
  }
  const along = (n, a, b) => Array.from({ length: n }, (_, i) => Math.round(a + ((b - a) * (i + 0.5)) / n))
  // how much of a line really is a border (0..1)
  const coverRow = (y, x0, x1) => along(48, x0, x1).filter((x) => onRow(x, y)).length / 48
  const coverCol = (x, y0, y1) => along(48, y0, y1).filter((y) => onCol(x, y)).length / 48
  return {
    /** from the Mac's first button (centre x, y; gap between buttons) */
    fromTopLeft(bx, by, gap) {
      const cx = Math.round(bx)
      const cy = Math.round(by)
      const holes = Math.max(4, Math.round(gap * 0.25))
      // the top border: the nearest row above the buttons with a long border; the left one likewise
      let top = null
      for (let y = Math.round(cy - gap * 0.35); y >= Math.max(1, cy - gap * 2.4) && !top; y--) {
        const end = run(cx, W, 1, (x) => onRow(x, y), holes)
        if (end - cx >= gap * 5) top = { y, end }
      }
      let left = null
      for (let x = Math.round(cx - gap * 0.3); x >= Math.max(1, cx - gap * 2) && !left; x--) {
        const end = run(cy, H, 1, (y) => onCol(x, y), holes)
        if (end - cy >= gap * 3) left = { x, end }
      }
      if (!top || !left) return null
      const ty = strongest(top.y - 1, top.y + 1, (y) => along(32, cx, top.end).reduce((s, x) => s + hEdge(x, y), 0))
      const lx = strongest(left.x - 1, left.x + 1, (x) => along(32, cy, left.end).reduce((s, y) => s + vEdge(x, y), 0))
      // the right border where the top one ends; the bottom where the left or the right border ends –
      // whichever is a line across the whole window (one border may stop early where the window is
      // as dark as the desktop; one may go on along a neighbouring window)
      const r1 = strongest(top.end - 2, Math.min(W - 1, top.end + gap), (x) => along(24, cy, left.end).reduce((s, y) => s + vEdge(x, y), 0))
      const rightEnd = run(cy, H, 1, (y) => onCol(r1, y), holes)
      const bottoms = [left.end, rightEnd].map((e) => strongest(e - 2, Math.min(H - 1, e + gap), (y) => along(24, lx + gap, r1 - gap).reduce((s, x) => s + hEdge(x, y), 0)))
      // (the lower one, when it is a line across the window – a line inside it, under a toolbar, goes
      // across, too, but higher up)
      const [low, high] = bottoms.sort((a, b) => b - a)
      const bottom = coverRow(low, lx + gap, r1 - gap) >= 0.5 || coverRow(high, lx + gap, r1 - gap) < 0.5 ? low : high
      // (a line on the desktop may go on from the top border: then the bottom one ends earlier, at
      // a real right border)
      let right = r1
      if (coverCol(r1, cy, bottom) < 0.5) {
        const bottomEnd = run(Math.round(lx + gap), W, 1, (x) => onRow(x, bottom), holes)
        const alt = strongest(bottomEnd - 2, Math.min(W - 1, bottomEnd + gap), (x) => along(24, cy, bottom).reduce((s, y) => s + vEdge(x, y), 0))
        // (a real right border goes up to the title bar – an overlapping window's edge does not)
        if (alt > lx + gap * 5 && coverCol(alt, cy, bottom) > coverCol(r1, cy, bottom) && coverCol(alt, cy, cy + gap * 3) > 0.6) right = alt
      }
      return { x: lx, y: ty, width: right - lx, height: bottom - ty }
    },
    /** from the "✕" of a Windows title bar (centre x, y; its size) */
    fromTopRight(bx, by, size) {
      const cx = Math.round(bx)
      const cy = Math.round(by)
      const k = size / 10
      const holes = Math.max(4, Math.round(6 * k))
      let top = null
      for (let y = Math.round(cy - size * 0.8); y >= Math.max(1, cy - 30 * k) && !top; y--) {
        const end = run(cx, -1, -1, (x) => onRow(x, y), holes)
        if (cx - end >= 150 * k) top = { y, end }
      }
      let right = null
      for (let x = Math.round(cx + size * 0.8); x <= Math.min(W - 2, cx + 40 * k) && !right; x++) {
        const end = run(cy, H, 1, (y) => onCol(x, y), holes)
        if (end - cy >= 80 * k) right = { x, end }
      }
      if (!top || !right) return null
      const left = strongest(Math.max(1, top.end - 4 * k), top.end + 2, (x) => along(24, cy, right.end).reduce((s, y) => s + vEdge(x, y), 0))
      const bottom = strongest(right.end - 2, Math.min(H - 1, right.end + 10 * k), (y) => along(24, left, right.x).reduce((s, x) => s + hEdge(x, y), 0))
      return { x: left, y: top.y, width: right.x - left, height: bottom - top.y }
    },
  }
}
