// Where a shared *window* lies on the screen – for the helper window of "Bildschirmfreigabe
// light". Browsers never tell a page where other windows are. So the presenter also picks the
// whole screen once (it stays in this browser, viewers never get it), and we look for the
// window's picture in the screen's picture: normalized cross-correlation, coarse on small
// grayscale copies, then refined on larger ones around the best match.
//
// The two pictures need not have the same density: Chrome may capture a window and the screen at
// different resolutions (Retina, its own limits). So the window is searched at sizes from a
// quarter to three times its own, then the size is refined with the position. Its edge (shadow,
// rounded corners) is left out of the comparison, and so is its title bar: a window that is not
// the active one looks different there (grey title, grey buttons) – the shared picture and the
// screen may show it in different states.

const COARSE_WIDTH = 128 // the screen at this width for the search over all positions and sizes
const MID_FACTOR = 2 // the size refined on copies this much larger
const FINE_FACTOR = 4 // the position refined on copies this much larger
const EDGE = 0.05 // share of the window's width / height left out at each side
const TITLE = 0.12 // … and at the top (title bar, toolbar)
const SCALES = (() => {
  const list = []
  for (let k = 0.25; k <= 3.01; k *= 1.08) list.push(k)
  return list
})()
export const MIN_SCORE = 0.55

/** A grayscale picture: {width, height, px: Float32Array} (0..255). */
export function grayFrom({ width, height, data }) {
  const px = new Float32Array(width * height)
  for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  return { width, height, px }
}

/**
 * Normalized cross-correlation of `tpl` placed at (x, y) in `img`; -1..1, 0 for flat areas.
 */
export function ncc(img, tpl, x, y) {
  return best(img, tpl, { x0: x, y0: y, x1: x, y1: y }).score
}

// sums and sums of squares of a picture, for the mean and variance of any rectangle
function integrals(img) {
  const w = img.width + 1
  const sum = new Float64Array(w * (img.height + 1))
  const sq = new Float64Array(w * (img.height + 1))
  for (let y = 0; y < img.height; y++) {
    let row = 0
    let rowSq = 0
    for (let x = 0; x < img.width; x++) {
      const v = img.px[y * img.width + x]
      row += v
      rowSq += v * v
      sum[(y + 1) * w + x + 1] = sum[y * w + x + 1] + row
      sq[(y + 1) * w + x + 1] = sq[y * w + x + 1] + rowSq
    }
  }
  return { w, sum, sq }
}

/** The best position of `tpl` in `img` within a range of positions. */
export function best(img, tpl, { x0 = 0, y0 = 0, x1 = img.width - tpl.width, y1 = img.height - tpl.height } = {}, ints = integrals(img)) {
  const n = tpl.width * tpl.height
  // the template without its mean: its correlation with the picture is the covariance
  let mean = 0
  for (let i = 0; i < n; i++) mean += tpl.px[i]
  mean /= n
  const tc = new Float32Array(n)
  let vt = 0
  for (let i = 0; i < n; i++) {
    tc[i] = tpl.px[i] - mean
    vt += tc[i] * tc[i]
  }
  let top = { x: -1, y: -1, score: -Infinity }
  if (vt < 1e-3 * n) return { ...top, score: 0 }
  for (let y = Math.max(0, y0); y <= Math.min(y1, img.height - tpl.height); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(x1, img.width - tpl.width); x++) {
      const X = x + tpl.width
      const Y = y + tpl.height
      const si = ints.sum[Y * ints.w + X] - ints.sum[y * ints.w + X] - ints.sum[Y * ints.w + x] + ints.sum[y * ints.w + x]
      const sii = ints.sq[Y * ints.w + X] - ints.sq[y * ints.w + X] - ints.sq[Y * ints.w + x] + ints.sq[y * ints.w + x]
      const vi = sii - (si * si) / n
      if (vi < 1e-3 * n) {
        if (top.score < 0) top = { x, y, score: 0 }
        continue
      }
      let cov = 0
      for (let ty = 0; ty < tpl.height; ty++) {
        let i = (y + ty) * img.width + x
        let t = ty * tpl.width
        for (let tx = 0; tx < tpl.width; tx++) cov += img.px[i++] * tc[t++]
      }
      const score = cov / Math.sqrt(vi * vt)
      if (score > top.score) top = { x, y, score }
    }
  }
  return top
}

// the window's picture without its edge and title bar
function inner(g) {
  const ex = Math.round(g.width * EDGE)
  const ey = Math.round(g.height * TITLE)
  const width = g.width - 2 * ex
  const height = g.height - ey - Math.round(g.height * EDGE)
  const px = new Float32Array(width * height)
  for (let y = 0; y < height; y++) px.set(g.px.subarray((y + ey) * g.width + ex, (y + ey) * g.width + ex + width), y * width)
  return { width, height, px, ex, ey }
}

/**
 * Finds the window in the screen.
 * @param {(w: number, h: number) => {width, height, px}} screenAt the screen's picture scaled to w × h
 * @param {(w: number, h: number) => {width, height, px}} windowAt the window's picture scaled to w × h
 * @param {{width, height}} screenSize, windowSize the pictures' own sizes (pixels)
 * @param {object} [info] filled with how the search went (best score and size, also when nothing is found)
 * @returns {{x, y, w, h, score, k} | null} the window's place, 0..1 of the screen; k: its size
 *   on the screen's picture relative to its own picture
 */
export function locate(screenAt, windowAt, screenSize, windowSize, info = {}) {
  const level = (factor) => {
    const s = (COARSE_WIDTH * factor) / screenSize.width
    const img = screenAt(Math.round(screenSize.width * s), Math.round(screenSize.height * s))
    return { s, img, ints: integrals(img) }
  }
  const at = (lv, k) => {
    const full = windowAt(Math.max(1, Math.round(windowSize.width * k * lv.s)), Math.max(1, Math.round(windowSize.height * k * lv.s)))
    return { full, tpl: inner(full) }
  }
  // all sizes, everywhere, on small copies – the best few go on (a plain text window looks much
  // the same at a slightly wrong size there)
  const coarse = level(1)
  const hits = []
  for (const k of SCALES) {
    const { tpl } = at(coarse, k)
    if (tpl.width < 8 || tpl.height < 8 || tpl.width > coarse.img.width || tpl.height > coarse.img.height) continue
    const hit = best(coarse.img, tpl, {}, coarse.ints)
    if (hit.score > 0.25) hits.push({ ...hit, k })
  }
  hits.sort((a, b) => b.score - a.score)
  info.coarse = +(hits[0]?.score ?? 0).toFixed(3)
  if (!hits.length) return null
  const candidates = []
  for (const h of hits) {
    if (candidates.some((c) => Math.abs(c.x - h.x) <= 2 && Math.abs(c.y - h.y) <= 2 && Math.abs(c.k / h.k - 1) < 0.1)) continue
    candidates.push(h)
    if (candidates.length === 6) break
  }
  // size and place, on copies twice as large
  const mid = level(MID_FACTOR)
  let sized = null
  for (const c of candidates) {
    for (const dk of [0.94, 0.97, 1, 1.03, 1.06]) {
      const k = c.k * dk
      const { tpl } = at(mid, k)
      if (tpl.width > mid.img.width || tpl.height > mid.img.height) continue
      const r = 4
      const hit = best(mid.img, tpl, { x0: c.x * MID_FACTOR - r, y0: c.y * MID_FACTOR - r, x1: c.x * MID_FACTOR + r, y1: c.y * MID_FACTOR + r }, mid.ints)
      if (hit.score > (sized?.score ?? -1)) sized = { ...hit, k }
    }
  }
  if (!sized) return null
  info.mid = +sized.score.toFixed(3)
  info.k = +sized.k.toFixed(3)
  // the place, to a pixel
  const fine = level(FINE_FACTOR)
  const { full, tpl } = at(fine, sized.k)
  const f = FINE_FACTOR / MID_FACTOR
  const r = 3
  const hit = best(fine.img, tpl, { x0: sized.x * f - r, y0: sized.y * f - r, x1: sized.x * f + r, y1: sized.y * f + r }, fine.ints)
  info.score = +hit.score.toFixed(3)
  // where the best match was (also below the threshold) – for the diagnosis
  info.best = { x: (hit.x - tpl.ex) / fine.img.width, y: (hit.y - tpl.ey) / fine.img.height, w: full.width / fine.img.width, h: full.height / fine.img.height }
  if (hit.score < MIN_SCORE) return null
  return { x: (hit.x - tpl.ex) / fine.img.width, y: (hit.y - tpl.ey) / fine.img.height, w: full.width / fine.img.width, h: full.height / fine.img.height, score: hit.score, k: sized.k }
}

/** A frame of a picture source scaled into w × h grayscale (in the browser). */
export function scaledGray(source, w, h, canvas = document.createElement('canvas')) {
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return grayFrom(ctx.getImageData(0, 0, w, h))
}
