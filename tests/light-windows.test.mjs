// Window frames found in a picture of the whole screen ("Bildschirmfreigabe light").
import assert from 'node:assert/strict'
import test from 'node:test'
import { detectWindows, windowsAt } from '../web/light-windows.js'

const W = 640
const H = 400

// a desktop: a smooth wallpaper with some soft blobs
function desktop(seed = 1) {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const px = new Float32Array(W * H)
  const blobs = Array.from({ length: 6 }, () => ({ x: rand() * W, y: rand() * H, r: 60 + rand() * 120, v: rand() * 60 - 30 }))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 70 + (y / H) * 40
      for (const b of blobs) v += b.v * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r * b.r))
      px[y * W + x] = v
    }
  }
  // the menu bar
  for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) px[y * W + x] = 230
  return { width: W, height: H, px }
}

// a window: soft shadow around, a title bar, bright content with a little text
function window(img, r, { seed = 2, dark = false } = {}) {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const set = (x, y, v) => x >= 0 && y >= 0 && x < W && y < H && (img.px[y * W + x] = v)
  // the shadow all around (stronger below), as macOS draws it
  const get = (x, y) => img.px[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))]
  for (let d = 3; d >= 1; d--) {
    const k = 0.72 + d * 0.07
    for (let x = r.x - d; x < r.x + r.w + d; x++) {
      set(x, r.y - d, get(x, r.y - d) * k)
      set(x, r.y + r.h - 1 + d, get(x, r.y + r.h - 1 + d) * (k - 0.08))
    }
    for (let y = r.y - d; y < r.y + r.h + d; y++) {
      set(r.x - d, y, get(r.x - d, y) * k)
      set(r.x + r.w - 1 + d, y, get(r.x + r.w - 1 + d, y) * k)
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const title = y < r.y + 9
      // (dark windows have a fine light outline on macOS)
      const outline = dark && (x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1)
      set(x, y, outline ? 96 : dark ? (title ? 58 : 38) : title ? 222 : 250)
    }
  }
  for (let line = 0; r.y + 16 + line * 7 < r.y + r.h - 4; line++) {
    const y = r.y + 16 + line * 7
    for (let x = r.x + 8; x < r.x + 8 + rand() * (r.w - 20); x += 3) if (rand() < 0.7) set(x, y, dark ? 200 : 60)
  }
}

const close = (found, r, tol = 4) => Math.abs(found.x * W - r.x) <= tol && Math.abs(found.y * H - r.y) <= tol && Math.abs(found.w * W - r.w) <= tol && Math.abs(found.h * H - r.h) <= tol

test('windows on a desktop are found as rectangles, one partly over another', () => {
  const img = desktop()
  const editor = { x: 60, y: 40, w: 330, h: 260 }
  const browser = { x: 300, y: 120, w: 280, h: 220 }
  window(img, editor, { seed: 3 })
  window(img, browser, { seed: 4 })
  const found = detectWindows(img)
  assert.ok(found.some((f) => close(f, editor)), `editor: ${JSON.stringify(found)}`)
  assert.ok(found.some((f) => close(f, browser)), `browser: ${JSON.stringify(found)}`)
  // a click on the part of the editor not covered picks the editor (largest under the point)
  const under = windowsAt(found, { x: 100 / W, y: 200 / H })
  assert.ok(close(under[0], editor))
})

test('a dark window on a dark desktop, and no window at all', () => {
  const img = desktop(5)
  const dark = { x: 150, y: 90, w: 300, h: 200 }
  window(img, dark, { seed: 6, dark: true })
  assert.ok(detectWindows(img).some((f) => close(f, dark)), 'dark window')
  assert.deepEqual(detectWindows(desktop(7)), [], 'only the wallpaper')
})

// ---------------------------------------------------------------- by the title bar's buttons
import { grayFrom } from '../web/light-locate.js'
import { trafficLights, windowOfLights } from '../web/light-windows.js'

// a screen in colour (RGBA): wallpaper, windows with rounded corners, shadow, title bar and buttons
function colourScreen(windows, { width = 1600, height = 1000 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4)
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  const get = (x, y) => {
    const i = (y * width + x) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, [40 + (x / width) * 60, 80 + (y / height) * 50, 140])
  for (const w of windows) {
    const R = 10
    const inside = (x, y) => {
      const dx = Math.max(w.x + R - x, 0, x - (w.x + w.w - 1 - R))
      const dy = Math.max(w.y + R - y, 0, y - (w.y + w.h - 1 - R))
      return dx * dx + dy * dy <= R * R
    }
    // the shadow: darker within 8 px around
    for (let y = w.y - 8; y < w.y + w.h + 12; y++) {
      for (let x = w.x - 8; x < w.x + w.w + 8; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height || inside(x, y)) continue
        const d = Math.min(Math.abs(x - w.x), Math.abs(x - (w.x + w.w)), Math.abs(y - w.y), Math.abs(y - (w.y + w.h)))
        put(x, y, get(x, y).map((v) => v * (0.6 + Math.min(8, d) * 0.04)))
      }
    }
    const bar = w.toolbar ? 52 : 28
    for (let y = w.y; y < w.y + w.h; y++) {
      for (let x = w.x; x < w.x + w.w; x++) {
        if (!inside(x, y)) continue
        const content = (x * 7 + y * 13) % 97 < 3 ? [60, 60, 60] : [252, 252, 252]
        put(x, y, y < w.y + bar ? (w.active ? [232, 232, 232] : [244, 244, 244]) : content)
      }
    }
    // the buttons, 12 px across, 20 px apart
    const colours = w.active ? [[255, 95, 87], [254, 188, 46], [40, 200, 64]] : [[206, 206, 206], [206, 206, 206], [206, 206, 206]]
    colours.forEach((c, i) => {
      const cx = w.x + (w.toolbar ? 20 : 14) + i * 20
      const cy = w.y + bar / 2
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 36) put(cx + x, cy + y, c)
    })
  }
  return { width, height, data }
}

test('the active window is found by its coloured buttons, to the pixel – not the one behind it', () => {
  const behind = { x: 120, y: 90, w: 900, h: 640 }
  const front = { x: 520, y: 260, w: 860, h: 620, active: true, toolbar: true }
  const img = colourScreen([behind, front])
  const lights = trafficLights(img)
  assert.equal(lights.length, 1, JSON.stringify(lights))
  const r = windowOfLights(grayFrom(img), lights[0])
  assert.ok(r && Math.abs(r.x - front.x) <= 1 && Math.abs(r.y - front.y) <= 1 && Math.abs(r.width - front.w) <= 2 && Math.abs(r.height - front.h) <= 2, JSON.stringify(r))
  // a plain title bar (28 points), too
  const plain = { x: 200, y: 150, w: 700, h: 500, active: true }
  const img2 = colourScreen([plain])
  const r2 = windowOfLights(grayFrom(img2), trafficLights(img2)[0])
  assert.ok(r2 && Math.abs(r2.x - plain.x) <= 1 && Math.abs(r2.y - plain.y) <= 1 && Math.abs(r2.width - plain.w) <= 2 && Math.abs(r2.height - plain.h) <= 2, JSON.stringify(r2))
})
