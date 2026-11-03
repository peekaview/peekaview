// Finding a shared window on the screen by its picture ("Bildschirmfreigabe light").
import assert from 'node:assert/strict'
import test from 'node:test'
import { grayFrom, locate, ncc } from '../web/light-locate.js'

// a deterministic "random" picture: blocks of gray values
function noise(width, height, seed, block = 8) {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const cols = Math.ceil(width / block)
  const values = Array.from({ length: cols * Math.ceil(height / block) }, () => rand() * 255)
  const px = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px[y * width + x] = values[Math.floor(y / block) * cols + Math.floor(x / block)]
  return { width, height, px }
}

function paste(into, from, at) {
  const out = { ...into, px: Float32Array.from(into.px) }
  for (let y = 0; y < from.height; y++) for (let x = 0; x < from.width; x++) out.px[(at.y + y) * into.width + at.x + x] = from.px[y * from.width + x]
  return out
}

// area average, as a browser's canvas scales down
function scaled(img, w, h) {
  const px = new Float32Array(w * h)
  const fx = img.width / w
  const fy = img.height / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let sy = Math.floor(y * fy); sy < Math.min(img.height, Math.ceil((y + 1) * fy)); sy++) {
        for (let sx = Math.floor(x * fx); sx < Math.min(img.width, Math.ceil((x + 1) * fx)); sx++) {
          sum += img.px[sy * img.width + sx]
          n++
        }
      }
      px[y * w + x] = sum / n
    }
  }
  return { width: w, height: h, px }
}

test('grayscale from RGBA, and the correlation of a picture with itself is 1', () => {
  const g = grayFrom({ width: 2, height: 1, data: [255, 255, 255, 255, 0, 0, 0, 255] })
  assert.deepEqual([...g.px].map(Math.round), [255, 0])
  const img = noise(40, 30, 7, 4)
  assert.ok(Math.abs(ncc(img, img, 0, 0) - 1) < 1e-6)
  assert.equal(ncc({ width: 4, height: 4, px: new Float32Array(16) }, { width: 2, height: 2, px: Float32Array.of(1, 2, 3, 4) }, 0, 0), 0, 'flat areas match nothing')
})

test('the window is found where it lies on the screen, to a few pixels', () => {
  const screen = noise(1600, 1000, 1, 24)
  const win = noise(500, 320, 2, 10)
  const at = { x: 430, y: 270 }
  const shot = paste(screen, win, at)
  const t0 = performance.now()
  const found = locate((w, h) => scaled(shot, w, h), (w, h) => scaled(win, w, h), shot, win)
  const ms = performance.now() - t0
  assert.ok(found, 'found')
  assert.ok(Math.abs(found.x * 1600 - at.x) <= 6 && Math.abs(found.y * 1000 - at.y) <= 6, JSON.stringify(found))
  assert.ok(Math.abs(found.w * 1600 - 500) <= 6 && Math.abs(found.h * 1000 - 320) <= 6)
  assert.ok(found.score > 0.8)
  assert.ok(ms < 1500, `${Math.round(ms)} ms`)
})

test('partly covered (the helper over it) it is still found; not on the screen it is not', () => {
  const screen = noise(1600, 1000, 3, 24)
  const win = noise(500, 320, 4, 10)
  const at = { x: 900, y: 600 }
  const covered = paste(paste(screen, win, at), noise(150, 100, 5, 10), { x: 1250, y: 820 })
  const found = locate((w, h) => scaled(covered, w, h), (w, h) => scaled(win, w, h), covered, win)
  assert.ok(found && Math.abs(found.x * 1600 - at.x) <= 6 && Math.abs(found.y * 1000 - at.y) <= 6, JSON.stringify(found))
  const elsewhere = noise(500, 320, 6, 10)
  assert.equal(locate((w, h) => scaled(screen, w, h), (w, h) => scaled(elsewhere, w, h), screen, elsewhere), null)
})

// a frame of `width` pixels in `value` around a picture (a window's shadow)
function framed(img, width, value) {
  const out = { width: img.width + 2 * width, height: img.height + 2 * width, px: new Float32Array((img.width + 2 * width) * (img.height + 2 * width)).fill(value) }
  return paste(out, img, { x: width, y: width })
}

function fill(img, rect, value) {
  const out = { ...img, px: Float32Array.from(img.px) }
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) out.px[y * img.width + x] = value
  return out
}

test('the window picture in another resolution than the screen, with a shadow around it', () => {
  const screen = noise(1600, 1000, 11, 24)
  const win = noise(500, 320, 12, 10)
  const at = { x: 610, y: 330 }
  const shot = paste(screen, win, at)
  // captured with 1.57 times the pixels, plus 12 px of dark shadow on each side
  const own = framed(scaled(win, 785, 502), 12, 20)
  const found = locate((w, h) => scaled(shot, w, h), (w, h) => scaled(own, w, h), shot, own)
  assert.ok(found, 'found')
  // the window's picture (with its shadow) lies around the window
  const x = found.x * 1600
  const y = found.y * 1000
  const w = found.w * 1600
  assert.ok(Math.abs(x + (12 / own.width) * w - at.x) <= 8 && Math.abs(y + (12 / own.height) * found.h * 1000 - at.y) <= 8, JSON.stringify(found))
  assert.ok(Math.abs(found.k - 500 / 785) < 0.04, `size ${found.k}`)
})

test('the window not active on the screen (other title bar, grey selection) is still found', () => {
  const screen = noise(1600, 1000, 21, 24)
  const win = noise(500, 320, 22, 10)
  const at = { x: 250, y: 520 }
  // on the screen: title bar and a selected row look different
  const inactive = fill(fill(win, { x: 0, y: 0, w: 500, h: 28 }, 205), { x: 0, y: 150, w: 500, h: 22 }, 180)
  const shot = paste(screen, inactive, at)
  const found = locate((w, h) => scaled(shot, w, h), (w, h) => scaled(win, w, h), shot, win)
  assert.ok(found && Math.abs(found.x * 1600 - at.x) <= 6 && Math.abs(found.y * 1000 - at.y) <= 6, JSON.stringify(found))
})

// a bright window with a little text: white, a title bar, a few short dark lines
function textWindow(width, height, seed) {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  let img = { width, height, px: new Float32Array(width * height).fill(248) }
  img = fill(img, { x: 0, y: 0, w: width, h: 26 }, 225)
  for (let line = 0; line < 14; line++) {
    const y = 50 + line * 22
    if (y + 6 > height) break
    let x = 20
    while (x < width * (0.3 + rand() * 0.5)) {
      const w = Math.round(12 + rand() * 50)
      img = fill(img, { x, y, w: Math.min(w, width - x - 1), h: 6 }, 40 + rand() * 60)
      x += w + 8
    }
  }
  return img
}

test('a bright text window among other bright windows, partly covered (desktop as on a real screen)', () => {
  let screen = noise(1280, 720, 31, 40)
  // other bright windows with text
  screen = paste(screen, textWindow(420, 300, 32), { x: 40, y: 60 })
  screen = paste(screen, textWindow(300, 380, 33), { x: 900, y: 200 })
  const win = textWindow(665, 549, 34)
  const at = { x: 330, y: 80 }
  screen = paste(screen, win, at)
  // panels over a good part of it
  screen = paste(screen, textWindow(260, 200, 35), { x: 560, y: 440 })
  screen = paste(screen, noise(300, 260, 36, 12), { x: 760, y: 120 })
  // and a small copy of it elsewhere (a preview, a thumbnail): looks alike, but is not it
  screen = paste(screen, scaled(win, 166, 137), { x: 1060, y: 40 })
  // the page knows the likely size: both pictures with the same density (as on the DELL screen
  // where this failed: the tiny copy of a white window matched an empty bright area)
  const info = {}
  const found = locate((w, h) => scaled(screen, w, h), (w, h) => scaled(win, w, h), screen, win, info, { hints: [1] })
  assert.ok(found, JSON.stringify(info))
  assert.ok(Math.abs(found.x * 1280 - at.x) <= 6 && Math.abs(found.y * 720 - at.y) <= 6, JSON.stringify(found))
  assert.ok(Math.abs(found.k - 1) < 0.04)
  assert.equal(info.stage, 'likely')
  assert.ok(found.tiles >= 0.7, `most tiles match although a good part is covered: ${found.tiles} (whole: ${found.score})`)
})
