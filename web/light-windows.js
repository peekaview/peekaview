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
  const d = 12 * scale // a button, across
  const gap = 20 * scale // from one to the next
  const tw = Math.round(2 * gap + d + 4 * scale)
  const th = Math.round(d + 4 * scale)
  // the three discs on the bar, as a template without its mean
  const tpl = new Float32Array(tw * th)
  const r = d / 2
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let v = 0
      for (let i = 0; i < 3; i++) {
        const dx = x + 0.5 - (2 * scale + r + i * gap)
        const dy = y + 0.5 - th / 2
        v = Math.max(v, Math.min(1, Math.max(0, r + 0.5 - Math.hypot(dx, dy))))
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
  const { width: W, height: H, px } = g
  const x0 = Math.max(0, Math.round(rect.x + 2 * scale))
  const x1 = Math.min(W - tw, Math.round(rect.x + 30 * scale))
  const y0 = Math.max(0, Math.round(rect.y + 2 * scale))
  const y1 = Math.min(H - th, Math.round(rect.y + 46 * scale))
  let top = null
  const n = tw * th
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let s = 0
      let ss = 0
      let cov = 0
      for (let ty = 0; ty < th; ty++) {
        let i = (y + ty) * W + x
        let k = ty * tw
        for (let tx = 0; tx < tw; tx++, i++, k++) {
          const v = px[i]
          s += v
          ss += v * v
          cov += v * tpl[k]
        }
      }
      const vi = ss - (s * s) / n
      // (a plain bar: nothing round on it)
      if (vi < n * 4) continue
      const score = Math.abs(cov) / Math.sqrt(vi * vt)
      if (!top || score > top.score) top = { x: x + 2 * scale + r, y: y + th / 2, gap, score }
    }
  }
  return top && top.score >= 0.6 ? top : null
}
