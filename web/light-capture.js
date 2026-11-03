// Still pictures for "Bildschirmfreigabe light": the shared screen or window at the moment
// somebody points or starts to draw, and where it lies on the presenter's screen.
// Used by the share page (for the always-on-top mini window) and the helper window.

import { matchesScreen, monitorRect, windowRect } from './light-geometry.js'
import { VERSION, locate, scaledGray } from './light-locate.js'

const mac = /Mac/.test(navigator.platform)

/**
 * The current frame of a stream as a canvas – ImageCapture where there is one (Chrome, also in a
 * background tab), else the first of `videos` showing that stream with a picture.
 */
export async function frameCanvas(stream, videos = []) {
  const track = stream?.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') return null
  let source = null
  try {
    if (typeof ImageCapture === 'function') source = await new ImageCapture(track).grabFrame()
  } catch {}
  source ??= videos.find((v) => v && v.srcObject === stream && v.videoWidth > 0) ?? null
  if (!source) return null
  const width = source.videoWidth || source.width
  const height = source.videoHeight || source.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(source, 0, 0, width, height)
  source.close?.()
  return canvas
}

/**
 * A still picture and its place on the screen: {image, picture, monitor, screenImage, found, debug}.
 *   debug.problem: 'other-screen' (another screen than this browser's) or 'not-found' (the window
 *   is not to be seen on the screen) – the page says so
 *   picture: where the shared picture lies (screen coordinates, CSS px) – null when unknown
 *   screenImage: the whole screen at that moment (only for a found window, as backdrop)
 * @param {{stream: MediaStream, locator?: MediaStream|null, surface: string, videos?: HTMLVideoElement[], screen?: Screen}} source
 */
export async function takeCapture({ stream, locator = null, surface, videos = [], screen: scr = screen }) {
  const t0 = performance.now()
  const monitor = monitorRect(scr, { mac, details: await screenDetails() })
  const image = await frameCanvas(stream, videos)
  const capture = { image, picture: null, monitor, screenImage: null, found: null }
  // what happened – for share.html?debug and the console
  const debug = (capture.debug = { version: VERSION, surface, picture: image ? `${image.width}x${image.height}` : 'kein Bild', screen: `${monitor.width}x${monitor.height}@${monitor.left},${monitor.top}` })
  if (!image) return capture
  if (surface === 'monitor') {
    if (matchesScreen(image, monitor)) return { ...capture, picture: monitor }
    debug.problem = 'other-screen'
    debug.why = 'anderer Bildschirm (Seitenverhältnis)'
    return capture
  }
  // a window or tab: find it on the whole screen (when the presenter picked that, too)
  if (!locator) {
    debug.why = 'kein Bildschirm zum Suchen ausgewählt'
    return capture
  }
  const screenImage = await frameCanvas(locator, videos)
  debug.search = screenImage ? `${screenImage.width}x${screenImage.height}` : 'kein Bild'
  if (!screenImage) return capture
  if (!matchesScreen(screenImage, monitor)) {
    debug.problem = 'other-screen'
    debug.why = 'der gewählte Bildschirm ist nicht der, auf dem das Hilfsfenster ist'
    return capture
  }
  const scratch = document.createElement('canvas')
  // black bars around the window (Chrome letterboxes a window whose shape changed) are not on
  // the screen: searched for without them
  const bars = blackBars(image, scratch)
  const content = bars ? crop(image, bars) : image
  if (bars) debug.bars = bars
  const info = (debug.search_result = {})
  // likely sizes: both pictures with the same density (1) – or the screen's picture reduced by
  // the browser while the window's has the full device pixels
  const screenScale = screenImage.width / monitor.width
  const hints = [1, screenScale / (window.devicePixelRatio || 1)]
  const found = locate((w, h) => scaledGray(screenImage, w, h, scratch), (w, h) => scaledGray(content, w, h, scratch), screenImage, content, info, { hints })
  debug.ms = Math.round(performance.now() - t0)
  // (the pictures, for the diagnosis)
  capture.searched = { screen: screenImage, window: content, best: info.best ?? null }
  if (!found) {
    debug.problem = 'not-found'
    debug.why = 'Fenster auf dem Bildschirm nicht gefunden'
    return capture
  }
  debug.found = { x: +found.x.toFixed(4), y: +found.y.toFixed(4), w: +found.w.toFixed(4), h: +found.h.toFixed(4), score: +found.score.toFixed(3), k: +found.k.toFixed(3) }
  // the whole picture (bars included) around the found window
  const inner = windowRect(found, monitor)
  const sx = inner.width / content.width
  const sy = inner.height / content.height
  const picture = bars ? { left: inner.left - bars.left * sx, top: inner.top - bars.top * sy, width: image.width * sx, height: image.height * sy } : inner
  return { ...capture, picture, screenImage, found }
}

/**
 * Black (or transparent) bars at the edges of a picture: {left, top, right, bottom} in its pixels,
 * null when there are none.
 */
export function blackBars(image, scratch = document.createElement('canvas')) {
  const w = Math.min(320, image.width)
  const h = Math.max(1, Math.round((image.height * w) / image.width))
  const g = scaledGray(image, w, h, scratch)
  const dark = (x, y) => g.px[y * w + x] < 10
  const row = (y) => Array.from({ length: w }, (_, x) => x).every((x) => dark(x, y))
  const col = (x) => Array.from({ length: h }, (_, y) => y).every((y) => dark(x, y))
  let top = 0
  while (top < h * 0.45 && row(top)) top++
  let bottom = 0
  while (bottom < h * 0.45 && row(h - 1 - bottom)) bottom++
  let left = 0
  while (left < w * 0.45 && col(left)) left++
  let right = 0
  while (right < w * 0.45 && col(w - 1 - right)) right++
  // a dark line or two is a window's edge, not a bar
  const bar = (n) => (n >= 2 ? n : 0)
  ;[top, bottom, left, right] = [top, bottom, left, right].map(bar)
  if (!top && !bottom && !left && !right) return null
  const f = image.width / w
  return { left: Math.round(left * f), top: Math.round(top * f), right: Math.round(right * f), bottom: Math.round(bottom * f) }
}

function crop(image, bars) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.width - bars.left - bars.right)
  canvas.height = Math.max(1, image.height - bars.top - bars.bottom)
  canvas.getContext('2d').drawImage(image, bars.left, bars.top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

// a screen of several: where it is exactly – only when the presenter allowed it already
// (Chrome's "window management"; we never ask for it)
let detailsAllowed
async function screenDetails() {
  try {
    if (!('getScreenDetails' in window)) return null
    detailsAllowed ??= (await navigator.permissions.query({ name: 'window-management' })).state === 'granted'
    if (!detailsAllowed) return null
    return (await window.getScreenDetails()).currentScreen
  } catch {
    return null
  }
}
