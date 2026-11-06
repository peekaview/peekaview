// "Bildschirmfreigabe light": the whole screen is captured, viewers get only the window the
// presenter picked – cut out of each frame right here, before it is encoded.
//
// Chrome and Edge (MediaStreamTrackProcessor / MediaStreamTrackGenerator): each frame is
// re-wrapped with a smaller visible rectangle, no copying, no drawing. It runs on the frames
// themselves, so it keeps going while the share page is a background tab (where timers and
// requestAnimationFrame slow down or stop).
// Firefox, Safari (CanvasCropper): the screen plays in a video, the part is drawn into a canvas,
// and the canvas is what goes out (captureStream) – paced by a worker's clock, which background
// tabs do not slow down.

const trackCut =
  typeof window !== 'undefined' && typeof window.MediaStreamTrackProcessor === 'function' && typeof window.MediaStreamTrackGenerator === 'function' && typeof window.VideoFrame === 'function'
const canvasCut = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
export const cropSupported = trackCut || canvasCut

/** The cutter this browser can do. */
export function makeCropper(source) {
  return trackCut ? new Cropper(source) : new CanvasCropper(source)
}

const even = (v) => Math.max(0, Math.floor(v / 2) * 2)

export class Cropper {
  /** @param {MediaStreamTrack} source the whole screen */
  constructor(source) {
    this.source = source
    this.rect = null // {x, y, width, height} in the source's pixels; null: the whole picture
    this.blank = null // a note on black instead of the part (setBlank)
    this.check = null // (frame, rect) => Promise<boolean>: is the part still what it was?
    this.onMiss = null // called when it is not (or while it is black)
    this.paused = false // no new pictures for now
    this.counts = { checked: 0, held: 0, paused: 0 } // (for share.html?debug and tests)
    this.size = { width: source.getSettings?.().width ?? 0, height: source.getSettings?.().height ?? 0 }
    this.full = { ...this.size }
    this.generator = new window.MediaStreamTrackGenerator({ kind: 'video' })
    const processor = new window.MediaStreamTrackProcessor({ track: source })
    const cut = new TransformStream({
      transform: async (frame, controller) => {
        const base = frame.visibleRect ?? { x: 0, y: 0, width: frame.displayWidth, height: frame.displayHeight }
        this.full = { width: base.width, height: base.height }
        // (the whole screen, as it is now – for still pictures and following the window: no
        // ImageCapture, which may fail, and no video, which a window in the background may not paint)
        this.latest?.close()
        try {
          this.latest = frame.clone()
        } catch {
          this.latest = null
        }
        const r = this.rect
        // paused (the helper shows a drawing over the window: viewers would see it twice): no new
        // pictures – viewers keep the last one
        if (this.paused) {
          this.counts.paused++
          frame.close()
          return
        }
        // the window is not to be seen: black, with a word why (nothing of what lies there now)
        if (r && this.blank) {
          this.onMiss?.()
          const out = this.blankFrame(frame.timestamp)
          frame.close()
          if (out) controller.enqueue(out)
          return
        }
        // still there? (checked on every picture, not on a timer: those are slowed down while this
        // page is in the background) Not: the picture is left out – viewers keep the last one –
        // and the window looked for at once
        if (r && this.check) {
          let ok = true
          try {
            ok = await this.check({ width: frame.displayWidth, height: frame.displayHeight, luma: (area) => lumaOfFrame(frame, area) }, r)
          } catch {}
          this.counts.checked++
          if (!ok) {
            this.counts.held++
            frame.close()
            this.onMiss?.()
            return
          }
        }
        if (!r) {
          this.size = { ...this.full }
          return controller.enqueue(frame)
        }
        // (even numbers: video formats keep colour for pairs of pixels)
        const x = even(Math.min(r.x, base.width - 16))
        const y = even(Math.min(r.y, base.height - 16))
        const width = even(Math.min(r.width, base.width - x))
        const height = even(Math.min(r.height, base.height - y))
        try {
          const out = new window.VideoFrame(frame, { visibleRect: { x: base.x + x, y: base.y + y, width, height } })
          frame.close()
          this.size = { width, height }
          // (the last right picture, for the blurred one while the window is not to be seen)
          this.last?.close()
          this.last = out.clone()
          controller.enqueue(out)
        } catch {
          controller.enqueue(frame)
        }
      },
    })
    this.done = processor.readable.pipeThrough(cut).pipeTo(this.generator.writable).catch(() => {})
    this.stream = new MediaStream([this.generator])
  }

  /**
   * Viewers see the last right picture blurred, with this note over it, instead of the part (the
   * window moved away or got covered; lines split by "\n"); null: the part again.
   */
  setBlank(note) {
    this.blank = note || null
    if (!this.blank) this.canvasNote = null
  }

  blankFrame(timestamp) {
    const { width, height } = this.size
    if (!width || !height) return null
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height || this.canvasNote !== this.blank) {
      this.canvas ??= new OffscreenCanvas(width, height)
      this.canvas.width = width
      this.canvas.height = height
      this.canvasNote = this.blank
      drawUnavailable(this.canvas.getContext('2d'), width, height, this.last, this.blank)
    }
    try {
      return new window.VideoFrame(this.canvas, { timestamp })
    } catch {
      return null
    }
  }

  /** What goes out now (drawable – for the live preview): the last picture, or the note on black. */
  picture() {
    return this.blank && this.canvas ? this.canvas : this.last
  }

  /** The whole screen as it is now, on a canvas – null before the first picture. */
  snapshot() {
    const f = this.latest
    if (!f) return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = f.displayWidth
      canvas.height = f.displayHeight
      canvas.getContext('2d').drawImage(f, 0, 0)
      return canvas
    } catch {
      return null
    }
  }

  /** The part to share (source pixels), or null for the whole screen. */
  setRect(rect) {
    this.rect = rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null
    // (until the next frame shows it)
    this.size = this.rect ? { width: even(this.rect.width), height: even(this.rect.height) } : { ...this.full }
  }

  stop() {
    this.last?.close()
    this.last = null
    this.latest?.close()
    this.latest = null
    this.source.stop()
    this.generator.stop()
  }
}

/**
 * Firefox, Safari: the part drawn into a canvas, which goes out. Same as Cropper otherwise (the
 * window checked on each picture, paused, unavailable).
 */
export class CanvasCropper {
  /** @param {MediaStreamTrack} source the whole screen */
  constructor(source) {
    this.source = source
    this.rect = null
    this.blank = null
    this.check = null
    this.onMiss = null
    this.paused = false
    this.counts = { checked: 0, held: 0, paused: 0 }
    this.size = { width: source.getSettings?.().width ?? 0, height: source.getSettings?.().height ?? 0 }
    this.full = { ...this.size }
    // (in the page, out of sight: a video that is not shown may not be decoded)
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: new MediaStream([source]) })
    this.video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
    document.body.append(this.video)
    this.video.play().catch(() => {})
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.max(2, this.size.width)
    this.canvas.height = Math.max(2, this.size.height)
    this.ctx = this.canvas.getContext('2d')
    this.scratch = document.createElement('canvas')
    this.stream = this.canvas.captureStream(30)
    this.shown = null // what the canvas shows: 'part' | the note
    this.ticks = 0
    try {
      this.ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })))
      this.ticker.onmessage = () => this.tick()
    } catch {
      const id = setInterval(() => this.tick(), 33)
      this.ticker = { terminate: () => clearInterval(id) }
    }
  }

  async tick() {
    const v = this.video
    if (this.busy || v.readyState < 2 || !v.videoWidth) return
    this.busy = true
    try {
      this.full = { width: v.videoWidth, height: v.videoHeight }
      const r = this.rect
      if (this.paused) {
        this.counts.paused++
        return
      }
      if (r && this.blank) {
        this.onMiss?.()
        if (this.shown !== this.blank) {
          // (the last right picture, from the canvas itself, blurred under the note)
          const last = document.createElement('canvas')
          last.width = this.canvas.width
          last.height = this.canvas.height
          last.getContext('2d').drawImage(this.canvas, 0, 0)
          drawUnavailable(this.ctx, this.canvas.width, this.canvas.height, this.shown === 'part' ? last : null, this.blank)
          this.shown = this.blank
        }
        return
      }
      // (checked on every third picture: drawing and reading the strips costs here; in between the
      // last answer holds)
      if (r && this.check) {
        let ok = this.lastOk ?? true
        if (this.ticks++ % 3 === 0) {
          try {
            ok = await this.check({ width: v.videoWidth, height: v.videoHeight, luma: (area) => lumaOfImage(v, area, this.scratch) }, r)
          } catch {}
          this.lastOk = ok
          this.counts.checked++
        }
        if (!ok) {
          this.counts.held++
          this.onMiss?.()
          return
        }
      }
      const x = r ? even(Math.min(r.x, v.videoWidth - 16)) : 0
      const y = r ? even(Math.min(r.y, v.videoHeight - 16)) : 0
      const width = r ? even(Math.min(r.width, v.videoWidth - x)) : v.videoWidth
      const height = r ? even(Math.min(r.height, v.videoHeight - y)) : v.videoHeight
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width
        this.canvas.height = height
      }
      this.ctx.drawImage(v, x, y, width, height, 0, 0, width, height)
      this.size = { width, height }
      this.shown = 'part'
    } finally {
      this.busy = false
    }
  }

  setBlank(note) {
    this.blank = note || null
  }

  /** What goes out now (drawable – for the live preview). */
  picture() {
    return this.shown ? this.canvas : null
  }

  /** The whole screen as it is now, on a canvas – null before the first picture. */
  snapshot() {
    const v = this.video
    if (v.readyState < 2 || !v.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0)
    return canvas
  }

  setRect(rect) {
    this.rect = rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null
    this.size = this.rect ? { width: even(this.rect.width), height: even(this.rect.height) } : { ...this.full }
  }

  stop() {
    this.ticker?.terminate()
    this.video.remove()
    this.source.stop()
    for (const t of this.stream.getTracks()) t.stop()
  }
}

/** The last right picture blurred and darkened, with the note in a box over it (lines by "\n"). */
function drawUnavailable(ctx, width, height, last, note) {
  ctx.fillStyle = '#18181b'
  ctx.fillRect(0, 0, width, height)
  if (last) {
    try {
      ctx.filter = `blur(${Math.max(16, Math.round(width / 40))}px)`
      ctx.drawImage(last, -20, -20, width + 40, height + 40)
    } catch {}
    ctx.filter = 'none'
  }
  ctx.fillStyle = 'rgba(9, 9, 11, .55)'
  ctx.fillRect(0, 0, width, height)
  // the note in a box, as large as fits (also when viewers see the picture small)
  const [head, ...rest] = note.split('\n')
  let size = Math.round(Math.min(height * 0.07, width * 0.05))
  const widest = () => Math.max(ctx.measureText(head).width, ...rest.map((l) => ctx.measureText(l).width * 0.75))
  ctx.font = `700 ${size}px system-ui, sans-serif`
  while (size > 10 && widest() > width * 0.8) ctx.font = `700 ${(size -= 2)}px system-ui, sans-serif`
  const lineHeight = size * 1.4
  const boxW = widest() + size * 2
  const boxH = lineHeight * (1 + rest.length * 0.8) + size * 1.2
  ctx.fillStyle = 'rgba(24, 24, 27, .88)'
  ctx.beginPath()
  ctx.roundRect?.((width - boxW) / 2, (height - boxH) / 2, boxW, boxH, size * 0.6)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fafafa'
  let y = (height - boxH) / 2 + size * 0.6 + lineHeight / 2
  ctx.fillText(head, width / 2, y)
  ctx.font = `500 ${Math.round(size * 0.75)}px system-ui, sans-serif`
  ctx.fillStyle = '#d4d4d8'
  for (const line of rest) {
    y += lineHeight * 0.8
    ctx.fillText(line, width / 2, y)
  }
}

/** The brightness of a part of a video frame (on even pixels: video formats keep colour for pairs). */
async function lumaOfFrame(frame, area) {
  const base = frame.visibleRect ?? { x: 0, y: 0 }
  const x = Math.max(0, Math.floor(area.x / 2) * 2)
  const y = Math.max(0, Math.floor(area.y / 2) * 2)
  const width = Math.min(frame.displayWidth - x, Math.ceil((area.width + area.x - x) / 2) * 2)
  const height = Math.min(frame.displayHeight - y, Math.ceil((area.height + area.y - y) / 2) * 2)
  if (width < 2 || height < 2) return null
  const rect = { x: base.x + x, y: base.y + y, width, height }
  const buffer = new Uint8Array(frame.allocationSize({ rect }))
  const [plane] = await frame.copyTo(buffer, { rect })
  const px = new Float32Array(width * height)
  const rgb = /^(RGB|BGR)/.test(frame.format)
  const red = frame.format?.startsWith('RGB') ? 0 : 2
  for (let row = 0; row < height; row++) {
    const i = plane.offset + row * plane.stride
    for (let col = 0; col < width; col++) {
      // the first plane of NV12 / I420, else from red, green, blue
      px[row * width + col] = rgb ? 0.299 * buffer[i + col * 4 + red] + 0.587 * buffer[i + col * 4 + 1] + 0.114 * buffer[i + col * 4 + 2 - red] : buffer[i + col]
    }
  }
  return { x, y, width, height, px }
}

/** The brightness of a part of a picture (video, canvas), 1:1. */
function lumaOfImage(image, area, canvas) {
  const x = Math.max(0, Math.round(area.x))
  const y = Math.max(0, Math.round(area.y))
  const width = Math.min((image.videoWidth || image.width) - x, Math.round(area.width))
  const height = Math.min((image.videoHeight || image.height) - y, Math.round(area.height))
  if (width < 2 || height < 2) return null
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  const px = new Float32Array(width * height)
  for (let i = 0; i < px.length; i++) px[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  return { x, y, width, height, px }
}
