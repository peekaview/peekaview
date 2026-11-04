// The always-on-top mini window of "Bildschirmfreigabe light" (see light-mini.js for what it
// shows). Two kinds, by what the browser offers:
//   - "document": Chrome and Edge open a Picture-in-Picture window with a page of our own –
//     the mini view plus buttons ("Zur Stelle", let viewers in, copy the link, stop). Opening it
//     needs a click.
//   - "video": Safari (and Chrome without the above) put a video into Picture-in-Picture on a
//     click; Firefox only on the user's own command (right click on the video → Bild-im-Bild).
//     The video is the mini view's canvas, captured. No buttons there: a system notification
//     takes the click to the spot instead.

import { icon } from './icons.js'
import { MiniView } from './light-mini.js'

export const documentPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window
// the mini window small and large ("Größer" / "Kleiner" – resizing needs a click there)
const SMALL = { width: 420, height: 320 }
const LARGE = { width: 840, height: 600 }

export const videoPip = typeof document !== 'undefined' && document.pictureInPictureEnabled === true && 'requestPictureInPicture' in HTMLVideoElement.prototype

const CSS = `
html, body { margin: 0; height: 100%; background: #18181b; color: #fafafa; overflow: hidden; }
body { display: flex; flex-direction: column; font: 600 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; user-select: none; }
[hidden] { display: none !important; }
canvas { display: block; width: 100%; min-height: 0; flex: 1; object-fit: contain; background: #18181b; }
.bar { flex: none; display: flex; align-items: center; gap: 6px; padding: 8px; }
.bar .spacer { flex: 1; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: #3f3f46; color: #fafafa; font: inherit; cursor: pointer; white-space: nowrap; }
button:hover { background: #52525b; }
button.primary { background: #ef4444; }
button.primary:hover { background: #dc2626; }
button.icon { width: 34px; padding: 0; }
.requests { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 0 8px 8px; }
.request { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px; border-radius: 10px; background: rgba(239,68,68,.14); }
.request span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

export class MiniWindow {
  /**
   * The Picture-in-Picture document window (Chrome, Edge) – call right in a click.
   * @param {{onJump, onAdmit, onCopy, onStop, onClose}} actions
   */
  static async openDocument(actions) {
    const win = await window.documentPictureInPicture.requestWindow(SMALL)
    return new MiniWindow('document', { win, actions })
  }

  /** The Picture-in-Picture video (Safari, Firefox): `video` shows the mini view's stream. */
  static video(video, actions) {
    return new MiniWindow('video', { video, actions })
  }

  constructor(kind, { win = null, video = null, actions = {} }) {
    this.kind = kind
    this.win = win
    this.video = video
    this.actions = actions
    this.closed = false
    if (kind === 'document') {
      const doc = win.document
      doc.title = 'PeekaView'
      const style = doc.createElement('style')
      style.textContent = CSS
      doc.head.append(style)
      doc.body.innerHTML = `<canvas></canvas><div class="bar"><button class="primary" data-jump hidden>${icon('point', 15)}Zur Stelle</button><span class="spacer"></span><button class="icon" data-size title="Größer" aria-label="Größer">${icon('maximize', 15)}</button><button class="icon" data-copy title="Link kopieren" aria-label="Link kopieren">${icon('copy', 15)}</button><button class="icon" data-stop title="Freigabe beenden" aria-label="Freigabe beenden">${icon('stop', 15)}</button></div><div class="requests"></div>`
      this.view = new MiniView(doc.querySelector('canvas'))
      doc.querySelector('[data-jump]').addEventListener('click', () => actions.onJump?.(win))
      doc.querySelector('[data-size]').addEventListener('click', () => this.toggleSize())
      doc.querySelector('[data-copy]').addEventListener('click', () => actions.onCopy?.(win))
      doc.querySelector('[data-stop]').addEventListener('click', () => actions.onStop?.())
      win.addEventListener('pagehide', () => this.gone())
    } else {
      const canvas = document.createElement('canvas')
      // the requests are shown on the picture: a video has no buttons
      this.view = new MiniView(canvas, { requestsOnCanvas: true })
      video.muted = true
      video.srcObject = canvas.captureStream(15)
      video.play().catch(() => {})
      video.addEventListener('enterpictureinpicture', () => actions.onEnter?.())
      video.addEventListener('leavepictureinpicture', () => actions.onLeave?.())
    }
  }

  /** Larger or smaller again (in a click in the window; on its screen at most 90 %). */
  toggleSize() {
    const win = this.win
    this.large = !this.large
    const size = this.large ? LARGE : SMALL
    const width = Math.min(size.width, Math.round(win.screen.availWidth * 0.9))
    const height = Math.min(size.height, Math.round(win.screen.availHeight * 0.9))
    try {
      win.resizeTo(width + win.outerWidth - win.innerWidth, height + win.outerHeight - win.innerHeight)
    } catch {}
    const button = win.document.querySelector('[data-size]')
    button.innerHTML = icon(this.large ? 'restore' : 'maximize', 15)
    button.title = this.large ? 'Kleiner' : 'Größer'
    button.setAttribute('aria-label', button.title)
  }

  get inPip() {
    return this.kind === 'document' ? !this.closed : document.pictureInPictureElement === this.video
  }

  /** Safari, Chrome: the video into Picture-in-Picture (in a click). */
  enter() {
    return this.video?.requestPictureInPicture?.()
  }

  set(state) {
    this.view.set(state)
    if (this.kind !== 'document' || this.closed) return
    const doc = this.win.document
    doc.querySelector('.requests').replaceChildren(...(state.requests ?? []).map((r) => {
      const row = doc.createElement('div')
      row.className = 'request'
      row.innerHTML = '<span></span><button data-deny>Ablehnen</button><button class="primary" data-allow>Zulassen</button>'
      row.querySelector('span').textContent = `${r.name} möchte zusehen`
      row.querySelector('[data-allow]').addEventListener('click', () => this.actions.onAdmit?.(r.peer, true))
      row.querySelector('[data-deny]').addEventListener('click', () => this.actions.onAdmit?.(r.peer, false))
      return row
    }))
  }

  /** A spot to show: see MiniView.reveal. "Zur Stelle" stays: it always shows the last one. */
  reveal(spot) {
    this.view.reveal(spot)
    if (this.kind !== 'document' || this.closed) return
    this.win.document.querySelector('[data-jump]').hidden = false
  }

  gone() {
    if (this.closed) return
    this.closed = true
    this.view.destroy()
    this.actions.onClose?.()
  }

  close() {
    if (this.kind === 'document') {
      try {
        this.win.close()
      } catch {}
    } else if (document.pictureInPictureElement === this.video) {
      document.exitPictureInPicture().catch(() => {})
    }
    this.gone()
  }
}
