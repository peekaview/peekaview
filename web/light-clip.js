// "Bildschirmfreigabe light": the shared clipboard, held by the presenter's browser – as the desktop
// app (clip.rs) and the Android app (ClipStore.kt) hold it, and in their protocol:
//   - the items are announced on the "pv" channel: {t:"clip", items:[…]}, previews one by one
//     ({t:"clip-preview"}), uploads' progress ({t:"clip-progress"}); a viewer removes its own item
//     with {t:"clip-del"}
//   - the bytes travel over a "pvfile" channel per viewer (clipboard.js FileChannel is its other
//     end): {t:"put"} and chunks up, {t:"stored"}; {t:"get"} → {t:"data"}, chunks, {t:"end"} down
// Kept in this tab's memory until the share ends – fewer and smaller than on the desktop.

import { MAX_SIZE, makePreview, newId } from './clipboard.js'

const CHUNK = 16 * 1024
const MAX_TOTAL = 500 * 1024 * 1024
const MAX_ITEMS = 40
const HIGH_WATER = 4 << 20
const ID = /^[A-Za-z0-9_-]{1,32}$/

export class LightClip {
  /**
   * @param {{broadcast: (m: object) => void, send: (v: object, m: object) => void, viewers: () => Iterable<object>, onChange?: () => void}} io
   *   viewers: each with `files` (its "pvfile" channel) and `id`
   */
  constructor({ broadcast, send, viewers, onChange }) {
    this.broadcast = broadcast
    this.send = send
    this.viewers = viewers
    this.onChange = onChange ?? (() => {})
    this.items = new Map() // id -> {id, name, mime, size, from, at, text, hidden, preview, parts, received, blob}
    this.progressAt = 0
  }

  /** The items everybody sees (complete, not pasted only to be passed on). */
  all() {
    return [...this.items.values()].filter((it) => !it.hidden && it.blob)
  }

  meta(it) {
    const m = { id: it.id, name: it.name, mime: it.mime, size: it.size, from: it.from, at: it.at, received: it.received }
    if (it.text != null) m.text = it.text
    return m
  }

  list() {
    return { t: 'clip', items: this.all().map((it) => this.meta(it)) }
  }

  /** A viewer joined (its channels open): the list and the previews. */
  welcome(v) {
    this.send(v, this.list())
    this.sendPreviews(v)
  }

  sendPreviews(v) {
    v.previews ??= new Set()
    for (const it of this.all()) if (it.preview && !v.previews.has(it.id)) {
      v.previews.add(it.id)
      this.send(v, { t: 'clip-preview', id: it.id, preview: it.preview })
    }
  }

  /** Changed: everybody gets the list (and new previews), the presenter's page too. */
  announce() {
    this.broadcast(this.list())
    for (const v of this.viewers()) this.sendPreviews(v)
    this.onChange()
  }

  add({ id, name, mime, size, from, text, hidden, preview }) {
    if (!ID.test(String(id))) throw new Error('ungültige Kennung')
    size = Number(size)
    if (!Number.isFinite(size) || size < 0 || size > MAX_SIZE) throw new Error('Höchstens 100 MB pro Element')
    this.items.delete(id)
    // full: pasted (hidden) items first, then the oldest
    while (this.items.size >= MAX_ITEMS || [...this.items.values()].reduce((n, it) => n + it.size, 0) + size > MAX_TOTAL) {
      const drop = [...this.items.values()].find((it) => it.hidden) ?? this.items.values().next().value
      if (!drop) break
      this.items.delete(drop.id)
    }
    const item = {
      id,
      name: String(name ?? '').slice(0, 200).trim() || 'Datei',
      mime: String(mime ?? '').slice(0, 100) || 'application/octet-stream',
      size,
      from,
      at: Date.now(),
      text: typeof text === 'string' && text ? text.slice(0, 600) : null,
      hidden: !!hidden,
      preview: typeof preview === 'string' && preview.length <= 64000 && preview.startsWith('data:image/') ? preview : null,
      parts: [],
      received: 0,
      blob: null,
    }
    this.items.set(id, item)
    if (!size) item.blob = new Blob([], { type: item.mime })
    return item
  }

  /** Removes an item – its owner, or the presenter (0), may. */
  remove(id, by = 0) {
    const it = this.items.get(id)
    if (!it || (by !== 0 && it.from !== by)) return false
    this.items.delete(id)
    this.announce()
    return true
  }

  clear() {
    this.items.clear()
  }

  // ------------------------------------------------------------ a viewer's "pvfile" channel

  attach(v, dc) {
    v.files = dc
    v.upload = null
    v.serving = Promise.resolve()
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = 1 << 20
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string') return this.chunk(v, e.data)
      if (e.data.length > 200000) return
      let m
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      this.fileMessage(v, m)
    }
  }

  fileMessage(v, m) {
    if (m.t === 'put') {
      try {
        const item = this.add({ ...m, from: v.id })
        v.upload = item
        if (item.blob) this.uploaded(v, item)
      } catch (err) {
        this.sendFile(v, { t: 'error', id: m.id, error: err.message })
      }
    } else if (m.t === 'get') {
      // downloads one after the other, without flooding the connection
      v.serving = v.serving.then(() => this.serve(v, String(m.id), m.req)).catch(() => {})
    }
  }

  chunk(v, data) {
    const item = v.upload
    if (!item) return
    if (item.received + data.byteLength > item.size) {
      v.upload = null
      this.items.delete(item.id)
      return this.sendFile(v, { t: 'error', id: item.id, error: 'zu viele Daten' })
    }
    item.parts.push(data)
    item.received += data.byteLength
    const now = performance.now()
    if (now - this.progressAt > 250) {
      this.progressAt = now
      this.broadcast({ t: 'clip-progress', id: item.id, received: item.received })
    }
    if (item.received >= item.size) {
      item.blob = new Blob(item.parts, { type: item.mime })
      item.parts = []
      this.uploaded(v, item)
    }
  }

  uploaded(v, item) {
    v.upload = null
    this.sendFile(v, { t: 'stored', id: item.id })
    if (!item.hidden) this.announce()
  }

  sendFile(v, m) {
    if (v.files?.readyState === 'open') v.files.send(JSON.stringify(m))
  }

  async serve(v, id, req) {
    const dc = v.files
    const it = this.items.get(id)
    if (!dc || dc.readyState !== 'open') return
    if (!it?.blob) return this.sendFile(v, { t: 'error', id, req, error: 'nicht mehr vorhanden' })
    this.sendFile(v, { t: 'data', id, req, size: it.size })
    for (let off = 0; off < it.size; off += 1 << 20) {
      const block = new Uint8Array(await it.blob.slice(off, off + (1 << 20)).arrayBuffer())
      for (let i = 0; i < block.length; i += CHUNK) {
        while (dc.readyState === 'open' && dc.bufferedAmount > HIGH_WATER) {
          await new Promise((r) => {
            dc.addEventListener('bufferedamountlow', r, { once: true })
            setTimeout(r, 500)
          })
        }
        if (dc.readyState !== 'open') return
        dc.send(block.slice(i, i + CHUNK))
      }
    }
    this.sendFile(v, { t: 'end', id, req })
  }

  // ------------------------------------------------------------ the presenter's own

  /** The presenter puts files in (dropped, picked, pasted). */
  async addFile(file) {
    if (file.size > MAX_SIZE) throw new Error(`„${file.name}“ ist größer als 100 MB.`)
    const extra = await makePreview(file)
    const item = this.add({ id: newId(), name: file.name, mime: file.type, size: file.size, from: 0, ...extra })
    item.blob = file.slice(0, file.size, item.mime)
    item.received = file.size
    this.announce()
    return item
  }

  /** An item's bytes (for copying or saving here). */
  blobOf(id) {
    return this.items.get(id)?.blob ?? null
  }
}
