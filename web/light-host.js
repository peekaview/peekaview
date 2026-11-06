// "Bildschirmfreigabe light": sharing straight from the browser, without PeekaView Desktop.
//
// Speaks the protocol of the desktop host (client/src-tauri/src/p2p/hub.rs) and the Android app
// (Host.kt), so every viewer joins with the normal link:
//   - Nostr signaling, AES-256-GCM with the room secret, the presenter signs with the room key
//     from the link ("#secret.key"); viewers are their keys (only "from" = signing key counts)
//   - every viewer has to be let in ("Zulassen" / "Ablehnen")
//   - one WebRTC connection per viewer: the picture of getDisplayMedia as slot 0, the "pv"
//     data channel (welcome, state, participants, pointers, drawings) and "pvfile" (the shared
//     clipboard's files, light-clip.js)
//
// What a browser cannot do, this host does not offer: no remote control (browsers cannot inject
// input), no recording, a single source. The state says `light: true`, so viewers can explain
// that instead of offering "Steuern"; `clipboard: true`: the shared clipboard is there.

import { Signaling, newRoomSecret } from './signal.js'
import { schnorr } from './vendor/noble-schnorr.js'
import { LightClip } from './light-clip.js'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899']
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
// PeekaView's service hands out short-lived TURN credentials (only to peekaview.de)
export const TURN_SERVICE = 'https://peekaview.devxpert.de/api.php?action=turn'
export const HOST_ID = 0
export const HOST_COLOR = '#0ea5e9'
const MAX_VIEWERS = 12
const REQUEST_TIMEOUT = 25000
const ANNOTATIONS = ['ptr', 'ping', 'draw', 'clear', 'hide']

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || 'Gast'

export class LightHost {
  /**
   * @param {{stream: MediaStream, name: string, mode?: 'view'|'draw', relays?: string[], site?: string,
   *          turnService?: string|null, onChange?: () => void, onAnnotation?: (m: object) => void, onEnded?: (why?: string) => void,
   *          surface?: () => string|undefined, size?: () => {width, height}, sources?: MediaStreamTrack[]}} options
   *   surface, size: what is shared and how large, when `stream` is made from another picture (a
   *   window cut out of the whole screen); sources: tracks behind it, stopped with the share
   */
  constructor({ stream, name, mode = 'draw', relays, site = new URL('./', location.href).href, turnService = TURN_SERVICE, onChange, onAnnotation, onEnded, surface, size, sources = [] }) {
    this.stream = stream
    this.track = stream.getVideoTracks()[0]
    this.name = cleanName(name)
    this.mode = mode === 'view' ? 'view' : 'draw'
    this.relays = relays
    this.site = site
    this.turnService = turnService
    this.onChange = onChange ?? (() => {})
    this.onAnnotation = onAnnotation ?? (() => {})
    this.onEnded = onEnded ?? (() => {})
    this.surfaceOf = surface
    this.sizeOf = size
    this.sources = sources
    this.secret = newRoomSecret()
    this.secretKey = schnorr.utils.randomSecretKey()
    this.room = `${this.secret}.${b64url(schnorr.getPublicKey(this.secretKey))}`
    this.link = `${this.site.replace(/#.*$/, '')}#${this.room}`
    this.viewers = new Map() // peer key -> viewer
    // the shared clipboard (onChange: the presenter's page shows it anew)
    this.clip = new LightClip({
      broadcast: (m) => this.broadcast(m),
      send: (v, m) => this.send(v, m),
      viewers: () => [...this.viewers.values()].filter((v) => v.dc?.readyState === 'open'),
      onChange: () => this.onClip?.(),
    })
    this.onClip = null
    this.requests = new Map() // peer key -> {peer, name, color, seen}
    this.admitted = new Set()
    this.denied = new Set()
    this.nextId = 1
    this.ice = [{ urls: STUN }]
    this.stopped = false
    this.timers = []
    // text stays sharp: fewer frames rather than fewer pixels
    try {
      this.track.contentHint = 'detail'
    } catch {}
    this.onTrackEnded = () => this.stop('Die Freigabe wurde im Browser beendet.')
    for (const t of [this.track, ...sources]) t.addEventListener('ended', this.onTrackEnded)
  }

  /** What is shared: 'monitor' (a whole screen), 'window' or 'browser' (a tab). */
  get surface() {
    return this.surfaceOf?.() ?? this.track.getSettings?.().displaySurface ?? 'monitor'
  }

  /** The size of the shared picture (pixels). */
  get size() {
    const s = this.sizeOf?.() ?? this.track.getSettings?.() ?? {}
    return { width: s.width, height: s.height }
  }

  /** What is shared changed (another window picked): viewers lay it out anew. */
  update() {
    this.broadcast(this.state())
    this.changed()
  }

  async start() {
    this.fetchTurn()
    this.signaling = await Signaling.open({ secret: this.secret, relays: this.relays, secretKey: this.secretKey, strictFrom: true, onMessage: (m) => this.signal(m) })
    // presence beacon: viewers waiting for this room say hello right away
    const beacon = () => this.signaling.send({ type: 'host', from: 'host' })
    beacon()
    this.timers.push(setInterval(beacon, 15000))
    this.timers.push(setInterval(() => this.sweep(), 3000))
    // the shared window changed its size: viewers lay it out anew
    let size = this.sizeKey()
    this.timers.push(
      setInterval(() => {
        if (this.sizeKey() === size) return
        size = this.sizeKey()
        this.broadcast(this.state())
      }, 2000),
    )
    this.changed()
  }

  async fetchTurn() {
    if (!this.turnService) return
    try {
      const response = await fetch(this.turnService, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await response.json()
      const turn = (body.iceServers ?? []).filter((s) => Array.isArray(s.urls) && typeof s.username === 'string' && typeof s.credential === 'string')
      if (turn.length) this.ice = [{ urls: STUN }, ...turn]
    } catch {
      // only STUN: most networks connect directly anyway
    }
  }

  stop(why) {
    if (this.stopped) return
    this.stopped = true
    for (const t of this.timers) clearInterval(t)
    for (const v of this.viewers.values()) {
      this.send(v, { t: 'end' })
      setTimeout(() => v.pc.close(), 200)
    }
    this.viewers.clear()
    this.requests.clear()
    this.clip.clear()
    this.signaling?.send({ type: 'bye', from: 'host' })
    setTimeout(() => this.signaling?.close(), 300)
    for (const t of [this.track, ...this.sources]) t.removeEventListener('ended', this.onTrackEnded)
    for (const t of [...this.stream.getTracks(), ...this.sources]) t.stop()
    this.onChange()
    this.onEnded(why)
  }

  // ------------------------------------------------------------ for the UI

  /** Viewers who are connected. */
  get viewerList() {
    return [...this.viewers.values()].filter((v) => v.connected).map(({ id, name, color }) => ({ id, name, color }))
  }

  get requestList() {
    return [...this.requests.values()].map(({ peer, name, color }) => ({ peer, name, color }))
  }

  admit(peer, allow) {
    const request = this.requests.get(peer)
    if (!request) return
    this.requests.delete(peer)
    if (allow) {
      this.admitted.add(peer)
      this.invite(peer, request.name, request.color)
    } else {
      this.denied.add(peer)
      this.signaling.send({ type: 'denied', from: 'host', to: peer })
    }
    this.changed()
  }

  admitAll() {
    for (const peer of [...this.requests.keys()]) this.admit(peer, true)
  }

  setMode(mode) {
    if (!['view', 'draw'].includes(mode) || mode === this.mode) return
    this.mode = mode
    this.broadcast(this.state())
    this.onAnnotation(this.state())
    this.changed()
  }

  /** The presenter points or draws (in the helper window): everybody sees it. */
  annotate(m) {
    if (!ANNOTATIONS.includes(m?.t)) return
    this.broadcast({ ...m, from: HOST_ID, w: 0 })
  }

  changed() {
    this.onChange()
  }

  // ------------------------------------------------------------ signaling

  signal(m) {
    const from = m.from
    if (this.stopped || typeof from !== 'string' || from === 'host' || from.length > 64) return
    const v = this.viewers.get(from)
    switch (m.type) {
      case 'hello':
        return this.hello(from, m)
      case 'answer':
        if (!v || !m.sdp) return
        v.pc
          .setRemoteDescription(m.sdp)
          .then(() => {
            v.answered = true
            for (const c of v.pending) v.pc.addIceCandidate(c).catch(() => {})
            v.pending = []
          })
          .catch(() => this.remove(v))
        return
      case 'candidate':
        if (!v || !m.candidate) return
        if (v.answered) v.pc.addIceCandidate(m.candidate).catch(() => {})
        else v.pending.push(m.candidate)
        return
      case 'bye':
        if (v) this.remove(v)
        if (this.requests.delete(from)) this.changed()
        return
      // a start page asks whether this room is online
      case 'ping':
        this.signaling.send({ type: 'pong', from: 'host', to: from, who: `${this.name} (Browser)`, name: this.name, room: null, permanent: false, sharing: true, pin: false, remote: false })
        return
    }
  }

  hello(peer, m) {
    const known = this.viewers.get(peer)
    if (known) {
      // a viewer that reloaded (or whose connection never came about) gets a new invitation
      const now = Date.now()
      const stale = (known.connected && now - known.connectedAt > 5000) || (!known.connected && now - known.invited > 10000)
      if (!stale) return
      this.remove(known)
    }
    const name = cleanName(m.name)
    const color = /^#[0-9a-f]{6}$/i.test(m.color ?? '') ? m.color.toLowerCase() : ''
    if (this.admitted.has(peer)) return this.invite(peer, name, color)
    if (this.denied.has(peer)) return this.signaling.send({ type: 'denied', from: 'host', to: peer })
    // nobody watches without the presenter's OK
    const isNew = !this.requests.has(peer)
    this.requests.set(peer, { peer, name, color, seen: Date.now() })
    this.signaling.send({ type: 'waiting', from: 'host', to: peer })
    if (isNew) this.changed()
  }

  // requests without a repeated hello for a while are gone (the page was closed)
  sweep() {
    const now = Date.now()
    let gone = false
    for (const [peer, r] of this.requests) {
      if (now - r.seen > REQUEST_TIMEOUT) {
        this.requests.delete(peer)
        gone = true
      }
    }
    if (gone) this.changed()
  }

  // ------------------------------------------------------------ connections

  async invite(peer, name, helloColor) {
    if (this.stopped || this.viewers.size >= MAX_VIEWERS) return
    const id = this.nextId++
    const color = helloColor || COLORS[(id - 1) % COLORS.length]
    const pc = new RTCPeerConnection({ iceServers: this.ice })
    const v = { id, peer, name, color, pc, dc: null, connected: false, connectedAt: 0, invited: Date.now(), answered: false, pending: [], voice: false }
    this.viewers.set(peer, v)
    pc.onicecandidate = (e) => e.candidate && this.signaling.send({ type: 'candidate', from: 'host', to: peer, id, candidate: e.candidate.toJSON() })
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && !v.connected) {
        v.connected = true
        v.connectedAt = Date.now()
        this.changed()
      } else if (['failed', 'closed'].includes(pc.connectionState) && this.viewers.get(peer) === v) {
        this.remove(v)
      }
    }
    // the picture as slot 0 (the viewer finds the window by the stream id "w<slot>", 0 without)
    const sender = pc.addTrack(this.track, this.stream)
    preferH264(pc, sender)
    v.dc = pc.createDataChannel('pv', { ordered: true })
    v.dc.onopen = () => this.opened(v)
    v.dc.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > 65536) return
      try {
        this.message(v, JSON.parse(e.data))
      } catch {}
    }
    // the shared clipboard's files
    this.clip.attach(v, pc.createDataChannel('pvfile', { ordered: true }))
    try {
      await pc.setLocalDescription(await pc.createOffer())
      limitSender(sender)
      this.signaling.send({ type: 'offer', from: 'host', to: peer, sdp: pc.localDescription.toJSON(), ice: this.ice, id, name: this.name, color })
    } catch (err) {
      console.warn('peekaview light: offer failed', err)
      this.remove(v)
    }
  }

  remove(v) {
    if (this.viewers.get(v.peer) !== v) return
    this.viewers.delete(v.peer)
    try {
      v.pc.close()
    } catch {}
    const left = { t: 'left', id: v.id }
    this.broadcast(left)
    this.onAnnotation(left)
    this.announcePeers()
    this.changed()
  }

  opened(v) {
    this.send(v, { t: 'welcome', id: v.id, name: v.name, color: v.color, ice: this.ice })
    this.send(v, this.state())
    this.clip.welcome(v)
    this.announcePeers()
    this.changed()
  }

  send(v, m) {
    if (v.dc?.readyState === 'open') v.dc.send(JSON.stringify(m))
  }

  broadcast(m, except) {
    const text = JSON.stringify(m)
    for (const v of this.viewers.values()) if (v !== except && v.dc?.readyState === 'open') v.dc.send(text)
  }

  announcePeers() {
    const m = this.peers()
    this.broadcast(m)
    this.onAnnotation(m)
  }

  peers() {
    const list = [{ id: HOST_ID, name: this.name, color: HOST_COLOR, host: true, voice: false }]
    for (const v of [...this.viewers.values()].sort((a, b) => a.id - b.id)) if (v.dc?.readyState === 'open') list.push({ id: v.id, name: v.name, color: v.color, voice: v.voice })
    return { t: 'peers', list }
  }

  sizeKey() {
    const s = this.size
    return `${s.width}x${s.height}:${this.surface}`
  }

  state() {
    const s = this.size
    const w = s.width || 1280
    const h = s.height || 720
    const screen = this.surface === 'monitor'
    // (a picture made here – a window cut out of the screen – has no name of its own)
    const title = screen ? 'Bildschirm' : (!this.surfaceOf && this.track.label) || (this.surface === 'browser' ? 'Browser-Tab' : 'Fenster')
    const rect = { x: 0, y: 0, w, h }
    return {
      t: 'state',
      mode: this.mode,
      // shared from a browser: no remote control, recording, voice – the shared clipboard, yes
      light: true,
      clipboard: true,
      windows: [{ w: 0, kind: screen ? 'screen' : 'window', title, app: title, pw: w, ph: h, paused: false, reachable: true, z: 0, rect }],
      screens: [rect],
      kind: screen ? 'screen' : 'window',
      title,
      paused: false,
      reachable: true,
      recording: false,
      remote: false,
      apps: [],
      resize: false,
      locked: false,
      voice_enabled: false,
    }
  }

  // ------------------------------------------------------------ messages of a viewer

  message(v, m) {
    m.from = v.id
    switch (m.t) {
      // pointers and drawings go to the others and to the helper window (not while viewers only watch)
      case 'ptr':
      case 'ping':
      case 'draw':
      case 'clear':
      case 'hide':
        if (this.mode === 'view') return
        this.broadcast(m, v)
        this.onAnnotation(m)
        return
      // a viewer removes its own item from the shared clipboard
      case 'clip-del':
        this.clip.remove(String(m.id), v.id)
        return
      case 'level':
        this.broadcast({ ...m, v: Math.min(1, Math.max(0, Number(m.v) || 0)) }, v)
        return
      case 'voice':
        v.voice = !!m.on
        this.announcePeers()
        return
      // voice between viewers: the presenter only passes it on
      case 'rtc': {
        const to = [...this.viewers.values()].find((x) => x.id === m.to)
        if (to) this.send(to, m)
        return
      }
      case 'mouse':
      case 'wheel':
      case 'key':
      case 'text':
      case 'paste':
        this.send(v, { t: 'control-error', error: 'Steuern geht bei einer Freigabe aus dem Browser nicht – dafür braucht die teilende Person PeekaView Desktop.' })
    }
  }
}

// H.264 first: decoded in hardware almost everywhere (as from the desktop app)
function preferH264(pc, sender) {
  try {
    const t = pc.getTransceivers().find((x) => x.sender === sender)
    const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs
    if (!t?.setCodecPreferences || !codecs?.length) return
    const h264 = codecs.filter((c) => /h264/i.test(c.mimeType))
    if (h264.length) t.setCodecPreferences([...h264, ...codecs.filter((c) => !/h264/i.test(c.mimeType))])
  } catch {}
}

// enough bits for a sharp screen (contentHint "detail" keeps the resolution under pressure)
function limitSender(sender) {
  try {
    const p = sender.getParameters()
    if (!p.encodings?.length) return
    for (const e of p.encodings) {
      e.maxBitrate = 6_000_000
      e.maxFramerate = 30
    }
    sender.setParameters(p).catch(() => {})
  } catch {}
}
