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
