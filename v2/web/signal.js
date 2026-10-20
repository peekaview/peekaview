// Serverless signaling over public Nostr relays.
//
// Everybody in a room shares a 128-bit room secret (only ever in the "#…" part of the link, so it
// never reaches a server). From it we derive
//   topic = SHA-256("peekaview/topic/v1:" + secret)  – the Nostr tag everybody subscribes to
//   key   = SHA-256("peekaview/key/v1:" + secret)    – AES-256-GCM key for every message
// Relays only see ephemeral events (kind 25050, not stored) with opaque content, signed by a
// throw-away key per participant. Only the WebRTC connection setup goes this way; afterwards all
// data flows peer-to-peer.
//
// The presenter signs with a room key whose public half is part of the link ("#secret.key").
// Viewers only accept presenter messages carrying a valid signature of exactly that key – so
// somebody who merely knows the room secret cannot pose as the presenter.

import { schnorr } from './vendor/noble-schnorr.js'

export const KIND = 25050
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub']

const enc = new TextEncoder()
const dec = new TextDecoder()
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data))
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))

/** Splits a room string "secret" or "secret.presenterKey" (the "#…" part of a link). */
export function parseRoom(room) {
  const [secret, key] = String(room ?? '').split('.')
  let hostKey = null
  try {
    if (key) hostKey = hex(unb64url(key))
  } catch {}
  return { secret, hostKey: hostKey?.length === 64 ? hostKey : null }
}

async function verifyEvent(e) {
  try {
    const id = await sha256(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))
    return hex(id) === e.id && schnorr.verify(unhex(e.sig), id, unhex(e.pubkey))
  } catch {
    return false
  }
}

/** A fresh room secret (base64url, 22 characters). */
export function newRoomSecret() {
  return b64(crypto.getRandomValues(new Uint8Array(16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class Signaling {
  /**
   * @param {{secret: string, hostKey?: string | null, relays?: string[], onMessage: (msg: object) => void}} options
   *   hostKey: the presenter's public key (hex); when given, presenter messages must be signed by it
   */
  static async open({ secret, hostKey = null, relays = DEFAULT_RELAYS, onMessage }) {
    const topic = hex(await sha256(`peekaview/topic/v1:${secret}`))
    const key = await crypto.subtle.importKey('raw', await sha256(`peekaview/key/v1:${secret}`), 'AES-GCM', false, ['encrypt', 'decrypt'])
    const signaling = new Signaling(topic, key, relays, onMessage)
    signaling.hostKey = hostKey
    signaling.connectAll()
    return signaling
  }

  constructor(topic, key, relays, onMessage) {
    this.topic = topic
    this.key = key
    this.relays = relays
    this.onMessage = onMessage
    this.secretKey = schnorr.utils.randomSecretKey()
    this.pubkey = hex(schnorr.getPublicKey(this.secretKey))
    this.sockets = new Map()
    this.seen = new Set()
    this.closed = false
    // recent events, re-sent to relays that connect later (nothing is lost while connecting)
    this.recent = []
  }

  connectAll() {
    for (const url of this.relays) this.connect(url, 1000)
  }

  connect(url, backoff) {
    if (this.closed) return
    let ws
    try {
      ws = new WebSocket(url)
    } catch {
      return
    }
    this.sockets.set(url, ws)
    ws.onopen = () => {
      backoff = 1000
      const since = Math.floor(Date.now() / 1000) - 10
      ws.send(JSON.stringify(['REQ', `pv-${this.topic.slice(0, 8)}`, { kinds: [KIND], '#t': [this.topic], since }]))
      this.recent = this.recent.filter((r) => Date.now() - r.at < 10000)
      for (const r of this.recent) ws.send(r.frame)
    }
    ws.onmessage = (e) => {
      try {
        const [type, , event] = JSON.parse(e.data)
        if (type === 'EVENT') this.receive(event)
      } catch {}
    }
    ws.onclose = () => {
      this.sockets.delete(url)
      setTimeout(() => this.connect(url, Math.min(backoff * 2, 30000)), backoff)
    }
  }

  async receive(event) {
    if (!event || this.seen.has(event.id) || event.pubkey === this.pubkey) return
    this.seen.add(event.id)
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000))
    if (Math.abs(Date.now() / 1000 - event.created_at) > 120) return
    try {
      const raw = unb64(event.content)
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, this.key, raw.slice(12))
      const msg = JSON.parse(dec.decode(plain))
      // presenter messages only from the pinned presenter key
      if (this.hostKey && msg.from === 'host' && !(event.pubkey === this.hostKey && (await verifyEvent(event)))) return
      this.onMessage(msg)
    } catch {
      // not for this room (or tampered with) – AES-GCM authenticates every message
    }
  }

  async send(msg) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(JSON.stringify(msg))))
    const content = b64(new Uint8Array([...iv, ...cipher]))
    const created_at = Math.floor(Date.now() / 1000)
    const tags = [['t', this.topic]]
    const id = await sha256(JSON.stringify([0, this.pubkey, created_at, KIND, tags, content]))
    const event = { id: hex(id), pubkey: this.pubkey, created_at, kind: KIND, tags, content, sig: hex(schnorr.sign(id, this.secretKey)) }
    const frame = JSON.stringify(['EVENT', event])
    this.recent = [...this.recent.filter((r) => Date.now() - r.at < 10000), { at: Date.now(), frame }]
    for (const ws of this.sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(frame)
  }

  close() {
    this.closed = true
    for (const ws of this.sockets.values()) ws.close()
    this.sockets.clear()
  }
}

export { hex, unhex }
