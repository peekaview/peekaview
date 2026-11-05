// "Bildschirmfreigabe light": the whole screen is captured, viewers get only the window the
// presenter picked – cut out of each frame right here, before it is encoded.
//
// Chrome and Edge only (MediaStreamTrackProcessor / MediaStreamTrackGenerator): each frame is
// re-wrapped with a smaller visible rectangle, no copying, no drawing. It runs on the frames
// themselves, so it keeps going while the share page is a background tab (where timers and
// requestAnimationFrame slow down or stop).

export const cropSupported =
  typeof window !== 'undefined' && typeof window.MediaStreamTrackProcessor === 'function' && typeof window.MediaStreamTrackGenerator === 'function' && typeof window.VideoFrame === 'function'

const even = (v) => Math.max(0, Math.floor(v / 2) * 2)

export class Cropper {
  /** @param {MediaStreamTrack} source the whole screen */
  constructor(source) {
    this.source = source
    this.rect = null // {x, y, width, height} in the source's pixels; null: the whole picture
    this.blank = null // a note on black instead of the part (setBlank)
    this.size = { width: source.getSettings?.().width ?? 0, height: source.getSettings?.().height ?? 0 }
    this.full = { ...this.size }
    this.generator = new window.MediaStreamTrackGenerator({ kind: 'video' })
    const processor = new window.MediaStreamTrackProcessor({ track: source })
    const cut = new TransformStream({
      transform: (frame, controller) => {
        const base = frame.visibleRect ?? { x: 0, y: 0, width: frame.displayWidth, height: frame.displayHeight }
        this.full = { width: base.width, height: base.height }
        const r = this.rect
        // the window is not to be seen: black, with a word why (nothing of what lies there now)
        if (r && this.blank) {
          const out = this.blankFrame(frame.timestamp)
          frame.close()
          if (out) controller.enqueue(out)
          return
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
   * Viewers see black with this note instead of the part (the window moved away or got covered);
   * null: the part again.
   */
  setBlank(note) {
    this.blank = note || null
  }

  blankFrame(timestamp) {
    const { width, height } = this.size
    if (!width || !height) return null
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height || this.canvasNote !== this.blank) {
      this.canvas ??= new OffscreenCanvas(width, height)
      this.canvas.width = width
      this.canvas.height = height
      this.canvasNote = this.blank
      const ctx = this.canvas.getContext('2d')
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      // the note, as large as fits (also when viewers see the picture small)
      let size = Math.round(Math.min(height * 0.07, width * 0.05))
      ctx.font = `600 ${size}px system-ui, sans-serif`
      while (size > 10 && ctx.measureText(this.blank).width > width * 0.86) ctx.font = `600 ${(size -= 2)}px system-ui, sans-serif`
      ctx.fillStyle = '#e5e7eb'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.blank, width / 2, height / 2)
    }
    try {
      return new window.VideoFrame(this.canvas, { timestamp })
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
    this.source.stop()
    this.generator.stop()
  }
}
