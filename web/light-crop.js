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
            ok = await this.check(frame, r)
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
      const ctx = this.canvas.getContext('2d')
      ctx.fillStyle = '#18181b'
      ctx.fillRect(0, 0, width, height)
      // the last right picture, blurred (nothing of what lies there now), and darkened
      if (this.last) {
        try {
          ctx.filter = `blur(${Math.max(16, Math.round(width / 40))}px)`
          ctx.drawImage(this.last, -20, -20, width + 40, height + 40)
        } catch {}
        ctx.filter = 'none'
      }
      ctx.fillStyle = 'rgba(9, 9, 11, .55)'
      ctx.fillRect(0, 0, width, height)
      // the note in a box, as large as fits (also when viewers see the picture small)
      const [head, ...rest] = this.blank.split('\n')
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
    this.last?.close()
    this.last = null
    this.source.stop()
    this.generator.stop()
  }
}
