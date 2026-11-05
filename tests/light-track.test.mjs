// Following the picked window when it is moved ("Bildschirmfreigabe light").
import assert from 'node:assert/strict'
import test from 'node:test'
import { follow, snapRect, titleOf } from '../web/light-track.js'

const W = 1600
const H = 1000

function rng(seed) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

// a desktop with a smooth wallpaper and some windows: {x, y, w, h, seed, dark?} – the last on top
function screenWith(windows, { wallpaper = 1 } = {}) {
  const rand = rng(wallpaper)
  const px = new Float32Array(W * H)
  const blobs = Array.from({ length: 6 }, () => ({ x: rand() * W, y: rand() * H, r: 150 + rand() * 300, v: rand() * 60 - 30 }))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 70 + (y / H) * 40
    for (const b of blobs) v += b.v * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r * b.r))
    px[y * W + x] = v
  }
  const set = (x, y, v) => x >= 0 && y >= 0 && x < W && y < H && (px[y * W + x] = v)
  for (const r of windows) {
    for (let d = 6; d >= 1; d--) {
      for (let x = r.x - d; x < r.x + r.w + d; x++) for (const y of [r.y - d, r.y + r.h - 1 + d]) set(x, y, (px[y * W + x] ?? 0) * (0.7 + d * 0.04))
      for (let y = r.y - d; y < r.y + r.h + d; y++) for (const x of [r.x - d, r.x + r.w - 1 + d]) set(x, y, (px[y * W + x] ?? 0) * (0.7 + d * 0.04))
    }
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, y < r.y + 28 ? (r.inactive ? 236 : 214) : r.dark ? 38 : 250)
    // its title bar: the three buttons (grey when inactive) and the title (lighter when inactive)
    for (const [i, v] of [[0, 120], [1, 175], [2, 140]]) {
      const cx = r.x + 20 + i * 20
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 36) set(cx + x, r.y + 14 + y, r.inactive ? 196 : v)
    }
    const name = rng(r.title ?? r.seed)
    const tx = r.x + r.w / 2 - 80
    for (let x = 0; x < 160; x++) {
      if (name() < 0.3) continue
      for (let y = 9; y < 19; y++) if (name() < 0.6) set(Math.round(tx + x), r.y + y, r.inactive ? 150 : 40)
    }
    // its content: lines of text, (scroll: the lines shifted)
    const text = rng(r.seed)
    for (let line = 0; r.y + 44 + line * 18 < r.y + r.h - 10; line++) {
      const y0 = r.y + 44 + line * 18 - (r.scroll ?? 0)
      if (y0 < r.y + 34) continue
      const len = 40 + text() * (r.w - 80)
      for (let x = r.x + 16; x < r.x + 16 + len; x++) {
        if (text() < 0.25) x += 4
        for (let dy = 0; dy < 9; dy++) if (text() < 0.55) set(x, y0 + dy, r.dark ? 210 : 40)
      }
    }
  }
  return { width: W, height: H, px }
}

// the picture scaled to w × h (area average), as a canvas would
function scaled(g, w, h) {
  const out = new Float32Array(w * h)
  const sx = g.width / w
  const sy = g.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += g.px[yy * g.width + xx]
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return { width: w, height: h, px: out }
}

function cut(g, r) {
  const px = new Float32Array(r.width * r.height)
  for (let y = 0; y < r.height; y++) px.set(g.px.subarray((r.y + y) * g.width + r.x, (r.y + y) * g.width + r.x + r.width), y * r.width)
  return { width: r.width, height: r.height, px }
}

// the screen's picture as the page grabs it: a part of it, scaled
const grabber = (g) => (r, w, h) => scaled(cut(g, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }), w, h)
function run(screen, before, rect, pick = before) {
  const title = titleOf(grabber(pick), { x: 0, y: 0, width: rect.width, height: rect.height })
  return follow(grabber(screen), screen, rect, { title, windowAt: (w, h) => scaled(before, w, h) })
}

const editor = { x: 300, y: 180, w: 700, h: 520, seed: 11 }
const other = { x: 820, y: 420, w: 560, h: 420, seed: 12 }
const rectOf = (r) => ({ x: r.x, y: r.y, width: r.w, height: r.h })

test('a window that stays where it is: unchanged, also when it became inactive', () => {
  const screen = screenWith([other, editor])
  const before = cut(screen, rectOf(editor))
  assert.deepEqual(run(screen, before, rectOf(editor))?.rect, rectOf(editor))
  const inactive = screenWith([{ ...editor, inactive: true }, other])
  const r = run(inactive, before, rectOf(editor))
  assert.equal(r?.how, 'same')
  assert.equal(r.by, 'title')
})

test('a moved window is found by its title bar to the pixel – active or not, its content changed', () => {
  const before = cut(screenWith([other, editor]), rectOf(editor))
  for (const [dx, dy, extra] of [[237, -81, {}], [-283, 117, { inactive: true }], [5, 3, {}], [180, 60, { scroll: 9, seed: 99, inactive: true }]]) {
    const moved = { ...editor, ...extra, x: editor.x + dx, y: editor.y + dy, title: editor.seed }
    const r = run(screenWith([other, moved]), before, rectOf(editor))
    assert.deepEqual(r?.rect, rectOf(moved), `moved by ${dx},${dy}: ${JSON.stringify(r)}`)
    assert.equal(r.how, 'moved')
  }
  // dragged under the other window: a part of it covered
  const under = { ...editor, x: 520, y: 260 }
  const r = run(screenWith([under, other]), before, rectOf(editor))
  assert.deepEqual(r?.rect, rectOf(under), JSON.stringify(r))
})

test('another window with another title is not taken for it; closed: not found', () => {
  const before = cut(screenWith([other, editor]), rectOf(editor))
  // the same size elsewhere, with other content and title
  const twin = { ...editor, x: 600, y: 300, seed: 50, title: 51 }
  assert.equal(run(screenWith([other, twin]), before, rectOf(editor))?.rect?.x === 600, false)
  assert.equal(run(screenWith([other]), before, rectOf(editor)), null)
})

test('the picked part snaps onto the window\'s real edges', () => {
  const screen = screenWith([other, editor])
  const off = { x: editor.x + 4, y: editor.y - 3, width: editor.w - 7, height: editor.h + 5 }
  assert.deepEqual(snapRect(grabber(screen), off, screen), rectOf(editor))
})

test('a window with a quarter or more under another one is covered; one seen whole is not', async () => {
  const { covered } = await import('../web/light-track.js')
  const win = { x: 300, y: 180, w: 700, h: 520, seed: 11 }
  const luma = (screen) => (a) => scaled(cut(screen, a), a.width, a.height)
  assert.equal(await covered(luma(screenWith([win])), rectOf(win), { width: W, height: H }), false)
  // another window over its right half and its bottom
  const over = { x: 640, y: 420, w: 600, h: 450, seed: 13 }
  assert.equal(await covered(luma(screenWith([win, over])), rectOf(win), { width: W, height: H }), true)
  // only a little over a corner: still seen
  const corner = { x: 920, y: 620, w: 400, h: 300, seed: 14 }
  assert.equal(await covered(luma(screenWith([win, corner])), rectOf(win), { width: W, height: H }), false)
})
