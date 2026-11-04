// "Bildschirmfreigabe light": following the picked window when it is moved. The whole screen is
// shared and only the picked part sent; when the presenter drags the window elsewhere, it is
// found again – by its own picture at its own size (no scaling: it is the same screen), coarse
// over the whole screen, then refined to the pixel. When its content changed too much for that
// (scrolled, a new page), its frame is looked for instead.

import { bestTiled } from './light-locate.js'
import { detectWindows } from './light-windows.js'

const COARSE_WIDTH = 320 // the screen at this width for the search over all positions
const STAY = 0.8 // the window still at its place: its tiles match this well there
const MATCH = 0.6 // … somewhere else
const EDGE = 0.04 // share of the window left out at each side (shadow, rounded corners)
const TITLE = 0.08 // … and at the top: the title bar differs between active and inactive

/**
 * Where the window is now.
 * @param {(w: number, h: number) => {width, height, px}} screenAt the screen now, scaled to w × h
 * @param {(w: number, h: number) => {width, height, px}} windowAt the window's last picture, scaled to w × h
 * @param {{width, height}} full the screen's size (pixels)
 * @param {{x, y, width, height}} rect the window's last place (pixels)
 * @returns {{rect: {x, y, width, height}, how: 'same' | 'moved' | 'frame', score: number} | null}
 */
export function follow(screenAt, windowAt, full, rect) {
  const level = (k) => ({
    k,
    screen: screenAt(Math.round(full.width / k), Math.round(full.height / k)),
    win: inner(windowAt(Math.max(8, Math.round(rect.width / k)), Math.max(8, Math.round(rect.height / k)))),
  })
  // a window's place (pixels) as the place of its inner part on a level, and back
  const toLevel = (L, x, y) => ({ x: Math.round(x / L.k) + L.win.ox, y: Math.round(y / L.k) + L.win.oy })
  const fromLevel = (L, b) => ({ x: (b.x - L.win.ox) * L.k, y: (b.y - L.win.oy) * L.k, score: b.score })
  const around = (L, p, r) => bestTiled(L.screen, L.win, { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r })

  const coarse = level(Math.max(1, full.width / COARSE_WIDTH))
  let frames = null
  const framesNow = () => {
    if (!frames) {
      const W = 640
      frames = detectWindows(screenAt(W, Math.round((full.height * W) / full.width))).map((r) => ({ x: r.x * full.width, y: r.y * full.height, width: r.w * full.width, height: r.h * full.height }))
    }
    return frames
  }

  // still there (or moved a little)?
  let top = fromLevel(coarse, around(coarse, toLevel(coarse, rect.x, rect.y), 2))
  if (top.score < STAY) {
    // moved: first where a frame of the same size is, then over the whole screen
    top = { score: -Infinity }
    const sameSize = framesNow().filter((r) => Math.abs(r.width - rect.width) < rect.width * 0.04 + 8 && Math.abs(r.height - rect.height) < rect.height * 0.04 + 8)
    for (const r of sameSize) {
      const b = fromLevel(coarse, around(coarse, toLevel(coarse, r.x, r.y), 3))
      if (b.score > top.score) top = b
    }
    if (top.score < MATCH) {
      const all = fromLevel(coarse, bestTiled(coarse.screen, coarse.win))
      if (all.score > top.score) top = all
    }
  }
  if (top.score >= MATCH) {
    // refined on copies twice as large each time, around the place found
    let p = top
    for (let k = coarse.k / 2; ; k /= 2) {
      const L = level(Math.max(1, k))
      p = fromLevel(L, around(L, toLevel(L, p.x, p.y), 3))
      // (unmoved on the copy half the size: unmoved – the last step costs the most)
      if (L.k <= 2 && Math.abs(p.x - rect.x) < L.k && Math.abs(p.y - rect.y) < L.k && p.score >= MATCH) return { rect, how: 'same', score: p.score }
      if (L.k === 1) break
    }
    if (p.score >= MATCH) {
      const moved = { x: clamp(Math.round(p.x), 0, full.width - rect.width), y: clamp(Math.round(p.y), 0, full.height - rect.height), width: rect.width, height: rect.height }
      return { rect: moved, how: 'moved', score: p.score }
    }
  }

  // its content changed: still the same frame, or a frame where it was (resized)
  const frame = framesNow().map((r) => ({ r, o: overlap(r, rect) })).filter((c) => c.o > 0.6).sort((a, b) => b.o - a.o)[0]
  if (!frame) return null
  const r = frame.r
  if (Math.abs(r.x - rect.x) <= 6 && Math.abs(r.y - rect.y) <= 6 && Math.abs(r.width - rect.width) <= 8 && Math.abs(r.height - rect.height) <= 8) return { rect, how: 'same', score: frame.o }
  return { rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, how: 'frame', score: frame.o }
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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** How much two rectangles (pixels) cover each other: 0..1. */
export function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const inter = ix * iy
  return inter / (a.width * a.height + b.width * b.height - inter)
}
