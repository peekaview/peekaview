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
 * A still picture and its place on the screen: {image, picture, monitor, screenImage, found}.
 *   picture: where the shared picture lies (screen coordinates, CSS px) – null when unknown
 *   screenImage: the whole screen at that moment (only for a found window, as backdrop)
 * @param {{stream: MediaStream, locator?: MediaStream|null, surface: string, videos?: HTMLVideoElement[], screen?: Screen}} source
 */
export async function takeCapture({ stream, locator = null, surface, videos = [], screen: scr = screen }) {
  const monitor = monitorRect(scr, { mac, details: await screenDetails() })
  const image = await frameCanvas(stream, videos)
  const capture = { image, picture: null, monitor, screenImage: null, found: null }
  if (!image) return capture
  if (surface === 'monitor') {
    if (matchesScreen(image, monitor)) capture.picture = monitor
    return capture
  }
  // a window or tab: find it on the whole screen (when the presenter picked that, too)
  const size = locator?.getVideoTracks()[0]?.getSettings?.() ?? {}
  if (!locator || !matchesScreen(size, monitor)) return capture
  const screenImage = await frameCanvas(locator, videos)
  if (!screenImage) return capture
  const scratch = document.createElement('canvas')
  const found = locate((w, h) => scaledGray(screenImage, w, h, scratch), (w, h) => scaledGray(image, w, h, scratch), screenImage, image)
  if (!found) return capture
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
