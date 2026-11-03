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
const FINE_FACTOR = 8 // the position refined on copies this much larger (thin text needs it)
const EDGE = 0.05 // share of the window's width / height left out at each side
const TITLE = 0.12 // … and at the top (title bar, toolbar)
const SCALES = (() => {
  const list = []
  for (let k = 0.25; k <= 3.01; k *= 1.08) list.push(k)
  return list
})()
export const MIN_SCORE = 0.55
// … or most of its tiles match: a window partly covered by others
const MIN_TILES = 0.7
const TILES = { x: 6, y: 5 }

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

/**
 * How well a picture matches at (x, y), tile by tile: the mean of the best 60 % of its tiles –
 * tiles covered by other windows drop out. Flat tiles (nothing to compare) are left out.
 */
export function tileScore(img, tpl, x, y, ints = integrals(img)) {
  const scores = []
  const tw = Math.floor(tpl.width / TILES.x)
  const th = Math.floor(tpl.height / TILES.y)
  if (tw < 4 || th < 4) return 0
  for (let ty = 0; ty < TILES.y; ty++) {
    for (let tx = 0; tx < TILES.x; tx++) {
      const px = new Float32Array(tw * th)
      for (let row = 0; row < th; row++) px.set(tpl.px.subarray((ty * th + row) * tpl.width + tx * tw, (ty * th + row) * tpl.width + tx * tw + tw), row * tw)
      let mean = 0
      for (const v of px) mean += v
      mean /= px.length
      let variance = 0
      for (const v of px) variance += (v - mean) ** 2
      if (variance / px.length < 4) continue
      const at = { x0: x + tx * tw, y0: y + ty * th, x1: x + tx * tw, y1: y + ty * th }
      scores.push(best(img, { width: tw, height: th, px }, at, ints).score)
    }
  }
  if (scores.length < 4) return 0
  scores.sort((a, b) => b - a)
  const top = scores.slice(0, Math.max(4, Math.ceil(scores.length * 0.6)))
  return top.reduce((a, b) => a + b, 0) / top.length
}

/**
 * The best position of `tpl` in `img`, compared tile by tile (see tileScore) – a small, busy
 * window over a bright one (the mini window!) does not spoil the match. About as costly as best().
 */
export function bestTiled(img, tpl, { x0 = 0, y0 = 0, x1 = img.width - tpl.width, y1 = img.height - tpl.height } = {}, ints = integrals(img)) {
  const tw = Math.floor(tpl.width / TILES.x)
  const th = Math.floor(tpl.height / TILES.y)
  let top = { x: -1, y: -1, score: -Infinity }
  if (tw < 3 || th < 3) return best(img, tpl, { x0, y0, x1, y1 }, ints)
  const n = tw * th
  // each tile without its mean; flat ones (nothing to compare) are left out
  const tiles = []
  for (let ty = 0; ty < TILES.y; ty++) {
    for (let tx = 0; tx < TILES.x; tx++) {
      const tc = new Float32Array(n)
      let mean = 0
      for (let row = 0; row < th; row++) for (let col = 0; col < tw; col++) mean += tpl.px[(ty * th + row) * tpl.width + tx * tw + col]
      mean /= n
      let vt = 0
      for (let row = 0; row < th; row++) {
        for (let col = 0; col < tw; col++) {
          const v = tpl.px[(ty * th + row) * tpl.width + tx * tw + col] - mean
          tc[row * tw + col] = v
          vt += v * v
        }
      }
      if (vt / n >= 4) tiles.push({ ox: tx * tw, oy: ty * th, tc, vt })
    }
  }
  if (tiles.length < 4) return best(img, tpl, { x0, y0, x1, y1 }, ints)
  const keep = Math.max(4, Math.ceil(tiles.length * 0.6))
  const scores = new Float64Array(tiles.length)
  for (let y = Math.max(0, y0); y <= Math.min(y1, img.height - tpl.height); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(x1, img.width - tpl.width); x++) {
      for (let t = 0; t < tiles.length; t++) {
        const { ox, oy, tc, vt } = tiles[t]
        const X = x + ox
        const Y = y + oy
        const si = ints.sum[(Y + th) * ints.w + X + tw] - ints.sum[Y * ints.w + X + tw] - ints.sum[(Y + th) * ints.w + X] + ints.sum[Y * ints.w + X]
        const sii = ints.sq[(Y + th) * ints.w + X + tw] - ints.sq[Y * ints.w + X + tw] - ints.sq[(Y + th) * ints.w + X] + ints.sq[Y * ints.w + X]
        const vi = sii - (si * si) / n
        if (vi < 1e-3 * n) {
          scores[t] = 0
          continue
        }
        let cov = 0
        for (let row = 0; row < th; row++) {
          let i = (Y + row) * img.width + X
          let k = row * tw
          for (let col = 0; col < tw; col++) cov += img.px[i++] * tc[k++]
        }
        scores[t] = cov / Math.sqrt(vi * vt)
      }
      scores.sort()
      let sum = 0
      for (let t = scores.length - keep; t < scores.length; t++) sum += scores[t]
      const score = sum / keep
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
 * @param {{hints?: number[]}} [options] hints: likely sizes of the window on the screen's picture
 *   relative to its own picture (1 when both have the same density) – searched first
 * @returns {{x, y, w, h, score, k} | null} the window's place, 0..1 of the screen; k: its size
 *   on the screen's picture relative to its own picture
 */
export function locate(screenAt, windowAt, screenSize, windowSize, info = {}, { hints = [] } = {}) {
  const levels = new Map()
  const level = (factor) => {
    if (levels.has(factor)) return levels.get(factor)
    const s = (COARSE_WIDTH * factor) / screenSize.width
    const img = screenAt(Math.round(screenSize.width * s), Math.round(screenSize.height * s))
    const lv = { s, img, ints: integrals(img) }
    levels.set(factor, lv)
    return lv
  }
  const at = (lv, k) => {
    const full = windowAt(Math.max(1, Math.round(windowSize.width * k * lv.s)), Math.max(1, Math.round(windowSize.height * k * lv.s)))
    return { full, tpl: inner(full) }
  }

  // coarse → size → place, for some sizes
  const search = (scales, stage) => {
    // all positions, on small copies – the best few go on (a plain text window looks much the
    // same at a slightly wrong size there). A tiny picture of a mostly white window matches any
    // bright area: small ones count less.
    const coarse = level(1)
    const hits = []
    for (const k of scales) {
      const { tpl } = at(coarse, k)
      if (tpl.width < 16 || tpl.height < 12 || tpl.width > coarse.img.width || tpl.height > coarse.img.height) continue
      const hit = bestTiled(coarse.img, tpl, {}, coarse.ints)
      if (hit.score > 0.25) hits.push({ ...hit, k, rank: hit.score * Math.min(1, tpl.width / 40) })
    }
    hits.sort((a, b) => b.rank - a.rank)
    const result = { stage, coarse: +(hits[0]?.score ?? 0).toFixed(3) }
    if (!hits.length) return { result }
    const candidates = []
    for (const h of hits) {
      if (candidates.some((c) => Math.abs(c.x - h.x) <= 2 && Math.abs(c.y - h.y) <= 2 && Math.abs(c.k / h.k - 1) < 0.1)) continue
      candidates.push(h)
      if (candidates.length === 6) break
    }
    // size and place, on copies twice as large
    const mid = level(MID_FACTOR)
    const sized = []
    for (const c of candidates) {
      let top = null
      for (const dk of [0.94, 0.97, 1, 1.03, 1.06]) {
        const k = c.k * dk
        const { tpl } = at(mid, k)
        if (tpl.width > mid.img.width || tpl.height > mid.img.height) continue
        const r = 4
        const hit = bestTiled(mid.img, tpl, { x0: c.x * MID_FACTOR - r, y0: c.y * MID_FACTOR - r, x1: c.x * MID_FACTOR + r, y1: c.y * MID_FACTOR + r }, mid.ints)
        if (hit.score > (top?.score ?? -1)) top = { ...hit, k }
      }
      if (top) sized.push(top)
    }
    if (!sized.length) return { result }
    sized.sort((a, b) => b.score - a.score)
    result.mid = +sized[0].score.toFixed(3)
    // the place, to a pixel – for the best three; a match counts as a whole or tile by tile
    const fine = level(FINE_FACTOR)
    const f = FINE_FACTOR / MID_FACTOR
    let winner = null
    for (const c of sized.slice(0, 3)) {
      const { full, tpl } = at(fine, c.k)
      const r = f + 2
      const hit = bestTiled(fine.img, tpl, { x0: c.x * f - r, y0: c.y * f - r, x1: c.x * f + r, y1: c.y * f + r }, fine.ints)
      const tiles = hit.score
      hit.score = best(fine.img, tpl, { x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y }, fine.ints).score
      const strength = Math.max(hit.score / MIN_SCORE, tiles / MIN_TILES)
      if (!winner || strength > winner.strength) winner = { hit, tiles, strength, full, tpl, k: c.k }
    }
    // the size, to half a percent
    for (const dk of [0.985, 0.99, 0.995, 1.005, 1.01, 1.015]) {
      const k = winner.k * dk
      const { full, tpl } = at(fine, k)
      if (tpl.width > fine.img.width || tpl.height > fine.img.height) continue
      const r = 2
      const hit = bestTiled(fine.img, tpl, { x0: winner.hit.x - r, y0: winner.hit.y - r, x1: winner.hit.x + r, y1: winner.hit.y + r }, fine.ints)
      if (hit.score <= winner.tiles) continue
      const whole = best(fine.img, tpl, { x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y }, fine.ints).score
      winner = { hit: { ...hit, score: whole }, tiles: hit.score, strength: Math.max(whole / MIN_SCORE, hit.score / MIN_TILES), full, tpl, k }
    }
    const { hit, tiles, full, tpl, k } = winner
    result.k = +k.toFixed(3)
    result.score = +hit.score.toFixed(3)
    result.tiles = +tiles.toFixed(3)
    // where the best match was (also below the threshold) – for the diagnosis
    result.best = { x: (hit.x - tpl.ex) / fine.img.width, y: (hit.y - tpl.ey) / fine.img.height, w: full.width / fine.img.width, h: full.height / fine.img.height }
    const found = winner.strength >= 1 ? { ...result.best, score: hit.score, tiles, k } : null
    return { result, found }
  }

  // the likely sizes first (same density: 1), then all from a quarter to three times
  const likely = [...new Set(hints.filter((k) => k > 0.1 && k < 10).map((k) => +k.toFixed(3)))].flatMap((k) => [0.9, 0.95, 1, 1.05, 1.1].map((d) => k * d))
  let last = null
  for (const [scales, stage] of [[likely, 'likely'], [SCALES, 'all']]) {
    if (!scales.length) continue
    const { result, found } = search(scales, stage)
    if (!last || (result.score ?? -1) > (last.score ?? -1)) last = result
    if (found) {
      Object.assign(info, result)
      return found
    }
  }
  Object.assign(info, last)
  return null
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
