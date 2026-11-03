// Still pictures for "Bildschirmfreigabe light": the shared screen or window at the moment
// somebody points or starts to draw, and where it lies on the presenter's screen.
// Used by the share page (for the always-on-top mini window) and the helper window.

import { matchesScreen, monitorRect, windowRect } from './light-geometry.js'
import { locate, scaledGray } from './light-locate.js'

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
  const debug = (capture.debug = { surface, picture: image ? `${image.width}x${image.height}` : 'kein Bild', screen: `${monitor.width}x${monitor.height}@${monitor.left},${monitor.top}` })
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
  const info = (debug.search_result = {})
  const found = locate((w, h) => scaledGray(screenImage, w, h, scratch), (w, h) => scaledGray(image, w, h, scratch), screenImage, image, info)
  debug.ms = Math.round(performance.now() - t0)
  if (!found) {
    debug.problem = 'not-found'
    debug.why = 'Fenster auf dem Bildschirm nicht gefunden'
    return capture
  }
  debug.found = { x: +found.x.toFixed(4), y: +found.y.toFixed(4), w: +found.w.toFixed(4), h: +found.h.toFixed(4), score: +found.score.toFixed(3), k: +found.k.toFixed(3) }
  return { ...capture, picture: windowRect(found, monitor), screenImage, found }
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
