// Shared clipboard – a small floating panel where everybody in the session drops files or pastes
// text and images; everybody else can copy them back to their clipboard or save them.
// Used by the web viewer (inside the viewer, files travel over the "pvfile" data channel) and by
// the presenter's desktop client (a window of its own, files stay on the presenter's disk).
// The panel itself does not know how items travel: the embedding code passes `actions`.

import { icon } from './icons.js'
import { injectStyle } from './annotate.js'

export const MAX_SIZE = 100 * 1024 * 1024
const CHUNK = 16 * 1024 // every browser's data channel takes this
const HIGH_WATER = 4 << 20
const PREVIEW_MAX = 46 * 1024

const STYLE = `
.pv-clip {
  --c-bg: #09090b; --c-raised: #27272a; --c-fg: #fafafa; --c-muted: #a1a1aa; --c-line: rgba(255, 255, 255, .09); --c-accent: #ef4444;
  position: absolute; z-index: 5; display: flex; flex-direction: column; width: 340px; max-width: calc(100% - 24px); height: 440px; max-height: calc(100% - 24px);
  border-radius: 16px; background: rgba(24, 24, 27, .92); border: 1px solid var(--c-line); color: var(--c-fg);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
  font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none; outline: none;
  animation: pv-clip-in .18s ease-out;
}
.pv-clip.fill { position: relative; width: 100%; height: 100%; max-width: none; max-height: none; animation: none; }
@keyframes pv-clip-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }
.pv-clip-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 6px; }
.pv-clip-head strong { flex: 1; font-weight: 650; }
.pv-clip-head strong small { margin-left: 6px; color: var(--c-muted); font-weight: 500; }
.pv-clip button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--c-muted); cursor: pointer; transition: background .15s, color .15s; }
.pv-clip button:hover { background: var(--c-raised); color: var(--c-fg); }
.pv-clip .pv-clip-grip { width: 18px; cursor: grab; touch-action: none; }
.pv-clip .pv-clip-grip:hover { background: transparent; }
.pv-clip-list { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 8px; padding: 2px 10px 10px; }
.pv-clip-empty { position: absolute; inset: 48px 16px 16px; display: grid; place-items: center; align-content: center; gap: 10px; border: 1.5px dashed rgba(255, 255, 255, .16); border-radius: 12px; color: var(--c-muted); text-align: center; padding: 16px; pointer-events: none; }
.pv-clip-empty svg { color: var(--c-raised); }
.pv-clip-drop { position: absolute; inset: 6px; display: grid; place-items: center; align-content: center; gap: 8px; border: 2px dashed var(--c-accent); border-radius: 12px; background: rgba(239, 68, 68, .1); color: #fca5a5; font-weight: 650; pointer-events: none; }
.pv-tile { position: relative; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 6px; border-radius: 12px; background: rgba(255, 255, 255, .03); animation: pv-tile-in .22s ease-out; }
@keyframes pv-tile-in { from { opacity: 0; transform: scale(.94); } }
.pv-tile-thumb { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 8px; background: var(--c-bg) center / cover no-repeat; outline: 1px solid var(--c-line); }
.pv-tile-thumb.contain { background-size: contain; }
.pv-tile-text { position: absolute; inset: 0; padding: 7px 8px; overflow: hidden; color: #d4d4d8; font: 10.5px/1.35 ui-monospace, "SF Mono", Menlo, monospace; white-space: pre-wrap; word-break: break-word; -webkit-mask-image: linear-gradient(#000 65%, transparent); mask-image: linear-gradient(#000 65%, transparent); }
.pv-tile-file { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 2px; color: var(--c-muted); }
.pv-tile-file b { padding: 1px 6px; border-radius: 4px; background: var(--c-raised); color: var(--c-fg); font-size: 10px; letter-spacing: .04em; }
.pv-tile-meta { min-width: 0; padding: 0 2px; }
.pv-tile-meta strong, .pv-tile-meta span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-tile-meta strong { font-weight: 600; font-size: 12px; }
.pv-tile-meta span { display: flex; align-items: center; gap: 5px; color: var(--c-muted); font-size: 11px; }
.pv-tile-meta i { flex: none; width: 7px; height: 7px; border-radius: 50%; }
.pv-tile-actions { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 8px; background: rgba(9, 9, 11, .62); opacity: 0; transition: opacity .15s; }
.pv-tile:hover .pv-tile-actions, .pv-tile:focus-within .pv-tile-actions { opacity: 1; }
.pv-tile-actions button { width: 34px; height: 34px; border-radius: 10px; background: rgba(250, 250, 250, .92); color: #09090b; box-shadow: 0 2px 8px rgba(0, 0, 0, .35); transform: translateY(4px); transition: transform .15s, background .15s; }
.pv-tile:hover .pv-tile-actions button { transform: none; }
.pv-tile-actions button:hover { background: #fff; color: #09090b; }
.pv-tile-actions button.danger:hover { background: var(--c-accent); color: #fff; }
.pv-tile-busy { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 8px; background: rgba(9, 9, 11, .55); }
.pv-ring { position: relative; width: 46px; height: 46px; }
.pv-ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.pv-ring circle { fill: none; stroke-width: 3.5; }
.pv-ring .track { stroke: rgba(255, 255, 255, .15); }
.pv-ring .bar { stroke: var(--c-fg); stroke-linecap: round; stroke-dasharray: 113.1; transition: stroke-dashoffset .2s linear; }
.pv-ring span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 10.5px; font-weight: 650; }
.pv-ring .arrow { position: absolute; left: 50%; top: 50%; margin: -9px 0 0 -9px; width: 18px; height: 18px; color: var(--c-fg); opacity: .0; }
.pv-tile-busy[data-dir="up"] .pv-ring .bar { stroke: #fca5a5; }
.pv-tile-busy[data-dir="down"] .pv-ring .bar { stroke: #86efac; }
.pv-tile-busy.done { animation: pv-busy-out .5s ease-in forwards; }
.pv-tile-busy.done .pv-ring { animation: pv-pop .35s ease-out; }
@keyframes pv-busy-out { 60% { opacity: 1; } to { opacity: 0; } }
@keyframes pv-pop { 50% { transform: scale(1.15); } }
.pv-clip-toast { position: absolute; left: 12px; right: 12px; bottom: 12px; padding: 8px 12px; border-radius: 10px; background: #16a34a; color: #fff; font-weight: 600; text-align: center; animation: pv-clip-in .2s ease-out; }
.pv-clip-toast.error { background: #b91c1c; }
.pv-clip-toast.link { cursor: pointer; }
`

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)

export function formatSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`.replace('.', ',')
}

const isText = (mime) => /^text\/|\/json$/.test(mime ?? '')
const isImage = (mime) => /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/.test(mime ?? '')
/** Can this item go onto a browser's clipboard (only text and images can)? */
export const browserCopyable = (item) => (isText(item.mime) && item.size <= 10 * 1024 * 1024) || (isImage(item.mime) && item.mime !== 'image/svg+xml')

function canvasUrl(canvas) {
  for (const q of [0.72, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length <= PREVIEW_MAX) return url
  }
  return null
}

function fitCanvas(w, h, maxW = 320, maxH = 240) {
  const s = Math.min(1, maxW / w, maxH / h)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * s))
  canvas.height = Math.max(1, Math.round(h * s))
  return canvas
}

let pdfjs
/** First page of a PDF as a small JPEG data URL (PDF.js is loaded on first use). */
export async function pdfPreview(data) {
  try {
    pdfjs ??= await import(new URL('./vendor/pdfjs/pdf.min.mjs', import.meta.url).href)
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href
    const task = pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false })
    try {
      const doc = await task.promise
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const canvas = fitCanvas(base.width, base.height, 320, 320)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, canvas, viewport: page.getViewport({ scale: canvas.width / base.width }) }).promise
      return canvasUrl(canvas)
    } finally {
      task.destroy()
    }
  } catch (err) {
    console.warn('peekaview: pdf preview', err)
    return null
  }
}

/** Preview data for a file before it is shared: image / PDF thumbnail, or the start of a text. */
export async function makePreview(file) {
  try {
    if (isImage(file.type) && file.type !== 'image/svg+xml' && file.size < 60 * 1024 * 1024) {
      const bitmap = await createImageBitmap(file)
      const canvas = fitCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close?.()
      return { preview: canvasUrl(canvas) }
    }
    if (file.type === 'application/pdf') return { preview: await pdfPreview(await file.arrayBuffer()) }
    if (isText(file.type)) return { text: (await file.slice(0, 4096).text()).slice(0, 600) }
  } catch {}
  return {}
}

/** Text / image / files from a paste event or `navigator.clipboard.read()` as Files. */
export function filesFromClipboard(data) {
  const files = [...(data?.files ?? [])]
  if (files.length) return files
  const text = data?.getData?.('text/plain')
  return text ? [new File([text], 'Text.txt', { type: 'text/plain' })] : []
}

export async function readSystemClipboard() {
  const out = []
  for (const item of await navigator.clipboard.read()) {
    const image = item.types.find((t) => t.startsWith('image/'))
    if (image) {
      out.push(new File([await item.getType(image)], `Bild.${image.split('/')[1]}`, { type: image }))
    } else if (item.types.includes('text/plain')) {
      out.push(new File([await (await item.getType('text/plain')).text()], 'Text.txt', { type: 'text/plain' }))
    }
  }
  return out
}

/**
 * The viewer's side of the "pvfile" data channel: uploads (put + chunks, one at a time) and
 * downloads (get → data + chunks + end, served in order by the presenter).
 */
export class FileChannel {
  constructor(dc) {
    this.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = 1 << 20
    this.chain = Promise.resolve()
    this.waiting = new Map() // upload id -> {resolve, reject}
    this.downloads = new Map() // req -> {resolve, reject, onProgress, chunks, received, size}
    this.active = null
    this.req = 0
    dc.addEventListener('message', (e) => this.onMessage(e.data))
    dc.addEventListener('close', () => this.fail(new Error('Verbindung getrennt')))
  }

  fail(err) {
    for (const w of this.waiting.values()) w.reject(err)
    for (const d of this.downloads.values()) d.reject(err)
    this.waiting.clear()
    this.downloads.clear()
  }

  onMessage(data) {
    if (typeof data !== 'string') {
      const d = this.active
      if (!d) return
      d.chunks.push(data)
      d.received += data.byteLength
      d.onProgress?.(d.received / (d.size || 1))
      return
    }
    let m
    try {
      m = JSON.parse(data)
    } catch {
      return
    }
    if (m.t === 'stored' || (m.t === 'error' && m.req == null)) {
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      if (m.t === 'stored') w?.resolve(m.id)
      else w?.reject(new Error(m.error))
    } else if (m.t === 'data') {
      this.active = this.downloads.get(m.req) ?? null
      if (this.active) this.active.size = m.size
    } else if (m.t === 'end' || m.t === 'error') {
      const d = this.downloads.get(m.req)
      this.downloads.delete(m.req)
      if (this.active === d) this.active = null
      if (m.t === 'end') d?.resolve(new Blob(d.chunks, { type: d.mime }))
      else d?.reject(new Error(m.error))
    }
  }

  async drain() {
    while (this.dc.bufferedAmount > HIGH_WATER) {
      if (this.dc.readyState !== 'open') throw new Error('Verbindung getrennt')
      await new Promise((r) => {
        this.dc.addEventListener('bufferedamountlow', r, { once: true })
        setTimeout(r, 500)
      })
    }
  }

  /** Uploads a file; resolves with its item id once the presenter has it. */
  upload(file, { id = newId(), hidden = false, onProgress } = {}) {
    if (file.size > MAX_SIZE) return Promise.reject(new Error(`„${file.name}“ ist größer als 100 MB.`))
    const run = async () => {
      const extra = hidden ? {} : await makePreview(file)
      const stored = new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }))
      this.dc.send(JSON.stringify({ t: 'put', id, name: file.name || 'Datei', mime: file.type || '', size: file.size, hidden, ...extra }))
      for (let off = 0; off < file.size; off += 1 << 20) {
        const block = new Uint8Array(await file.slice(off, off + (1 << 20)).arrayBuffer())
        for (let i = 0; i < block.length; i += CHUNK) {
          await this.drain()
          this.dc.send(block.subarray(i, i + CHUNK))
        }
        // what has left the browser (buffered data is still on its way)
        onProgress?.(Math.max(0, Math.min(1, (off + block.length - this.dc.bufferedAmount) / (file.size || 1))))
      }
      onProgress?.(1)
      return stored
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => {})
    return result.then(() => id)
  }

  /** Downloads an item as a Blob. */
  download(item, onProgress) {
    const req = ++this.req
    return new Promise((resolve, reject) => {
      this.downloads.set(req, { resolve, reject, onProgress, chunks: [], received: 0, size: item.size, mime: item.mime })
      this.dc.send(JSON.stringify({ t: 'get', id: item.id, req }))
    })
  }
}

/** Saves a Blob as a download in the browser. */
export function saveBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

/** A Blob as PNG (the only image type every browser clipboard takes). */
export async function asPng(blob) {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  return new Promise((r) => canvas.toBlob(r, 'image/png'))
}

/**
 * Copies to the browser's clipboard. `data` may be a promise (Safari only allows clipboard
 * writes that start right inside the user's click, the content may follow later).
 */
export function writeClipboard(type, data) {
  const blob = Promise.resolve(data).then((d) => (d instanceof Blob ? d : new Blob([d], { type })))
  return navigator.clipboard.write([new ClipboardItem({ [type]: blob })])
}

/**
 * The panel. Options:
 *   peer(id) -> {name, color}, mine(item) -> bool (may delete), fill: true to fill its parent
 *   actions: { add(files), paste(), copy(item, tile), save(item, tile), remove(item) }
 *   onGrip(event): custom dragging (desktop window); default: move inside the parent
 *   nativeDrop: drops are handled outside (desktop) – call showDrop() yourself
 *   storageKey: remembers position
 */
export class ClipPanel {
  constructor(parent, options) {
    injectStyle('pv-clip-style', STYLE)
    this.options = options
    this.items = []
    this.previews = new Map()
    this.busy = new Map() // id -> {dir, fraction}
    this.el = document.createElement('div')
    this.el.className = `pv-clip${options.fill ? ' fill' : ''}`
    this.el.tabIndex = 0
    this.el.innerHTML = `
      <div class="pv-clip-head">
        <button class="pv-clip-grip" title="Verschieben">${icon('grip', 16)}</button>
        <strong>Zwischenablage<small></small></strong>
        <button data-paste title="Aus der eigenen Zwischenablage einfügen (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+'}V)">${icon('paste', 17)}</button>
        <button data-close title="Schließen">${icon('close', 16)}</button>
      </div>
      <div class="pv-clip-list"></div>
      <div class="pv-clip-empty">${icon('clipboard', 34)}<span>Dateien hierher ziehen oder mit ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Strg+V'} einfügen.<br>Alle in der Sitzung können sie kopieren oder speichern. Bis 100 MB pro Datei.</span></div>
      <div class="pv-clip-drop" hidden>${icon('download', 28)}<span>Loslassen zum Teilen</span></div>`
    parent.append(this.el)
    const q = (s) => this.el.querySelector(s)
    this.list = q('.pv-clip-list')
    q('[data-close]').addEventListener('click', () => options.onClose?.())
    q('[data-paste]').addEventListener('click', () => options.actions.paste())
    this.el.addEventListener('paste', (e) => {
      if (!options.actions.addFromPaste) return
      e.preventDefault()
      options.actions.addFromPaste(e.clipboardData)
    })
    this.el.addEventListener('keydown', (e) => {
      const cmd = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey
      // the desktop panel reads the OS clipboard natively
      if (cmd && e.key.toLowerCase() === 'v' && !options.actions.addFromPaste) {
        e.preventDefault()
        options.actions.paste()
      }
      if (e.key === 'Escape') options.onClose?.()
    })
    if (!options.nativeDrop) {
      let depth = 0
      this.el.addEventListener('dragenter', (e) => {
        if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return
        depth++
        this.showDrop(true)
      })
      this.el.addEventListener('dragleave', () => --depth <= 0 && this.showDrop(false))
      this.el.addEventListener('dragover', (e) => e.preventDefault())
      this.el.addEventListener('drop', (e) => {
        e.preventDefault()
        depth = 0
        this.showDrop(false)
        const files = [...(e.dataTransfer?.files ?? [])]
        if (files.length) options.actions.add(files)
      })
    }
    const grip = q('.pv-clip-grip')
    grip.addEventListener('pointerdown', (e) => (options.onGrip ? options.onGrip(e) : this.drag(e)))
    if (!options.fill) {
      this.restore()
      this.observer = new ResizeObserver(() => this.restore())
      this.observer.observe(parent)
    }
    this.render()
  }

  destroy() {
    this.observer?.disconnect()
    this.el.remove()
  }

  focus() {
    this.el.focus({ preventScroll: true })
  }

  // -------------------------------------------------------- position (inside a viewer)

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.options.storageKey ?? 'pv-clip')) ?? {}
    } catch {
      return {}
    }
  }

  restore() {
    const p = this.load()
    const parent = this.el.parentElement.getBoundingClientRect()
    const own = this.el.getBoundingClientRect()
    const x = p.x != null ? p.x * parent.width : parent.width - own.width - 12
    const y = p.y != null ? p.y * parent.height : 56
    this.el.style.left = `${Math.round(Math.max(0, Math.min(parent.width - own.width, x)))}px`
    this.el.style.top = `${Math.round(Math.max(0, Math.min(parent.height - own.height, y)))}px`
  }

  drag(e) {
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const parent = this.el.parentElement.getBoundingClientRect()
    const own = this.el.getBoundingClientRect()
    const dx = e.clientX - own.left
    const dy = e.clientY - own.top
    const move = (ev) => {
      this.el.style.left = `${Math.round(Math.max(0, Math.min(parent.width - own.width, ev.clientX - dx - parent.left)))}px`
      this.el.style.top = `${Math.round(Math.max(0, Math.min(parent.height - own.height, ev.clientY - dy - parent.top)))}px`
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      try {
        localStorage.setItem(this.options.storageKey ?? 'pv-clip', JSON.stringify({ x: parseFloat(this.el.style.left) / parent.width, y: parseFloat(this.el.style.top) / parent.height }))
      } catch {}
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }

  // -------------------------------------------------------- items

  showDrop(on) {
    this.el.querySelector('.pv-clip-drop').hidden = !on
  }

  setItems(items) {
    this.items = items
    for (const it of items) if (it.preview) this.previews.set(it.id, it.preview)
    this.render()
  }

  setPreview(id, preview) {
    this.previews.set(id, preview)
    const thumb = this.list.querySelector(`[data-id="${CSS.escape(id)}"] .pv-tile-thumb`)
    if (thumb) this.paintThumb(thumb, this.items.find((i) => i.id === id))
  }

  /** Transfer progress of an item (0..1); dir 'up' | 'down'; null = done. */
  progress(id, fraction, dir) {
    if (fraction == null) this.busy.delete(id)
    else this.busy.set(id, { fraction, dir })
    const tile = this.list.querySelector(`[data-id="${CSS.escape(id)}"]`)
    if (tile) this.paintBusy(tile, id)
  }

  /** Upload progress the presenter reports for somebody else's item. */
  received(id, received) {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.received = received
    if (!this.busy.has(id) || this.busy.get(id).remote) this.busy.set(id, { fraction: received / (item.size || 1), dir: 'up', remote: true })
    const tile = this.list.querySelector(`[data-id="${CSS.escape(id)}"]`)
    if (tile) this.paintBusy(tile, id)
  }

  toast(text, { error = false, onClick } = {}) {
    this.el.querySelector('.pv-clip-toast')?.remove()
    const t = document.createElement('div')
    t.className = `pv-clip-toast${error ? ' error' : ''}${onClick ? ' link' : ''}`
    t.textContent = text
    if (onClick) t.addEventListener('click', onClick)
    this.el.append(t)
    setTimeout(() => t.remove(), error ? 5000 : 2600)
  }

  render() {
    const visible = this.items
    this.el.querySelector('.pv-clip-empty').hidden = visible.length > 0
    this.el.querySelector('.pv-clip-head small').textContent = visible.length ? String(visible.length) : ''
    const existing = new Map([...this.list.children].map((el) => [el.dataset.id, el]))
    const tiles = [...visible].reverse().map((item) => {
      let tile = existing.get(item.id)
      if (!tile) tile = this.tile(item)
      else this.paintMeta(tile, item)
      if (!item.preview && this.previews.has(item.id)) this.paintThumb(tile.querySelector('.pv-tile-thumb'), item)
      if (item.received < item.size && !this.busy.has(item.id)) this.busy.set(item.id, { fraction: item.received / (item.size || 1), dir: 'up', remote: true })
      if (item.received >= item.size && this.busy.get(item.id)?.remote) this.busy.delete(item.id)
      this.paintBusy(tile, item.id)
      return tile
    })
    this.list.replaceChildren(...tiles)
  }

  tile(item) {
    const tile = document.createElement('div')
    tile.className = 'pv-tile'
    tile.dataset.id = item.id
    tile.innerHTML = `<div class="pv-tile-thumb"></div><div class="pv-tile-meta"><strong></strong><span><i></i><em></em></span></div>`
    const actions = document.createElement('div')
    actions.className = 'pv-tile-actions'
    const button = (name, title, fn, cls = '') => {
      const b = document.createElement('button')
      b.innerHTML = icon(name, 17)
      b.title = title
      if (cls) b.className = cls
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        fn(this.items.find((i) => i.id === item.id) ?? item, tile)
      })
      actions.append(b)
      return b
    }
    const copy = button('copy', 'In die Zwischenablage kopieren', (it, t) => this.options.actions.copy(it, t))
    button('download', 'Als Datei speichern', (it, t) => this.options.actions.save(it, t))
    const del = button('trash', 'Entfernen', (it) => this.options.actions.remove(it), 'danger')
    copy.dataset.role = 'copy'
    del.dataset.role = 'delete'
    tile.querySelector('.pv-tile-thumb').append(actions)
    this.paintThumb(tile.querySelector('.pv-tile-thumb'), item)
    this.paintMeta(tile, item)
    return tile
  }

  paintMeta(tile, item) {
    const peer = this.options.peer?.(item.from) ?? {}
    tile.querySelector('strong').textContent = item.name
    tile.querySelector('strong').title = item.name
    tile.querySelector('em').textContent = `${formatSize(item.size)} · ${peer.name ?? 'Gast'}`
    tile.querySelector('em').style.fontStyle = 'normal'
    tile.querySelector('.pv-tile-meta i').style.background = peer.color ?? '#71717a'
    const copy = tile.querySelector('[data-role="copy"]')
    const copyable = this.options.canCopy?.(item) ?? true
    copy.hidden = !copyable
    tile.querySelector('[data-role="delete"]').hidden = !(this.options.mine?.(item) ?? false)
  }

  paintThumb(thumb, item) {
    if (!item) return
    const preview = item.preview ?? this.previews.get(item.id)
    thumb.querySelector('.pv-tile-text, .pv-tile-file')?.remove()
    thumb.style.backgroundImage = ''
    thumb.classList.toggle('contain', item.mime === 'application/pdf')
    if (preview) {
      thumb.style.backgroundImage = `url("${preview}")`
    } else if (item.text != null) {
      const t = document.createElement('div')
      t.className = 'pv-tile-text'
      t.textContent = item.text
      thumb.prepend(t)
    } else {
      const f = document.createElement('div')
      f.className = 'pv-tile-file'
      const ext = (item.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toUpperCase()
      f.innerHTML = `${icon('file', 30)}${ext ? '<b></b>' : ''}`
      if (ext) f.querySelector('b').textContent = ext
      thumb.prepend(f)
    }
  }

  paintBusy(tile, id) {
    const thumb = tile.querySelector('.pv-tile-thumb')
    let busy = thumb.querySelector('.pv-tile-busy')
    const state = this.busy.get(id)
    if (!state) {
      if (busy && !busy.classList.contains('done')) {
        busy.classList.add('done')
        busy.querySelector('.bar').style.strokeDashoffset = '0'
        busy.querySelector('.pv-ring span').innerHTML = icon('check', 18)
        busy.addEventListener('animationend', (e) => e.target === busy && busy.remove())
        // (animations don't run in background tabs)
        setTimeout(() => busy.remove(), 700)
      }
      return
    }
    if (!busy || busy.classList.contains('done')) {
      busy?.remove()
      busy = document.createElement('div')
      busy.className = 'pv-tile-busy'
      busy.innerHTML = '<div class="pv-ring"><svg viewBox="0 0 46 46"><circle class="track" cx="23" cy="23" r="18"/><circle class="bar" cx="23" cy="23" r="18"/></svg><span></span></div>'
      thumb.append(busy)
    }
    busy.dataset.dir = state.dir
    const f = Math.max(0, Math.min(1, state.fraction))
    busy.querySelector('.bar').style.strokeDashoffset = String(113.1 * (1 - f))
    busy.querySelector('.pv-ring span').textContent = `${Math.round(f * 100)}%`
  }
}
