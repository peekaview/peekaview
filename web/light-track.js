// "Bildschirmfreigabe light": following the picked window when it is moved. The whole screen is
// shared and only the picked part sent; when the presenter drags the window elsewhere, it is
// found again – by its title bar: it stays the same while the content scrolls or changes, and
// only its contrast changes between an active and an inactive window (which the comparison,
// normalized cross-correlation, does not mind). The window's own picture and the frames on the
// screen bring the places to look at; the title bar decides, to the pixel.

import { bestTiled, grayFrom } from './light-locate.js'
import { detectWindows } from './light-windows.js'

const COARSE_WIDTH = 320 // the screen at this width for the search over all positions
const TITLE_HEIGHT = 28 // a title bar (points); a toolbar below it is left out
const SIDE = 12 // its rounded corners (points), left out
const SURE = 0.75 // the title bar matches this well: it is the window
const MATCH = 0.6 // … at another place, among the candidates
const CONTENT = 0.6 // the window's own picture (no title bar to compare): this well
const EDGE = 0.04 // share of the window's picture left out at each side (shadow, rounded corners)
const TITLE = 0.08 // … and at the top: its title bar differs between active and inactive

/**
 * The screen's picture, a part of it scaled: grab({x, y, width, height}, w, h) → {width, height, px}.
 * @typedef {(r: {x, y, width, height}, w: number, h: number) => {width, height, px: Float32Array}} Grab
 */

/** Where the title bar lies in a window of this size (pixels; scale: pixels per point). */
export function titleBand(rect, scale = 1) {
  const side = Math.round(SIDE * scale)
  return { x: side, y: 0, width: Math.max(8, rect.width - 2 * side), height: Math.max(8, Math.min(Math.round(TITLE_HEIGHT * scale), Math.round(rect.height * 0.25))) }
}

/** The title bar of a window at `rect` on the screen – to look for it later (null: nothing on it to compare). */
export function titleOf(grab, rect, scale = 1) {
  const band = titleBand(rect, scale)
  const tpl = grab({ x: rect.x + band.x, y: rect.y + band.y, width: band.width, height: band.height }, band.width, band.height)
  const tiles = tilesOf(tpl)
  return tiles.length >= 3 ? { band, tpl, tiles } : null
}

/**
 * The picked part moved onto the window's real edges (a few pixels; the windows found on a small
 * copy of the screen are a little off) – nothing of what lies beside it is shared.
 */
export function snapRect(grab, rect, full, reach = 10) {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  const area = { x: Math.max(0, r.x - reach - 1), y: Math.max(0, r.y - reach - 1) }
  area.width = Math.min(full.width, r.x + r.width + reach + 1) - area.x
  area.height = Math.min(full.height, r.y + r.height + reach + 1) - area.y
  const g = grab(area, area.width, area.height)
  const at = (x, y) => g.px[(y - area.y) * g.width + (x - area.x)]
  // how much the brightness jumps across a line (the middle 80 % of a side)
  const row = (y) => {
    if (y <= area.y || y >= area.y + area.height) return -1
    let s = 0
    const x0 = Math.max(area.x, Math.round(r.x + r.width * 0.1))
    const x1 = Math.min(area.x + area.width - 1, Math.round(r.x + r.width * 0.9))
    for (let x = x0; x <= x1; x++) s += Math.abs(at(x, y) - at(x, y - 1))
    return s / Math.max(1, x1 - x0 + 1)
  }
  const col = (x) => {
    if (x <= area.x || x >= area.x + area.width) return -1
    let s = 0
    const y0 = Math.max(area.y, Math.round(r.y + r.height * 0.1))
    const y1 = Math.min(area.y + area.height - 1, Math.round(r.y + r.height * 0.9))
    for (let y = y0; y <= y1; y++) s += Math.abs(at(x, y) - at(x - 1, y))
    return s / Math.max(1, y1 - y0 + 1)
  }
  // the strongest line near each side (the nearest of equally strong ones)
  const strongest = (from, edge) => {
    let top = { at: from, s: edge(from) }
    for (let d = 1; d <= reach; d++) for (const v of [from - d, from + d]) {
      const s = edge(v)
      if (s > top.s * 1.15) top = { at: v, s }
    }
    return top.s >= 6 ? top.at : from
  }
  const left = strongest(r.x, col)
  const right = strongest(r.x + r.width, col)
  const top = strongest(r.y, row)
  const bottom = strongest(r.y + r.height, row)
  if (right - left < r.width * 0.8 || bottom - top < r.height * 0.8) return r
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Where the window is now.
 * @param {Grab} grab the screen now
 * @param {{width, height}} full the screen's size (pixels)
 * @param {{x, y, width, height}} rect the window's last place (pixels)
 * @param {{title: object|null, windowAt: (w, h) => {width, height, px}, places?: () => {x, y}[]}} known
 *   its title bar (titleOf), its last picture scaled to w × h, and more places it may be at now (asked
 *   for only when it is not where it was: windows found by their title bar buttons)
 * @returns {{rect, how: 'same' | 'moved' | 'frame', score: number, by: 'title' | 'picture' | 'frame'} | null}
 */
export function follow(grab, full, rect, { title, windowAt, places = () => [] }) {
  const fits = (x, y) => x >= 0 && y >= 0 && x + rect.width <= full.width && y + rect.height <= full.height
  let titled = null
  const titledNow = () => (titled ??= places())
  let frames = null
  const W = 640
  const framesNow = () =>
    (frames ??= detectWindows(grab({ x: 0, y: 0, width: full.width, height: full.height }, W, Math.round((full.height * W) / full.width))).map((r) => ({ x: r.x * full.width, y: r.y * full.height, width: r.w * full.width, height: r.h * full.height })))
  // found by its top left corner: is it still as large? (maximized, made smaller)
  const sized = (x, y) => {
    if (hasBorders(grab, full, { x, y, width: rect.width, height: rect.height })) return { x, y, width: rect.width, height: rect.height }
    const exact = titledNow().find((w) => Math.abs(w.x - x) <= 4 && Math.abs(w.y - y) <= 4)
    if (exact) return { x: exact.x, y: exact.y, width: exact.width, height: exact.height }
    const frame = framesNow().find((w) => Math.abs(w.x - x) <= 8 && Math.abs(w.y - y) <= 8)
    if (frame) return snapRect(grab, frame, full)
    return { x, y, width: rect.width, height: rect.height }
  }
  const result = (x, y, score, by) => {
    const r = sized(x, y)
    const same = r.x === rect.x && r.y === rect.y && r.width === rect.width && r.height === rect.height
    return { rect: r, how: same ? 'same' : r.width === rect.width && r.height === rect.height ? 'moved' : 'frame', score, by }
  }

  // still there (or moved a little)? its title bar says so
  if (title) {
    const here = titleAt(grab, full, rect.x, rect.y, title, 3)
    if (here.score >= SURE) return result(here.x, here.y, here.score, 'title')
  }

  const k = Math.max(1, full.width / COARSE_WIDTH)
  const level = (step) => ({
    step,
    screen: grab({ x: 0, y: 0, width: full.width, height: full.height }, Math.round(full.width / step), Math.round(full.height / step)),
    win: inner(windowAt(Math.max(8, Math.round(rect.width / step)), Math.max(8, Math.round(rect.height / step)))),
  })
  const coarseLevel = level(k)
  const { screen, win } = coarseLevel
  // the window's own picture, refined to the pixel from (x, y); 'same' as soon as it is clear
  const refine = (x, y, score) => {
    let p = { x, y, score }
    for (let s = k / 2; ; s /= 2) {
      const L = level(Math.max(1, s))
      const at = { x: Math.round(p.x / L.step) + L.win.ox, y: Math.round(p.y / L.step) + L.win.oy }
      const b = bestTiled(L.screen, L.win, { x0: at.x - 3, y0: at.y - 3, x1: at.x + 3, y1: at.y + 3 })
      p = { x: (b.x - L.win.ox) * L.step, y: (b.y - L.win.oy) * L.step, score: b.score }
      if (L.step <= 2 && Math.abs(p.x - rect.x) < L.step && Math.abs(p.y - rect.y) < L.step && p.score >= CONTENT) return { x: rect.x, y: rect.y, score: p.score }
      if (L.step === 1) break
    }
    return { x: Math.round(p.x), y: Math.round(p.y), score: p.score }
  }

  // no title bar to go by: still there by its picture?
  if (!title) {
    const at = { x: Math.round(rect.x / k) + win.ox, y: Math.round(rect.y / k) + win.oy }
    const near = bestTiled(screen, win, { x0: at.x - 2, y0: at.y - 2, x1: at.x + 2, y1: at.y + 2 })
    if (near.score >= 0.8) {
      const p = refine((near.x - win.ox) * k, (near.y - win.oy) * k, near.score)
      if (p.score >= CONTENT && fits(p.x, p.y)) return result(p.x, p.y, p.score, 'picture')
    }
  }

  // places to look at: windows with a title bar, frames of the same size, and where its picture fits best
  const candidates = framesNow()
    .filter((r) => Math.abs(r.width - rect.width) < rect.width * 0.04 + 8 && Math.abs(r.height - rect.height) < rect.height * 0.04 + 8)
    .map((r) => ({ x: r.x, y: r.y, reach: 8 }))
  for (const p of titledNow()) candidates.unshift({ x: p.x, y: p.y, reach: 3 })
  const coarse = bestTiled(screen, win)
  if (coarse.score > 0.3) candidates.push({ x: (coarse.x - win.ox) * k, y: (coarse.y - win.oy) * k, reach: Math.ceil(k) + 2, picture: coarse.score })

  if (title) {
    let top = null
    for (const c of candidates) {
      const b = titleAt(grab, full, Math.round(c.x), Math.round(c.y), title, c.reach)
      if (b.score >= MATCH && (!top || b.score > top.score)) top = b
    }
    if (top && fits(top.x, top.y)) return result(top.x, top.y, top.score, 'title')
  }

  // no title bar to go by (plain, or covered): the window's own picture, refined to the pixel
  const best = candidates.find((c) => c.picture)
  if (best && best.picture >= CONTENT) {
    const p = refine(best.x, best.y, best.picture)
    if (p.score >= CONTENT && fits(p.x, p.y)) return result(p.x, p.y, p.score, 'picture')
  }

  // still the same frame where it was (its content and title changed), or resized there
  const frame = framesNow().map((r) => ({ r, o: overlap(r, rect) })).filter((c) => c.o > 0.6).sort((a, b) => b.o - a.o)[0]
  if (!frame) return null
  const r = frame.r
  if (Math.abs(r.x - rect.x) <= 6 && Math.abs(r.y - rect.y) <= 6 && Math.abs(r.width - rect.width) <= 8 && Math.abs(r.height - rect.height) <= 8) return { rect, how: 'same', score: frame.o, by: 'frame' }
  return { rect: snapRect(grab, r, full), how: 'frame', score: frame.o, by: 'frame' }
}

/** Are there borders where the right and bottom side of this window would be? (beyond the screen: yes) */
function hasBorders(grab, full, r) {
  const strip = (area, across) => {
    if (area.x < 1 || area.y < 1 || area.x + area.width > full.width || area.y + area.height > full.height) return true
    const g = grab(area, area.width, area.height)
    let best = 0
    // the strongest line in the strip (across: the jump is between columns, else between rows)
    const n = across ? g.width : g.height
    for (let i = 1; i < n; i++) {
      let sum = 0
      const m = across ? g.height : g.width
      for (let j = 0; j < m; j++) sum += across ? Math.abs(g.px[j * g.width + i] - g.px[j * g.width + i - 1]) : Math.abs(g.px[i * g.width + j] - g.px[(i - 1) * g.width + j])
      best = Math.max(best, sum / m)
    }
    return best >= 6
  }
  const right = strip({ x: r.x + r.width - 4, y: Math.round(r.y + r.height * 0.2), width: 8, height: Math.round(r.height * 0.6) }, true)
  const bottom = strip({ x: Math.round(r.x + r.width * 0.2), y: r.y + r.height - 4, width: Math.round(r.width * 0.6), height: 8 }, false)
  return right && bottom
}

/** The best place of the title bar for a window near (x, y), within `reach` pixels; 1:1. */
function titleAt(grab, full, x, y, title, reach) {
  const { band, tpl, tiles } = title
  const area = { x: Math.max(0, x + band.x - reach), y: Math.max(0, y + band.y - reach) }
  area.width = Math.min(full.width, x + band.x + band.width + reach) - area.x
  area.height = Math.min(full.height, y + band.y + band.height + reach) - area.y
  let top = { x, y, score: -Infinity }
  if (area.width < tpl.width || area.height < tpl.height) return top
  const g = grab(area, area.width, area.height)
  for (let dy = 0; dy <= g.height - tpl.height; dy++) {
    for (let dx = 0; dx <= g.width - tpl.width; dx++) {
      const score = tilesScore(g, tiles, dx, dy)
      const wx = area.x + dx - band.x
      const wy = area.y + dy - band.y
      // (equally good: the one nearest to where it was)
      if (score > top.score + 1e-6 || (Math.abs(score - top.score) <= 1e-6 && Math.abs(wx - x) + Math.abs(wy - y) < Math.abs(top.x - x) + Math.abs(top.y - y))) top = { x: wx, y: wy, score }
    }
  }
  return top
}

/**
 * How well a window's title bar (titleOf) matches in a picture, its top left at (ox, oy) of it, give
 * or take a pixel: 0..1.
 */
export function titleScore(g, title, ox, oy) {
  let best = -1
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = ox + dx
      const y = oy + dy
      if (x < 0 || y < 0 || x + title.tpl.width > g.width || y + title.tpl.height > g.height) continue
      best = Math.max(best, tilesScore(g, title.tiles, x, y))
    }
  }
  return best
}

// the title bar cut into squares; the plain ones (nothing to compare) left out
function tilesOf(tpl) {
  const size = tpl.height
  const tiles = []
  for (let ox = 0; ox + size <= tpl.width; ox += size) {
    const n = size * size
    const tc = new Float32Array(n)
    let mean = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mean += tpl.px[y * tpl.width + ox + x]
    mean /= n
    let vt = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = tpl.px[y * tpl.width + ox + x] - mean
        tc[y * size + x] = v
        vt += v * v
      }
    }
    if (vt / n >= 6) tiles.push({ ox, size, tc, vt })
  }
  return tiles
}

// how well the title bar's tiles match at (x, y) of a picture: the mean of the best 70 %
function tilesScore(g, tiles, x, y) {
  const scores = []
  for (const { ox, size, tc, vt } of tiles) {
    const n = size * size
    let s = 0
    let ss = 0
    let cov = 0
    for (let ty = 0; ty < size; ty++) {
      let i = (y + ty) * g.width + x + ox
      let k = ty * size
      for (let tx = 0; tx < size; tx++, i++, k++) {
        const v = g.px[i]
        s += v
        ss += v * v
        cov += v * tc[k]
      }
    }
    const vi = ss - (s * s) / n
    scores.push(vi < n ? 0 : cov / Math.sqrt(vi * vt))
  }
  scores.sort((a, b) => b - a)
  const keep = scores.slice(0, Math.max(3, Math.ceil(scores.length * 0.7)))
  return keep.reduce((a, b) => a + b, 0) / keep.length
}

// the window's picture without its edge and title bar (ox, oy: where that part starts)
function inner(g) {
  const ox = Math.round(g.width * EDGE)
  const oy = Math.round(g.height * TITLE)
  const width = g.width - 2 * ox
  const height = g.height - oy - Math.round(g.height * EDGE)
  const px = new Float32Array(width * height)
  for (let y = 0; y < height; y++) px.set(g.px.subarray((y + oy) * g.width + ox, (y + oy) * g.width + ox + width), y * width)
  return { width, height, px, ox, oy }
}

/** How much two rectangles (pixels) cover each other: 0..1. */
export function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const inter = ix * iy
  return inter / (a.width * a.height + b.width * b.height - inter)
}

/** A picture source (canvas, image) as a Grab, in the browser. */
export function grabberOf(source, canvas = document.createElement('canvas')) {
  return (r, w, h) => {
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, w, h)
    return grayFrom(ctx.getImageData(0, 0, w, h))
  }
}
