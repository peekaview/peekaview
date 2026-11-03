// Where a shared *window* lies on the screen – for the helper window of "Bildschirmfreigabe
// light". Browsers never tell a page where other windows are. So the presenter also picks the
// whole screen once (it stays in this browser, viewers never get it), and we look for the
// window's picture in the screen's picture: normalized cross-correlation, coarse on small
// grayscale copies, then refined on larger ones around the best match.
//
// Both pictures come in device pixels at the same density (a window and the screen it is on), so
// the window is searched at its own size; half and double size are tried when that finds nothing.

const COARSE_WIDTH = 192 // the screen at this width for the search over all positions
const FINE_FACTOR = 4 // refined on copies this much larger
const FINE_RADIUS = 5 // ± fine pixels around the coarse match
export const MIN_SCORE = 0.6

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
  const n = tpl.width * tpl.height
  let si = 0
  let sii = 0
  let st = 0
  let stt = 0
  let sit = 0
  for (let ty = 0; ty < tpl.height; ty++) {
    let i = (y + ty) * img.width + x
    let t = ty * tpl.width
    for (let tx = 0; tx < tpl.width; tx++, i++, t++) {
      const a = img.px[i]
      const b = tpl.px[t]
      si += a
      sii += a * a
      st += b
      stt += b * b
      sit += a * b
    }
  }
  const vi = sii - (si * si) / n
  const vt = stt - (st * st) / n
  if (vi < 1e-3 * n || vt < 1e-3 * n) return 0
  return (sit - (si * st) / n) / Math.sqrt(vi * vt)
}

/** The best position of `tpl` in `img` within a range of positions. */
export function best(img, tpl, { x0 = 0, y0 = 0, x1 = img.width - tpl.width, y1 = img.height - tpl.height } = {}) {
  let top = { x: -1, y: -1, score: -Infinity }
  for (let y = Math.max(0, y0); y <= Math.min(y1, img.height - tpl.height); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(x1, img.width - tpl.width); x++) {
      const score = ncc(img, tpl, x, y)
      if (score > top.score) top = { x, y, score }
    }
  }
  return top
}

/**
 * Finds the window in the screen.
 * @param {(w: number, h: number) => {width, height, px}} screenAt the screen's picture scaled to w × h
 * @param {(w: number, h: number) => {width, height, px}} windowAt the window's picture scaled to w × h
 * @param {{width, height}} screenSize, windowSize the pictures' own sizes (device pixels)
 * @returns {{x, y, w, h, score} | null} the window's place, 0..1 of the screen
 */
export function locate(screenAt, windowAt, screenSize, windowSize) {
  const coarse = COARSE_WIDTH / screenSize.width
  const sw = COARSE_WIDTH
  const sh = Math.round(screenSize.height * coarse)
  const screenSmall = screenAt(sw, sh)
  let found = null
  for (const k of [1, 0.5, 2]) {
    const tw = Math.round(windowSize.width * k * coarse)
    const th = Math.round(windowSize.height * k * coarse)
    if (tw < 6 || th < 6 || tw > sw || th > sh) continue
    const hit = best(screenSmall, windowAt(tw, th))
    if (hit.score > (found?.score ?? 0.4)) found = { ...hit, k, tw, th }
    if (found?.score > 0.8) break
  }
  if (!found) return null
  // refined: larger copies, a few pixels around the coarse match
  const f = coarse * FINE_FACTOR
  const big = screenAt(Math.round(screenSize.width * f), Math.round(screenSize.height * f))
  const tpl = windowAt(Math.round(windowSize.width * found.k * f), Math.round(windowSize.height * found.k * f))
  const cx = found.x * FINE_FACTOR
  const cy = found.y * FINE_FACTOR
  const r = FINE_RADIUS + FINE_FACTOR
  const hit = best(big, tpl, { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r })
  if (hit.score < MIN_SCORE) return null
  return { x: hit.x / big.width, y: hit.y / big.height, w: tpl.width / big.width, h: tpl.height / big.height, score: hit.score }
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
