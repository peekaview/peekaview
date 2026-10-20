// Voice chat: a WebRTC audio mesh between everybody in the room who switched their microphone on.
// Signaling runs over the PeekaView relay ({t:'rtc', to, sdp|candidate}); for every pair the
// participant with the lower id sends the offer (the presenter has id 0).

export class Voice {
  /**
   * @param {{send: (msg: object) => void, onChange?: () => void}} options
   */
  constructor({ send, onChange }) {
    this.send = send
    this.onChange = onChange
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
    this.myId = null
    this.on = false
    this.local = null
    this.peers = []
    this.pcs = new Map()
    this.pending = new Map()
    this.players = new Map()
  }

  setSelf(id, iceServers) {
    this.myId = id
    if (Array.isArray(iceServers) && iceServers.length) this.iceServers = iceServers
  }

  async start() {
    if (this.on) return
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.on = true
    this.send({ t: 'voice', on: true })
    this.sync()
    this.onChange?.()
  }

  stop() {
    if (!this.on) return
    this.on = false
    this.send({ t: 'voice', on: false })
    for (const id of [...this.pcs.keys()]) this.close(id)
    this.local?.getTracks().forEach((t) => t.stop())
    this.local = null
    this.onChange?.()
  }

  /** Room participant list (with `voice` flags) changed. */
  setPeers(list) {
    this.peers = list
    this.sync()
  }

  sync() {
    const wanted = new Set(this.on ? this.peers.filter((p) => p.voice && p.id !== this.myId).map((p) => p.id) : [])
    for (const id of [...this.pcs.keys()]) if (!wanted.has(id)) this.close(id)
    for (const id of wanted) if (!this.pcs.has(id) && this.myId < id) this.connect(id, true)
  }

  connect(id, offer) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pcs.set(id, pc)
    for (const track of this.local.getTracks()) pc.addTrack(track, this.local)
    pc.onicecandidate = (e) => e.candidate && this.send({ t: 'rtc', to: id, candidate: e.candidate.toJSON() })
    pc.ontrack = (e) => {
      let player = this.players.get(id)
      if (!player) {
        player = new Audio()
        player.autoplay = true
        this.players.set(id, player)
      }
      player.srcObject = e.streams[0]
      player.play().catch(() => {})
      this.onChange?.()
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.close(id)
        this.sync()
      }
    }
    if (offer) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.send({ t: 'rtc', to: id, sdp: pc.localDescription.toJSON() }))
        .catch(console.error)
    }
    return pc
  }

  /** Incoming signaling message ({t:'rtc', from, sdp|candidate}). */
  async handle(m) {
    if (!this.on || typeof m.from !== 'number') return
    let pc = this.pcs.get(m.from)
    try {
      if (m.sdp?.type === 'offer') {
        pc ??= this.connect(m.from, false)
        await pc.setRemoteDescription(m.sdp)
        await pc.setLocalDescription(await pc.createAnswer())
        this.send({ t: 'rtc', to: m.from, sdp: pc.localDescription.toJSON() })
        await this.flush(m.from)
      } else if (m.sdp?.type === 'answer' && pc) {
        await pc.setRemoteDescription(m.sdp)
        await this.flush(m.from)
      } else if (m.candidate && pc) {
        // candidates may arrive before the description they belong to
        if (pc.remoteDescription) await pc.addIceCandidate(m.candidate)
        else this.pending.set(m.from, [...(this.pending.get(m.from) ?? []), m.candidate])
      }
    } catch (err) {
      console.warn('voice signaling', err)
    }
  }

  async flush(id) {
    const pc = this.pcs.get(id)
    for (const c of this.pending.get(id) ?? []) await pc?.addIceCandidate(c).catch(() => {})
    this.pending.delete(id)
  }

  close(id) {
    this.pcs.get(id)?.close()
    this.pcs.delete(id)
    this.pending.delete(id)
    const player = this.players.get(id)
    if (player) player.srcObject = null
    this.players.delete(id)
    this.onChange?.()
  }

  /** The voices of everybody else – e.g. for recording a session. */
  remoteStreams() {
    return [...this.players.values()].map((p) => p.srcObject).filter(Boolean)
  }
}
