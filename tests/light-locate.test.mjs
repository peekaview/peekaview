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
