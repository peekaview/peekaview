// Voice chat: a WebRTC audio mesh. Participants may listen while their microphone is muted.
// Signaling runs over the PeekaView relay ({t:'rtc', to, sdp|candidate}); for every pair the
// participant with the lower id sends the offer (the presenter has id 0).
// While the microphone is on, its level goes to everybody ({t:'level', v: 0..1}) for the speaking
// indicator next to the cursor – also to participants who don't listen themselves.

const LEVEL_EVERY = 100 // ms

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
    this.enabled = false
    this.starting = false
    this.request = 0
    this.local = null
    this.peers = []
    this.pcs = new Map()
    this.pending = new Map()
    this.players = new Map()
  }

  setSelf(id, iceServers) {
    this.myId = id
    if (Array.isArray(iceServers) && iceServers.length) this.iceServers = iceServers
    this.sync()
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (enabled) this.sync()
    else this.stop()
  }

  async start() {
    if (!this.enabled || this.on || this.starting) return
    const request = ++this.request
    this.starting = true
    this.onChange?.()
    try {
      // Native audio processing; these preferences let the browser choose what it supports.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      // A closed room must not turn its microphone on after a delayed permission response.
      if (request !== this.request) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      this.local = stream
      this.on = true
      await Promise.all([...this.pcs.values()].flatMap(pc => pc.getSenders().map(sender => sender.replaceTrack(stream.getAudioTracks()[0]))))
      if (request !== this.request) return
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (this.local === stream) this.stop()
      }, { once: true })
      this.send({ t: 'voice', on: true })
      for (const player of this.players.values()) player.play().catch(console.warn)
      this.meter()
      this.sync()
    } catch (err) {
      if (request === this.request) { this.stop(); throw err }
    } finally {
      if (request === this.request) {
        this.starting = false
        this.onChange?.()
      }
    }
  }

  stop() {
    ++this.request
    this.starting = false
    const wasOn = this.on
    this.on = false
    if (wasOn) this.send({ t: 'voice', on: false })
    clearInterval(this.meterTimer)
    this.meterCtx?.close().catch(() => {})
    this.meterCtx = null
    for (const pc of this.pcs.values()) for (const sender of pc.getSenders()) sender.replaceTrack(null).catch(console.error)
    this.local?.getTracks().forEach((t) => t.stop())
    this.local = null
    this.level = 0
    this.sync()
    this.onChange?.()
  }

  /** Measures the own microphone and sends its level when it changes noticeably. */
  meter() {
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(this.local).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let last = 0
      let sentAt = 0
      this.meterCtx = ctx
      this.meterTimer = setInterval(() => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const s of buf) sum += s * s
        // -55 dB (quiet room) … -15 dB (loud speech) -> 0 … 1, in steps of .05
        const db = 10 * Math.log10(sum / buf.length + 1e-12)
        const v = Math.round(Math.min(1, Math.max(0, (db + 55) / 40)) * 20) / 20
        const now = performance.now()
        if (Math.abs(v - last) >= 0.1 || (v === 0) !== (last === 0) || (v > 0 && now - sentAt > 1000)) {
          last = v
          sentAt = now
          this.level = v
          this.send({ t: 'level', v })
        }
      }, LEVEL_EVERY)
    } catch (err) {
      console.warn('voice level', err)
    }
  }

  /** Room participant list (with `voice` flags) changed. */
  setPeers(list) {
    this.peers = list
    this.sync()
  }

  sync() {
    const wanted = new Set(this.enabled && this.myId !== null ? this.peers.filter((p) => (p.voice || this.on) && p.id !== this.myId).map((p) => p.id) : [])
    for (const id of [...this.pcs.keys()]) if (!wanted.has(id)) this.close(id)
    for (const id of wanted) if (!this.pcs.has(id) && this.myId < id) this.connect(id, true)
  }

  connect(id, offer) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pcs.set(id, pc)
    // Negotiate both directions once; replaceTrack switches the microphone without reconnecting.
    if (offer) pc.addTransceiver(this.on ? this.local.getAudioTracks()[0] : 'audio', { direction: 'sendrecv' })
    pc.onicecandidate = (e) => e.candidate && this.send({ t: 'rtc', to: id, candidate: e.candidate.toJSON() })
    pc.ontrack = (e) => {
      if (!this.enabled || this.pcs.get(id) !== pc) return
      let player = this.players.get(id)
      if (!player) {
        player = new Audio()
        player.autoplay = true
        this.players.set(id, player)
      }
      player.srcObject = new MediaStream([e.track])
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
    if (!this.enabled || typeof m.from !== 'number') return
    let pc = this.pcs.get(m.from)
    try {
      if (m.sdp?.type === 'offer') {
        pc ??= this.connect(m.from, false)
        await pc.setRemoteDescription(m.sdp)
        // Reuse the offer's transceiver; addTransceiver on the answerer would leave an extra, unassociated one.
        const transceiver = pc.getTransceivers()[0]
        transceiver.direction = 'sendrecv'
        await transceiver.sender.replaceTrack(this.on ? this.local.getAudioTracks()[0] : null)
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
