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

test('title bar buttons are found also in grey (an inactive window), not on a window without them', async () => {
  const { titleButtons } = await import('../web/light-windows.js')
  const behind = { x: 120, y: 90, w: 900, h: 640 }
  const front = { x: 520, y: 260, w: 860, h: 620, active: true, toolbar: true }
  const g = grayFrom(colourScreen([behind, front]))
  const grey = titleButtons(g, { x: behind.x, y: behind.y, width: behind.w, height: behind.h })
  assert.ok(grey && Math.abs(grey.x - (behind.x + 14)) <= 2 && Math.abs(grey.y - (behind.y + 14)) <= 2, JSON.stringify(grey))
  const coloured = titleButtons(g, { x: front.x, y: front.y, width: front.w, height: front.h })
  assert.ok(coloured && Math.abs(coloured.x - (front.x + 20)) <= 2 && Math.abs(coloured.y - (front.y + 26)) <= 2, JSON.stringify(coloured))
  // a part of a window's content (lines of text), and the wallpaper: none
  assert.equal(titleButtons(g, { x: front.x + 100, y: front.y + 200, width: 300, height: 200 }), null)
  assert.equal(titleButtons(g, { x: 1100, y: 40, width: 400, height: 200 }), null)
})

// Windows and Linux: no coloured buttons – a close button "✕" at the top right
function otherScreen(windows, { width = 1600, height = 1000 } = {}) {
  const px = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px[y * width + x] = 60 + (x / width) * 40
  const set = (x, y, v) => x >= 0 && y >= 0 && x < width && y < height && (px[Math.round(y) * width + Math.round(x)] = v)
  for (const w of windows) {
    const bar = w.bar ?? 32
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) set(x, y, y < w.y + bar ? (w.dark ? 40 : 238) : 252)
    // the close button: an ✕ (GNOME: on a grey disc)
    const cx = w.x + w.w - (w.gnome ? 20 : 23)
    const cy = w.y + bar / 2
    if (w.gnome) for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) if (x * x + y * y <= 144) set(cx + x, cy + y, 215)
    for (let t = -5; t <= 5; t += 0.25) {
      set(cx + t, cy + t, w.dark ? 230 : 30)
      set(cx + t, cy - t, w.dark ? 230 : 30)
    }
    // the title: some letters
    for (let x = 0; x < 120; x += 3) for (let y = -4; y <= 4; y++) if ((x * 7 + y * 3) % 5 < 2) set((w.gnome ? w.x + w.w / 2 - 60 : w.x + 40) + x, cy + y, w.dark ? 220 : 50)
  }
  return { width, height, px }
}

test('Windows and Linux title bars are found by their close button; the line of the title beside it', async () => {
  const { titleLine } = await import('../web/light-windows.js')
  const win = { x: 100, y: 80, w: 700, h: 500 }
  const gnome = { x: 850, y: 120, w: 600, h: 450, gnome: true, bar: 46 }
  const dark = { x: 300, y: 620, w: 500, h: 300, dark: true }
  const g = otherScreen([win, gnome, dark])
  const a = titleLine(g, { x: win.x, y: win.y, width: win.w, height: win.h }, 1, 'windows')
  assert.ok(a && Math.abs(a.y - (win.y + 16)) <= 2 && a.x0 < win.x + 40 && a.x1 < win.x + win.w - 100, JSON.stringify(a))
  const b = titleLine(g, { x: gnome.x, y: gnome.y, width: gnome.w, height: gnome.h }, 1, 'linux')
  assert.ok(b && Math.abs(b.y - (gnome.y + 23)) <= 2 && b.x1 > gnome.x + gnome.w / 2 + 60, JSON.stringify(b))
  const c = titleLine(g, { x: dark.x, y: dark.y, width: dark.w, height: dark.h }, 1, 'windows')
  assert.ok(c && Math.abs(c.y - (dark.y + 16)) <= 2, JSON.stringify(c))
  // the content of a window, the wallpaper: no title bar
  assert.equal(titleLine(g, { x: win.x + 50, y: win.y + 100, width: 400, height: 300 }, 1, 'windows'), null)
  assert.equal(titleLine(g, { x: 1000, y: 650, width: 400, height: 300 }, 1, 'linux'), null)
})

test('title bar buttons are found when the frame found starts a few pixels inside the window (large rounded corners)', async () => {
  const { titleLine } = await import('../web/light-windows.js')
  const win = { x: 300, y: 200, w: 900, h: 600 }
  const g = grayFrom(colourScreen([win]))
  const line = titleLine(g, { x: win.x + 4, y: win.y + 8, width: win.w - 4, height: win.h - 8 }, 1, 'mac')
  assert.ok(line && Math.abs(line.y - (win.y + 14)) <= 2, JSON.stringify(line))
})

test('findWindows: Mac windows by their buttons – the active one and the grey one behind it; nothing on a wallpaper', async () => {
  const { findWindows } = await import('../web/light-windows.js')
  const behind = { x: 120, y: 90, w: 900, h: 640 }
  const front = { x: 520, y: 260, w: 860, h: 620, active: true, toolbar: true }
  const found = findWindows(colourScreen([behind, front]))
  const near = (f, r) => Math.abs(f.x - r.x) <= 3 && Math.abs(f.y - r.y) <= 3 && Math.abs(f.width - r.w) <= 4
  const a = found.find((f) => near(f, front))
  assert.ok(a && a.active && Math.abs(a.height - front.h) <= 4, JSON.stringify(found))
  const b = found.find((f) => near(f, behind))
  assert.ok(b && !b.active, JSON.stringify(found))
  assert.equal(found.length, 2, JSON.stringify(found))
  assert.deepEqual(findWindows(colourScreen([])), [])
})

test('findWindows: a Windows window by "─ □ ✕" at its top right', async () => {
  const { findWindows } = await import('../web/light-windows.js')
  const width = 1400
  const height = 900
  const data = new Uint8ClampedArray(width * height * 4)
  const put = (x, y, v) => {
    const i = (Math.round(y) * width + Math.round(x)) * 4
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, 90 + (y / height) * 40)
  const win = { x: 200, y: 120, w: 900, h: 600 }
  for (let y = win.y - 6; y < win.y + win.h + 6; y++) for (let x = win.x - 6; x < win.x + win.w + 6; x++) {
    const inside = x >= win.x && x < win.x + win.w && y >= win.y && y < win.y + win.h
    put(x, y, inside ? (y < win.y + 32 ? 243 : 252) : 70)
  }
  // the buttons: ─ □ ✕, 46 px apart, glyphs 10 px
  const cy = win.y + 16
  const close = win.x + win.w - 23
  for (let t = -5; t <= 5; t += 0.25) {
    put(close + t, cy + t, 20)
    put(close + t, cy - t, 20)
  }
  const box = close - 46
  for (let t = -5; t <= 5; t++) {
    put(box + t, cy - 5, 20)
    put(box + t, cy + 5, 20)
    put(box - 5, cy + t, 20)
    put(box + 5, cy + t, 20)
  }
  for (let t = -5; t <= 5; t++) put(close - 92 + t, cy, 20)
  const found = findWindows({ width, height, data })
  assert.equal(found.length, 1, JSON.stringify(found))
  const f = found[0]
  assert.ok(f.kind === 'windows' && Math.abs(f.x - win.x) <= 3 && Math.abs(f.y - win.y) <= 3 && Math.abs(f.width - win.w) <= 4 && Math.abs(f.height - win.h) <= 4, JSON.stringify(f))
})
