// PeekaView viewer – framework independent. Mount it into any element:
//
//   import { mountViewer } from '@peekaview/viewer'
//   const viewer = mountViewer(el, { room: '<room secret from the link>', name: 'Anna', color: '#e6194b' })
//   viewer.destroy()
//
// Peer-to-peer: the connection to the presenter is set up over public Nostr relays (end-to-end
// encrypted with the room secret), then video (WebRTC H.264, decoded in hardware), pointer, ink,
// remote control and voice flow directly between the participants. No server of our own.

import { injectStyle } from './annotate.js'
import { WindowManager } from './windows.js'
import { icon } from './icons.js'
import { Voice } from './voice.js'
import { Signaling, hex, parseRoom, viewerKey } from './signal.js'
import { schnorr } from './vendor/noble-schnorr.js'
import { ClipPanel, FileChannel, MAX_SIZE, browserCopyable, filesFromClipboard, newId, readSystemClipboard, saveBlob, asPng } from './clipboard.js'

export { peerColor } from './icons.js'

// the same names in every PeekaView (viewer, desktop toolbar, tray, Android)
const MODES = { view: 'Zusehen', draw: 'Zeigen & Malen', control: 'Steuern' }
const MODE_ICONS = { view: 'view', draw: 'draw', control: 'control' }
const TOOLS = { view: [], draw: ['point', 'draw'], control: ['point', 'draw', 'control'] }
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS']
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

const CSS = `
.pv-viewer {
  --pv-accent: #ef4444; --pv-bg: #09090b; --pv-fg: #fafafa; --pv-muted: #a1a1aa;
  --pv-glass: rgba(24, 24, 27, .78); --pv-line: rgba(255, 255, 255, .09);
  position: relative; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden;
  background: var(--pv-bg); color: var(--pv-fg);
  font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased; user-select: none;
}
.pv-viewer [hidden] { display: none !important; }
/* independent of the embedding page's styles */
.pv-viewer button { margin: 0; box-sizing: border-box; font: inherit; line-height: 1; }
.pv-viewer svg { flex: none; }
.pv-glass { background: var(--pv-glass); border: 1px solid var(--pv-line); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 8px 28px rgba(0, 0, 0, .35); }
.pv-stage { position: absolute; inset: 0; overflow: hidden; display: grid; place-items: center; isolation: isolate; }
.pv-view { position: relative; touch-action: none; }
.pv-viewer[data-tool="draw"] .pv-view { cursor: crosshair; }
.pv-screen, .pv-ann { position: absolute; inset: 0; width: 100%; height: 100%; }
.pv-screen { object-fit: fill; background: #000; pointer-events: none; }
.pv-status { display: flex; align-items: center; gap: 5px; min-width: 0; }
.pv-live { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.pv-title { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.pv-dock:has(.pv-task) .pv-title { display: none; }
.pv-mode, .pv-rec, .pv-paused { display: inline-flex; align-items: center; flex: none; }
.pv-chip { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: 999px; min-width: 0; }
.pv-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--pv-accent); box-shadow: 0 0 0 3px rgba(239, 68, 68, .25); animation: pv-pulse 2s ease-in-out infinite; }
.pv-mode { color: var(--pv-muted); }
.pv-mode[data-mode="draw"] { color: #fde68a; }
.pv-mode[data-mode="control"] { color: #fca5a5; }
.pv-peers { position: absolute; top: calc(var(--pv-toolbar-bottom, 0px) + 12px); right: 12px; z-index: 0; display: flex; margin: 0; padding: 0 0 0 6px; list-style: none; }
.pv-peers li { width: 30px; height: 30px; margin-left: -6px; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--pv-bg); color: #fff; font-size: 11px; font-weight: 650; letter-spacing: .02em; text-shadow: 0 1px 1px rgba(0,0,0,.3); }
.pv-peers li.me { border-color: var(--pv-fg); }
.pv-peers li.voice { box-shadow: 0 0 0 2px #22c55e; }
.pv-rec { color: #fca5a5; }
.pv-paused { color: #fde68a; }
.pv-dock button.live { background: #16a34a; color: #fff; }
.pv-dock { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); box-sizing: border-box; width: max-content; max-width: calc(100% - 24px); display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px; padding: 5px; border-radius: 14px; }
/* Shared windows stay in the stage stacking context, below these controls. */
.pv-dock, .pv-toast, .pv-notice, .pv-stats { z-index: 100000; }
.pv-stats { position: absolute; left: 12px; top: calc(var(--pv-toolbar-bottom, 0px) + 12px); max-width: calc(100% - 24px); padding: 8px 11px; border-radius: 10px; color: #d4d4d8; font: 11.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; white-space: pre; overflow: hidden; pointer-events: none; }
.pv-stats b { color: #fafafa; font-weight: 650; }
.pv-dock.collapsed > :not(.pv-fold):not(.pv-status):not([data-voice]) { display: none !important; }
.pv-dock.collapsed .pv-live, .pv-dock.collapsed .pv-mode { display: none; }
.pv-dock.collapsed .pv-status:has(.pv-rec[hidden]):has(.pv-paused[hidden]) { display: none; }
.pv-dock .pv-fold { width: 26px; color: var(--pv-muted); }
.pv-dock .pv-fold:hover:not(:disabled) { color: var(--pv-fg); }
.pv-dock button[data-count]::before { content: attr(data-count); position: absolute; top: 3px; right: 3px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; background: var(--pv-accent); color: #fff; font-size: 10px; font-weight: 700; line-height: 15px; }
.pv-dock button.open { background: rgba(255, 255, 255, .14); }
.pv-tasks { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 3px; min-width: 0; max-width: 100%; }
.pv-dock .pv-task { width: auto; max-width: 150px; gap: 7px; padding: 0 10px 0 7px; grid-auto-flow: column; color: var(--pv-muted); }
.pv-dock .pv-task span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.pv-dock .pv-task i { width: 16px; height: 16px; border-radius: 4px; display: grid; place-items: center; color: #fff; font: 700 9px/1 system-ui, sans-serif; font-style: normal; }
.pv-dock .pv-task.active { color: var(--pv-fg); background: rgba(255, 255, 255, .1); }
.pv-dock .pv-task.min { opacity: .5; }
.pv-toast { position: absolute; top: calc(var(--pv-toolbar-bottom, 0px) + 12px); left: 50%; transform: translateX(-50%); max-width: calc(100% - 24px); color: #fde68a; pointer-events: none; animation: pv-in .2s ease-out; }
@keyframes pv-in { from { opacity: 0; transform: translate(-50%, -4px); } }
.pv-dock button { position: relative; width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 10px; background: transparent; color: var(--pv-fg); cursor: pointer; transition: background .15s, color .15s, opacity .15s; }
.pv-dock button:hover:not(:disabled) { background: rgba(255, 255, 255, .09); }
.pv-dock button.active { background: var(--pv-fg); color: var(--pv-bg); }
.pv-dock button:disabled { opacity: .28; cursor: default; }
.pv-dock button::after { content: attr(data-tip); position: absolute; top: calc(100% + 10px); left: 50%; transform: translate(-50%, -4px); padding: 5px 9px; border-radius: 8px; background: #18181b; border: 1px solid var(--pv-line); white-space: nowrap; font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .12s, transform .12s; }
.pv-dock button:hover::after { opacity: 1; transform: translate(-50%, 0); }
.pv-sep { width: 1px; height: 22px; margin: 0 3px; background: var(--pv-line); }
.pv-notice { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; max-width: min(420px, 80%); padding: 11px 16px; border-radius: 12px; color: var(--pv-fg); }
.pv-notice-text { flex: 1; min-width: 0; }
.pv-pin { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--pv-line); }
.pv-pin small { flex-basis: 100%; color: var(--pv-muted); }
.pv-pin input { flex: 1; min-width: 0; height: 34px; padding: 0 11px; border-radius: 9px; border: 1px solid var(--pv-line); background: var(--pv-bg); color: var(--pv-fg); font: inherit; letter-spacing: .2em; outline: none; user-select: text; }
.pv-pin input:focus { border-color: var(--pv-accent); }
.pv-pin button { height: 34px; padding: 0 13px; border: 0; border-radius: 9px; background: var(--pv-accent); color: #fff; font: inherit; font-weight: 650; cursor: pointer; }
.pv-pin button:disabled { opacity: .5; cursor: default; }
.pv-pin .pv-pin-error { color: #fca5a5; }
.pv-dock .pv-task.launch { border: 1px dashed rgba(255, 255, 255, .22); color: var(--pv-muted); }
.pv-dock .pv-task.launch:hover { border-color: var(--pv-accent); color: var(--pv-fg); }
.pv-dock .pv-task.launch svg { flex: none; }
.pv-spinner { flex: none; width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, .2); border-top-color: var(--pv-fg); border-radius: 50%; animation: pv-spin .8s linear infinite; }
.pv-keys { position: absolute; left: -1000px; top: 0; width: 10px; height: 10px; opacity: 0; }
@keyframes pv-spin { to { transform: rotate(360deg); } }
@keyframes pv-pulse { 50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, .12); } }
`

/**
 * @param {HTMLElement} el
 * @param {{room: string, name: string, color?: string, relays?: string[], toolbar?: boolean, voice?: boolean,
 *          peers?: boolean, device?: string, onRooms?: () => void, onStatus?: (status: string) => void, onPeers?: (list: any[]) => void}} options
 */
export function mountViewer(el, options) {
  const { room, name, color, relays, toolbar = true, peers = true, voice: voiceEnabled = true, onStatus, onPeers } = options
  injectStyle('pv-viewer-style', CSS)

  el.classList.add('pv-viewer')
  el.innerHTML = `
    <div class="pv-stage">
      <ul class="pv-peers"></ul>
      <div class="pv-notice pv-glass"><span class="pv-spinner"></span><span class="pv-notice-text"></span>
        <form class="pv-pin" hidden><small>Nicht am Platz? Mit der PIN des Raums geht es auch ohne Bestätigung.</small><input type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><button>Eintreten</button><small class="pv-pin-error" hidden></small></form>
        <form class="pv-pin pv-unlock" hidden><input type="password" autocomplete="off" placeholder="Passwort des Benutzers"><button>Entsperren</button><small class="pv-pin-error" hidden></small></form>
      </div>
    </div>
    <div class="pv-stats pv-glass" hidden></div>
    <div class="pv-chip pv-glass pv-toast" hidden>${icon('control', 15)}<span></span></div>
    <div class="pv-dock pv-glass">
      <div class="pv-status">
        <span class="pv-live"><i class="pv-dot"></i><span class="pv-title"></span></span>
        <span class="pv-mode" role="img"></span>
        <span class="pv-rec" role="img" aria-label="Wird aufgezeichnet" title="Wird aufgezeichnet" hidden><i class="pv-dot"></i></span>
        <span class="pv-paused" role="img" aria-label="Steuerung pausiert" title="Steuerung pausiert – das Fenster ist bei der teilenden Person verdeckt" hidden>${icon('control', 15)}</span>
      </div>
      <span class="pv-tasks"></span>
      <button data-tile data-tip="Fenster nebeneinander">${icon('tile')}</button>
      <span class="pv-sep pv-tasks-sep"></span>
      <button data-tool="point" data-tip="Zeigen">${icon('point')}</button>
      <button data-tool="draw" data-tip="Malen">${icon('draw')}</button>
      <button data-tool="control" data-tip="Steuern">${icon('control')}</button>
      <button data-clear data-tip="Meine Zeichnungen löschen">${icon('erase')}</button>
      <span class="pv-sep pv-tools-sep"></span>
      <button data-clip data-tip="Gemeinsame Zwischenablage">${icon('clipboard')}</button>
      <button data-fixed-rooms data-tip="Kontakte" aria-label="Kontakte" ${options.onRooms ? '' : 'hidden'}>${icon('window')}</button>
      <button data-voice data-tip="Mikrofon einschalten" aria-label="Mikrofon einschalten" aria-pressed="false">${icon('micOff')}</button>
      <button class="pv-fold" data-tip="Einklappen">${icon('collapse', 16)}</button>
    </div>
    <textarea class="pv-keys" aria-hidden="true" tabindex="-1" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>`
  const q = (s) => el.querySelector(s)
  const stage = q('.pv-stage')

  const keys = q('.pv-keys')
  // every shared window in a frame of its own (or alone, as large as possible)
  let toolbarSpace = 0
  let dockFrame = 0
  const scheduleDock = () => {
    if (!dockFrame) dockFrame = requestAnimationFrame(() => { dockFrame = 0; positionDock() })
  }
  const wm = new WindowManager(stage, {
    voice: voiceEnabled,
    // how large each window is shown here – the presenter encodes no more pixels than that
    onSizes: (sizes) => send({ t: 'view-size', sizes }),
    // "Resize/Anordnen erlauben" on the presenter's side: windows resized, moved or activated
    // here follow there
    canResize: () => state.mode === 'control' && state.resize === true,
    canActivate: () => state.resize === true,
    onResize: (slot, pw, ph) => send({ t: 'resize', w: slot, pw, ph }),
    onActivate: (slot) => send({ t: 'activate', w: slot }),
    onNav: (slot, a) => send({ t: 'nav', a, w: slot }),
    topSpace: () => toolbarSpace,
    onPlace: (slot, f) => send({ t: 'arrange', w: slot, ...f }),
    onChange: () => {
      renderTasks()
      scheduleDock()
    },
    onFrame: () => {
      if (!hasFrame) {
        hasFrame = true
        update()
      }
      reportViewport()
      scheduleDock()
    },
  })
  q('.pv-status').hidden = !toolbar
  q('.pv-dock').hidden = !toolbar
  q('.pv-peers').hidden = !peers

  let me
  const voice = new Voice({
    send: (m) => send(m),
    onChange: () => {
      const b = q('[data-voice]')
      b.classList.toggle('live', voice.on)
      b.disabled = voice.starting
      b.setAttribute('aria-busy', String(voice.starting))
      b.setAttribute('aria-pressed', String(voice.on))
      b.dataset.tip = voice.starting ? 'Mikrofon wird freigegeben …' : voice.on ? 'Mikrofon ausschalten' : 'Mikrofon einschalten'
      b.setAttribute('aria-label', b.dataset.tip)
      b.innerHTML = icon(voice.on ? 'mic' : 'micOff')
    },
  })
  let destroyed = false
  let state = { mode: 'view' }
  let hostPresent = false
  let tool = 'point'
  let hasFrame = false
  let error = ''
  let signaling
  let pc
  let dc
  // shared clipboard: file channel, item list (previews arrive separately), panel when open
  let files
  let clipItems = []
  const clipPreviews = new Map()
  let clipPanel
  let peerList = new Map()
  let copyReq = 0
  const pendingCopies = new Map()
  let helloTimer
  let statsTimer
  let offered = false
  let blocked = false
  let blockTimer
  let offerId
  // presenter candidates may overtake their offer on the relays
  let early = []
  // the presenter has to let us in first: waiting for that, or turned away
  let admission = false
  let denied = false
  // the room has a PIN: {salt, rounds, nonce} of the latest challenge
  let pinChallenge = null
  let busy = false
  // who we are on the signaling channel: the public half of our signing key – the presenter only
  // takes messages from us signed by it (the offer comes addressed to it); kept for this tab and
  // room, so a reload does not have to be let in again
  const secretKey = viewerKey(`pv-key-${String(room ?? '').slice(0, 12)}`)
  const peerId = hex(schnorr.getPublicKey(secretKey))
  // a call over contacts: the presenter lets its members in by their device
  const callDevice = /^[0-9a-f]{16}$/.test(options.device ?? '') ? { device: options.device } : {}

  const send = (m) => dc?.readyState === 'open' && dc.send(JSON.stringify(m))

  // ------------------------------------------------------------ connection (peer-to-peer)

  async function connect() {
    if (!room || !window.isSecureContext) {
      error = !room ? 'Kein Raum angegeben.' : 'Bitte die Seite über https öffnen.'
      return update('error')
    }
    const { secret, hostKey } = parseRoom(room)
    signaling = await Signaling.open({ secret, hostKey, relays, secretKey, onMessage: onSignal })
    hello()
  }

  // say hello until the presenter offers a connection (also after the share ended)
  // Asks at growing gaps (public relays throttle chatty clients): 3, 5, 8, then every 10 s;
  // the presenter's own announcement brings an immediate hello (see onSignal).
  function hello() {
    clearTimeout(helloTimer)
    let gap = 3000
    const say = () => {
      if (destroyed || dc?.readyState === 'open') return
      signaling?.send({ type: 'hello', from: peerId, name, color, ...callDevice })
      helloTimer = setTimeout(say, gap)
      gap = Math.min(10000, Math.round(gap * 1.6))
    }
    say()
    setTimeout(() => !offered && !destroyed && update(), 6000)
  }

  async function onSignal(m) {
    if (m.type === 'host' && !dc) signaling.send({ type: 'hello', from: peerId, name, color, ...callDevice })
    if (m.to !== peerId) return
    if (m.type === 'waiting') {
      busy = false
      pinChallenge = m.pin ?? null
      if (!admission && !dc) {
        admission = true
        update()
      }
      return
    }
    if (m.type === 'busy') {
      if (!busy && !dc) {
        busy = true
        update()
      }
      return
    }
    if (m.type === 'pin-wrong') {
      pinError(m.locked ? 'Zu viele falsche Versuche – bitte später noch einmal.' : m.left ? `PIN falsch – noch ${m.left} ${m.left === 1 ? 'Versuch' : 'Versuche'}.` : 'PIN falsch.')
      // a fresh challenge comes with the next answer to our hello
      signaling.send({ type: 'hello', from: peerId, name, color, ...callDevice })
      return
    }
    if (m.type === 'denied') {
      denied = true
      admission = false
      clearTimeout(helloTimer)
      return update()
    }
    if (m.type === 'candidate') {
      if (pc?.remoteDescription && m.id === offerId) pc.addIceCandidate(m.candidate).catch(() => {})
      else early.push(m)
      return
    }
    if (m.type !== 'offer') return
    offered = true
    admission = false
    busy = false
    pinChallenge = null
    closePeer()
    offerId = m.id
    // no more hellos while this connection comes about: to the presenter a hello means "my
    // connection is gone" – it would start over every few seconds and never let ICE finish
    clearTimeout(helloTimer)
    // no data channel after a while: direct connections are blocked in this network – say so,
    // and try again (keeps saying so until a connection opens)
    clearTimeout(blockTimer)
    blockTimer = setTimeout(() => {
      if (dc?.readyState === 'open') return
      blocked = true
      lost()
    }, 15000)
    pc = new RTCPeerConnection({ iceServers: Array.isArray(m.ice) ? m.ice : [] })
    // trickle ICE: candidates go out as soon as they are found
    pc.onicecandidate = (e) => e.candidate && signaling.send({ type: 'candidate', from: peerId, to: 'host', candidate: e.candidate.toJSON() })
    // one video track per shared-window slot, stream id "w<slot>"
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      const slot = Number(/^w(\d+)$/.exec(stream.id)?.[1] ?? 0)
      trackSlots.set(e.track.id, slot)
      // play frames as soon as they are decoded – no extra jitter buffering (latency)
      try {
        e.receiver.jitterBufferTarget = 0
      } catch {}
      if ('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0
      wm.setStream(slot, stream)
    }
    pc.ondatachannel = (e) => (e.channel.label === 'pvfile' ? (files = new FileChannel(e.channel)) : channel(e.channel))
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc?.connectionState)) lost()
    }
    try {
      await pc.setRemoteDescription(m.sdp)
      for (const c of early.filter((c) => c.id === offerId)) pc.addIceCandidate(c.candidate).catch(() => {})
      early = []
      await pc.setLocalDescription(await pc.createAnswer())
      signaling.send({ type: 'answer', from: peerId, to: 'host', sdp: pc.localDescription.toJSON() })
    } catch (err) {
      console.warn('peekaview: connection setup failed', err)
      lost()
    }
  }

  function channel(channel) {
    dc = channel
    dc.onopen = () => {
      lastViewport = ''
      reportViewport()
      setTimeout(() => wm.reportSizes(), 500)
      clearTimeout(helloTimer)
      clearTimeout(blockTimer)
      blocked = false
      watchStats()
    }
    dc.onmessage = (e) => {
      try {
        onText(JSON.parse(e.data))
      } catch {}
    }
    dc.onclose = () => lost()
  }

  // the browser asks for a fresh picture after losses (PLI) – forward it over the data channel
  // Every second: keyframe requests (the browser's PLIs), the network for the presenter's
  // congestion control (loss, round trip) and – Alt+Shift+S – the statistics overlay.
  const trackSlots = new Map() // track id -> window slot
  const prevRtp = new Map()
  let hostStats = null
  let statsOn = false
  function watchStats() {
    clearInterval(statsTimer)
    prevRtp.clear()
    statsTimer = setInterval(async () => {
      if (!pc) return
      const stats = await pc.getStats().catch(() => null)
      if (!stats) return
      let rtt = 0
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000
      })
      let lost = 0
      let received = 0
      const lines = []
      stats.forEach((r) => {
        if (r.type !== 'inbound-rtp' || r.kind !== 'video') return
        const p = prevRtp.get(r.id) ?? {}
        if ((r.pliCount ?? 0) > (p.pli ?? 0)) send({ t: 'keyframe' })
        const dl = Math.max(0, (r.packetsLost ?? 0) - (p.lost ?? r.packetsLost ?? 0))
        const dr = Math.max(0, (r.packetsReceived ?? 0) - (p.received ?? r.packetsReceived ?? 0))
        lost += dl
        received += dr
        if (statsOn && r.framesDecoded) {
          const frames = r.framesDecoded - (p.decoded ?? r.framesDecoded)
          const emitted = (r.jitterBufferEmittedCount ?? 0) - (p.jbn ?? 0)
          lines.push({
            slot: trackSlots.get(r.trackIdentifier),
            size: `${r.frameWidth ?? '?'}×${r.frameHeight ?? '?'}`,
            codec: (stats.get(r.codecId)?.mimeType ?? '').replace('video/', ''),
            decoder: r.decoderImplementation ?? '',
            fps: r.framesPerSecond ?? 0,
            kbps: p.bytes != null ? ((r.bytesReceived - p.bytes) * 8) / 1000 : 0,
            decode: frames > 0 ? ((r.totalDecodeTime - p.decode) / frames) * 1000 : 0,
            buffer: emitted > 0 ? (((r.jitterBufferDelay ?? 0) - (p.jb ?? 0)) / emitted) * 1000 : 0,
            loss: dr + dl > 0 ? dl / (dr + dl) : 0,
          })
        }
        prevRtp.set(r.id, { pli: r.pliCount ?? 0, lost: r.packetsLost ?? 0, received: r.packetsReceived ?? 0, bytes: r.bytesReceived, decoded: r.framesDecoded ?? 0, decode: r.totalDecodeTime ?? 0, jb: r.jitterBufferDelay ?? 0, jbn: r.jitterBufferEmittedCount ?? 0 })
      })
      const loss = received + lost > 0 ? lost / (received + lost) : 0
      if (received + lost > 0 || rtt) send({ t: 'net', loss, rtt })
      if (statsOn) renderStats(lines, rtt, loss)
    }, 1000)
  }

  function renderStats(lines, rtt, loss) {
    const box = q('.pv-stats')
    const name = (slot) => {
      const info = wm.wins.get(slot)?.info ?? {}
      return (info.kind === 'window' ? info.app || info.title : info.title) || `Fenster ${slot + 1}`
    }
    const out = [`<b>Netz</b>   RTT ${Math.round(rtt)} ms · Verlust ${(loss * 100).toFixed(1)} % · Bitrate-Anteil ${Math.round((hostStats?.rate ?? 1) * 100)} %`]
    for (const l of lines.filter((l) => l.slot != null).sort((a, b) => a.slot - b.slot)) {
      const h = hostStats?.streams?.find((s) => s.w === l.slot)
      out.push(`<b>${name(l.slot).replace(/[<&]/g, '')}</b>`)
      out.push(`  hier  ${l.codec ? `${l.codec} · ` : ''}${l.size} · ${Math.round(l.fps)} fps · ${Math.round(l.kbps)} kbit/s · Decode ${l.decode.toFixed(1)} ms · Puffer ${Math.round(l.buffer)} ms`)
      if (h) out.push(`  Host  ${h.width}×${h.height} · ${h.fps.toFixed(0)} fps · ${h.kbps} kbit/s · Encoder ${h.enc_ms.toFixed(1)} ms · Ziel ${(h.bitrate / 1e6).toFixed(1)} Mbit/s${h.want_w ? ` · auf ${h.want_w} px reduziert` : ''}${h.idle ? ' · pausiert' : ''}`)
    }
    box.innerHTML = out.join('\n')
  }

  function toggleStats() {
    statsOn = !statsOn
    q('.pv-stats').hidden = !statsOn
    if (statsOn) q('.pv-stats').textContent = 'Statistik wird gesammelt …'
  }
  // Alt+Shift+S, also while controlling (not passed on to the presenter)
  el.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault()
        e.stopPropagation()
        toggleStats()
      }
    },
    true,
  )
  const onGlobalKey = (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyS' && !el.contains(e.target)) toggleStats()
  }
  window.addEventListener('keydown', onGlobalKey)

  function closePeer() {
    clearInterval(statsTimer)
    dc?.close()
    pc?.close()
    dc = undefined
    pc = undefined
    files = undefined
  }

  // connection gone (share ended, network): back to waiting for the next share
  function lost() {
    if (destroyed || !pc) return
    closePeer()
    me = undefined
    hostPresent = false
    offered = false
    state = { mode: 'view' }
    voice.setEnabled(false)
    resetVideo()
    wm.setWindows([])
    clipItems = []
    clipPanel?.setItems([])
    update()
    hello()
  }

  function onText(m) {
    switch (m.t) {
      case 'welcome':
        me = m
        voice.setSelf(m.id, m.ice)
        break
      case 'rtc':
        voice.handle(m)
        return
      case 'state':
        // when remote control is granted, switch straight to the control tool
        if (m.mode === 'control' && state.mode !== 'control') setTool('control')
        state = m
        voice.setEnabled(voiceEnabled && state.voice_enabled === true)
        // "Resize/Anordnen erlauben": the windows where they are on the presenter's screen
        wm.setWindows(m.windows ?? [], { control: m.mode === 'control', mirror: m.mode === 'control' && m.resize === true, screens: m.screens ?? [] })
        stopBlockedAnnotations()
        renderTasks()
        wm.handle(m)
        break
      case 'peers':
        hostPresent = m.list.some((p) => p.host)
        peerList = new Map(m.list.map((p) => [p.id, p]))
        clipPanel?.render()
        renderPeers(m.list)
        voice.setPeers(m.list)
        onPeers?.(m.list)
        wm.handle(m)
        break
      case 'end':
        lost()
        return
      case 'clip':
        clipItems = m.items ?? []
        for (const it of clipItems) if (clipPreviews.has(it.id)) it.preview = clipPreviews.get(it.id)
        clipPanel?.setItems(clipItems)
        break
      case 'clip-preview':
        clipPreviews.set(m.id, m.preview)
        clipPanel?.setPreview(m.id, m.preview)
        return
      case 'clip-progress':
        clipPanel?.received(m.id, m.received)
        return
      case 'copied':
        pendingCopies.get(m.req)?.(m)
        pendingCopies.delete(m.req)
        return
      case 'host-stats':
        hostStats = m
        return
      case 'launch-error':
        toast(`Start nicht möglich: ${m.error}`)
        return
      case 'control-error':
        toast(m.error || 'Die Eingabe ist fehlgeschlagen.')
        return
      case 'unlocked':
        unlockError(m.ok ? '' : m.error || 'Entsperren fehlgeschlagen.')
        return
      case 'blocked':
        toast(
          m.why === 'permission'
            ? 'Die teilende Person muss das Steuern noch erlauben (macOS: „Bedienungshilfen“) – sie wurde gerade darum gebeten.'
            : m.why === 'focus'
              ? 'Zum Tippen zuerst in das geteilte Fenster klicken.'
              : 'Diese Stelle ist bei der teilenden Person verdeckt – der Klick kommt dort nicht an.',
        )
        return
      default:
        wm.handle(m)
    }
    update()
  }

  // ------------------------------------------------------------ PIN (instead of waiting for approval)
  // PBKDF2 of the PIN as key, HMAC of the host's one-time challenge as answer: the PIN never travels

  const pinForm = q('.pv-pin')
  function pinError(text) {
    const e = pinForm.querySelector('.pv-pin-error')
    e.textContent = text ?? ''
    e.hidden = !text
    pinForm.querySelector('button').disabled = false
  }
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = pinForm.querySelector('input')
    const pin = input.value.trim()
    if (!pin || !pinChallenge) return
    pinForm.querySelector('button').disabled = true
    pinError()
    try {
      const enc = new TextEncoder()
      const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
      const salt = Uint8Array.from(atob(pinChallenge.salt), (c) => c.charCodeAt(0))
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: pinChallenge.rounds }, material, 256)
      const key = await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(pinChallenge.nonce)))
      signaling.send({ type: 'pin', from: peerId, to: 'host', response: Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('') })
      input.value = ''
      setTimeout(() => (pinForm.querySelector('button').disabled = false), 1500)
    } catch {
      pinError('Das hat nicht geklappt.')
    }
  })

  // ------------------------------------------------------------ lock screen (remote access)
  // the password goes over the encrypted data channel and is typed into the presenter's lock screen

  const unlockForm = q('.pv-unlock')
  function unlockError(text) {
    const e = unlockForm.querySelector('.pv-pin-error')
    e.textContent = text ?? ''
    e.hidden = !text
    unlockForm.querySelector('button').disabled = false
  }
  unlockForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const input = unlockForm.querySelector('input')
    if (!input.value || !dc || dc.readyState !== 'open') return
    unlockForm.querySelector('button').disabled = true
    unlockError()
    send({ t: 'unlock', password: input.value })
    input.value = ''
  })

  // ------------------------------------------------------------ video

  function resetVideo() {
    hasFrame = false
  }

  // the presenter can size a shared window to the room we have (sharp, unscaled picture)
  let viewportTimer
  let lastViewport = ''
  function reportViewport() {
    clearTimeout(viewportTimer)
    viewportTimer = setTimeout(() => {
      const v = wm.viewport()
      const key = `${v.w}x${v.h}`
      if (key !== lastViewport && dc?.readyState === 'open') {
        lastViewport = key
        send({ t: 'viewport', ...v })
      }
    }, 400)
  }
  const stageObserver = new ResizeObserver(reportViewport)
  stageObserver.observe(stage)

  function renderTasks() {
    const wins = wm.list
    const many = wins.length > 1
    // remote access: applications the viewer may start (not running in the share yet)
    const shared = new Set(wins.map((w) => (w.info.kind === 'window' ? w.info.app : '')))
    const launchers = state.mode === 'control' ? (state.apps ?? []).filter((a) => a.kind === 'desktop' ? a.id.startsWith('screen:') || !wins.some((w) => w.info.kind === 'screen') : !shared.has(a.name)) : []
    q('.pv-tasks').hidden = !many && !launchers.length
    q('[data-tile]').hidden = !many
    q('.pv-tasks-sep').hidden = !many && !launchers.length
    q('.pv-tasks').replaceChildren(
      ...launchers.map((a) => {
        const b = document.createElement('button')
        b.className = 'pv-task launch'
        b.innerHTML = `${icon(a.kind === 'desktop' ? 'screen' : 'share', 15)}<span></span>`
        b.querySelector('span').textContent = a.name
        b.dataset.tip = a.kind === 'desktop' ? 'Gesamten Desktop teilen' : `„${a.name}“ starten und teilen`
        b.addEventListener('click', () => {
          send({ t: 'launch', app: a.id })
          toast(a.kind === 'desktop' ? 'Desktop wird geteilt …' : `„${a.name}“ wird gestartet …`)
        })
        return b
      }),
      ...(many ? wins : []).map((win) => {
        const b = document.createElement('button')
        b.className = 'pv-task'
        b.classList.toggle('active', wm.active === win.slot && !win.min)
        b.classList.toggle('min', win.min)
        const name = win.info.kind === 'window' ? win.info.app || win.info.title : win.info.title
        b.innerHTML = '<i></i><span></span>'
        b.querySelector('i').textContent = (name || '?').slice(0, 1).toUpperCase()
        b.querySelector('i').style.background = win.el.querySelector('.pv-win-app').style.background
        b.querySelector('span').textContent = name || 'Fenster'
        b.dataset.tip = win.info.kind === 'window' ? `${win.info.app} – ${win.info.title}` : win.info.title
        b.addEventListener('click', () => {
          wm.toggle(win.slot)
          renderTasks()
        })
        return b
      }),
    )
    if (!hasFrame && wm.hasFrame) {
      hasFrame = true
      update()
    }
  }
  // in a background tab nothing needs to be encoded for us
  const onVisibility = () => wm.reportSizes()
  document.addEventListener('visibilitychange', onVisibility)

  q('[data-tile]').addEventListener('click', () => {
    wm.tile()
    wm.tileThere()
  })

  // ------------------------------------------------------------ ui

  let lastStatus
  function update(forced) {
    const status =
      forced ??
      (denied
        ? 'denied'
        : blocked && !me
          ? 'blocked'
          : !me
            ? offered
              ? 'connecting'
              : admission
                ? 'admission'
                : busy
                  ? 'busy'
                  : 'waiting'
            : !hostPresent
              ? 'waiting'
              : state.locked
                ? 'locked'
              : state.remote && !(state.windows ?? []).length
                ? 'pick'
                : state.paused
                ? 'paused'
                : hasFrame
                  ? 'live'
                  : 'loading')
    const texts = {
      connecting: 'Verbinde direkt mit der Freigabe …',
      blocked: 'Die Verbindung kommt gerade nicht zustande – PeekaView versucht es weiter … Teilt jemand von einem Mac, muss PeekaView dort das lokale Netzwerk nutzen dürfen (Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk).',
      error,
      waiting: 'Noch keine Bildschirmfreigabe aktiv.',
      admission: 'Warte, bis die teilende Person dich hereinlässt …',
      busy: 'Gerade nicht verfügbar – auf diesem Computer läuft schon eine andere Freigabe.',
      pick: 'Fernzugriff: Starte oben in der Leiste ein Programm oder den ganzen Desktop.',
      denied: 'Die teilende Person hat den Beitritt abgelehnt.',
      loading: 'Warte auf Bild …',
      paused: 'Freigabe pausiert – das geteilte Fenster ist gerade nicht sichtbar.',
      locked: state.remote && state.mode === 'control'
        ? 'Der Bildschirm der teilenden Person ist gesperrt.'
        : 'Der Bildschirm der teilenden Person ist gesperrt – warte, bis sie ihn entsperrt.',
      live: '',
    }
    const notice = typeof RTCPeerConnection === 'undefined'
      ? 'Dieser Browser unterstützt kein WebRTC. Bitte aktuellen Chrome, Edge, Safari oder Firefox verwenden.'
      : texts[status]
    q('.pv-notice-text').textContent = notice
    q('.pv-notice').hidden = !notice
    q('.pv-pin').hidden = status !== 'admission' || !pinChallenge
    const unlocking = status === 'locked' && state.remote && state.mode === 'control'
    if (unlockForm.hidden && unlocking) setTimeout(() => unlockForm.querySelector('input').focus({ preventScroll: true }))
    unlockForm.hidden = !unlocking
    q('.pv-spinner').hidden = !['connecting', 'waiting', 'loading', 'admission'].includes(status)

    q('.pv-live').hidden = !hostPresent
    q('.pv-status').hidden = !toolbar || !hostPresent
    q('.pv-title').textContent = q('.pv-live').title = state.title || 'Bildschirmfreigabe'
    const mode = q('.pv-mode')
    mode.hidden = !hostPresent
    mode.dataset.mode = state.mode
    mode.innerHTML = icon(MODE_ICONS[state.mode] ?? 'view', 15)
    mode.title = MODES[state.mode] ?? ''
    mode.setAttribute('aria-label', mode.title)
    const allowed = hostPresent ? TOOLS[state.mode] ?? [] : []
    q('.pv-rec').hidden = !hostPresent || !state.recording
    q('.pv-paused').hidden = !hostPresent || state.mode !== 'control' || state.reachable !== false || !(state.windows ?? []).length
    q('.pv-dock').hidden = !toolbar || (!allowed.length && !me)
    for (const b of el.querySelectorAll('.pv-dock [data-tool]')) b.hidden = !allowed.includes(b.dataset.tool)
    q('[data-clear]').hidden = !allowed.length
    q('.pv-tools-sep').hidden = !allowed.length || !me
    q('[data-voice]').hidden = !voiceEnabled || state.voice_enabled !== true || !me
    const clipButton = q('[data-clip]')
    clipButton.hidden = !me || !hostPresent
    if (clipItems.length) clipButton.dataset.count = String(clipItems.length)
    else delete clipButton.dataset.count
    clipButton.classList.toggle('open', !!clipPanel)
    if (clipPanel && (!me || !hostPresent)) closeClip()
    // (the state can arrive before the participant list says the presenter is there)
    if (hostPresent && !allowed.includes(tool) && tool !== 'point') setTool('point')

    if (status !== lastStatus) {
      lastStatus = status
      onStatus?.(status)
    }
  }

  let toastTimer
  function toast(text) {
    const t = q('.pv-toast')
    t.querySelector('span').textContent = text
    t.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (t.hidden = true), 3500)
  }

  function setTool(t) {
    tool = t
    el.dataset.tool = t
    for (const b of el.querySelectorAll('.pv-dock [data-tool]')) b.classList.toggle('active', b.dataset.tool === t)
    if (t === 'control') keys.focus({ preventScroll: true })
    else keys.blur()
  }

  function clear() {
    if (!me) return
    send({ t: 'clear' })
    wm.clearOwn(me.id)
  }

  /** Light enough that white initials would vanish (the presenter is white by default). */
  function light(color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(color ?? '')
    if (!m) return false
    const n = parseInt(m[1], 16)
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170
  }

  function renderPeers(list) {
    q('.pv-peers').replaceChildren(
      ...list.map((p) => {
        const li = document.createElement('li')
        li.style.background = p.color
        if (light(p.color)) li.style.color = '#18181b'
        li.textContent = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
        li.title = `${p.name}${p.host ? ' – teilt' : ''}${p.id === me?.id ? ' (du)' : ''}`
        li.classList.toggle('me', p.id === me?.id)
        li.classList.toggle('voice', !!p.voice)
        return li
      }),
    )
  }

  for (const b of el.querySelectorAll('.pv-dock [data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool))
  q('[data-clear]').addEventListener('click', clear)
  q('[data-fixed-rooms]').addEventListener('click', () => options.onRooms?.())
  q('[data-voice]').addEventListener('click', () => {
    if (!voiceEnabled || state.voice_enabled !== true || !me) return
    if (voice.on) voice.stop()
    else voice.start().catch(() => toast('Kein Zugriff auf das Mikrofon. Bitte im Browser erlauben.'))
  })

  // ------------------------------------------------------------ shared clipboard

  function clipNotice(err) {
    clipPanel?.toast(String(err?.message ?? err), { error: true })
  }

  function share(list) {
    if (!files) return clipNotice('Noch nicht verbunden.')
    for (const file of list) {
      if (file.size > MAX_SIZE) {
        clipNotice(`„${file.name}“ ist größer als 100 MB.`)
        continue
      }
      const id = newId()
      clipPanel?.progress(id, 0, 'up')
      files
        .upload(file, { id, onProgress: (f) => clipPanel?.progress(id, f, 'up') })
        .then(() => clipPanel?.progress(id, null))
        .catch((err) => {
          clipPanel?.progress(id, null)
          clipNotice(err)
        })
    }
  }

  const download = (item) => files.download(item, (f) => clipPanel?.progress(item.id, f, 'down')).finally(() => clipPanel?.progress(item.id, null))

  function openClip() {
    if (clipPanel) return clipPanel.focus()
    clipPanel = new ClipPanel(el, {
      peer: (id) => peerList.get(id) ?? {},
      mine: (item) => item.from === me?.id,
      canCopy: browserCopyable,
      onClose: closeClip,
      actions: {
        add: share,
        addFromPaste: (data) => share(filesFromClipboard(data)),
        paste: () =>
          readSystemClipboard()
            .then((list) => (list.length ? share(list) : clipNotice('Die Zwischenablage ist leer.')))
            .catch(() => clipNotice(`Bitte im Panel ${isMac ? '⌘V' : 'Strg+V'} drücken.`)),
        copy: (item) => {
          if (!files) return
          // the clipboard write starts right in the click (Safari), the content follows
          const blob = download(item).then((b) => (item.mime.startsWith('image/') ? asPng(b) : new Blob([b], { type: 'text/plain' })))
          navigator.clipboard
            .write([new ClipboardItem({ [item.mime.startsWith('image/') ? 'image/png' : 'text/plain']: blob })])
            .then(() => clipPanel?.toast('In die Zwischenablage kopiert'))
            .catch(() => clipNotice('Kopieren nicht möglich – bitte speichern.'))
        },
        save: (item) => files && download(item).then((b) => saveBlob(b, item.name)).catch(clipNotice),
        remove: (item) => send({ t: 'clip-del', id: item.id }),
      },
    })
    clipPanel.setItems(clipItems)
    clipPanel.focus()
    update()
  }

  function closeClip() {
    clipPanel?.destroy()
    clipPanel = undefined
    update()
  }

  q('[data-clip]').addEventListener('click', () => (clipPanel ? closeClip() : openClip()))

  // remote copy: the presenter presses its own copy shortcut, the result lands on our clipboard
  function remoteCopy(cut) {
    const req = ++copyReq
    const reply = new Promise((resolve) => {
      pendingCopies.set(req, resolve)
      setTimeout(() => {
        pendingCopies.delete(req)
        resolve({ empty: true, timeout: true })
      }, 5000)
    })
    send({ t: 'copy', req, cut, w: wm.active })
    const text = reply.then(async (r) => {
      if (r.text != null) return r.text
      if (r.textItem && files) return (await files.download({ id: r.textItem, size: 0, mime: 'text/plain' })).text()
      throw new Error('kein Text')
    })
    if (typeof ClipboardItem === 'function') {
      // started inside the key press, so every browser lets us write once the content arrives
      const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
      navigator.clipboard
        .write([
          new ClipboardItem({
            'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })),
            'text/html': Promise.all([text, reply]).then(([t, r]) => new Blob([r.html ?? `<pre>${escape(t)}</pre>`], { type: 'text/html' })),
          }),
        ])
        .catch(() => {})
    }
    reply.then(async (r) => {
      if (r.image && files) {
        try {
          const blob = await files.download({ id: r.image, size: 0, mime: 'image/png' })
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          toast('Bild in die Zwischenablage kopiert.')
        } catch {
          toast('Das Bild konnte nicht in die Zwischenablage gelegt werden.')
        }
      } else if (r.files?.length) {
        toast(r.files.length === 1 ? `„${r.files[0].name}“ liegt in der gemeinsamen Zwischenablage.` : `${r.files.length} Dateien liegen in der gemeinsamen Zwischenablage.`)
        openClip()
      } else if (r.timeout) {
        toast('Kopieren hat nicht geklappt – keine Antwort vom geteilten Computer.')
      }
    })
  }

  // remote paste: our clipboard content goes onto the presenter's clipboard, which pastes natively
  async function remotePaste(data) {
    const text = data?.getData('text/plain') ?? ''
    const html = data?.getData('text/html') ?? ''
    const list = [...(data?.files ?? [])]
    try {
      if (text || html) {
        if (text.length > 60000 && files) {
          const id = await files.upload(new File([text], 'Text.txt', { type: 'text/plain' }), { hidden: true })
          return send({ t: 'paste', textItem: id, w: wm.active })
        }
        return send({ t: 'paste', text, html: html && html.length <= 60000 ? html : undefined, w: wm.active })
      }
      if (list.length && files) {
        toast(list.length === 1 ? `„${list[0].name}“ wird übertragen …` : `${list.length} Dateien werden übertragen …`)
        const items = []
        for (const file of list) items.push(await files.upload(file, { hidden: true }))
        send({ t: 'paste', items, w: wm.active })
      }
    } catch (err) {
      toast(String(err?.message ?? err))
    }
  }

  // ------------------------------------------------------------ toolbar: fixed at the viewer's top edge

  const dock = q('.pv-dock')
  const DOCK_KEY = 'pv-dock'
  function foldDock(collapsed) {
    dock.classList.toggle('collapsed', collapsed)
    const b = q('.pv-fold')
    b.innerHTML = icon(collapsed ? 'expand' : 'collapse', 16)
    b.dataset.tip = collapsed ? 'Ausklappen' : 'Einklappen'
  }
  try { foldDock(!!JSON.parse(localStorage.getItem(DOCK_KEY))?.collapsed) } catch {}
  q('.pv-fold').addEventListener('click', () => {
    const collapsed = !dock.classList.contains('collapsed')
    foldDock(collapsed)
    try { localStorage.setItem(DOCK_KEY, JSON.stringify({ collapsed })) } catch {}
  })
  const dockObserver = new ResizeObserver(scheduleDock)
  dockObserver.observe(el)
  dockObserver.observe(dock)

  function positionDock() {
    if (destroyed) return
    const viewer = el.getBoundingClientRect()
    const bottom = dock.hidden ? 0 : dock.getBoundingClientRect().bottom - viewer.top
    el.style.setProperty('--pv-toolbar-bottom', `${bottom}px`)
    const space = bottom ? Math.ceil(bottom + 12) : 0
    if (space !== toolbarSpace) {
      toolbarSpace = space
      wm.layout()
      reportViewport()
    }
  }

  // ------------------------------------------------------------ pointer

  const active = () => me && hostPresent && (TOOLS[state.mode] ?? []).includes(tool)
  // the window a press started in keeps the gesture (drawing, dragging) until release
  let down = null
  let hover = null
  let lastMove = 0

  function stopBlockedAnnotations() {
    if (tool === 'control') return
    for (const win of new Set([down, hover])) if (win && !wm.canAnnotate(win)) send({ t: 'hide', w: win.slot })
    if (down && !wm.canAnnotate(down)) down = null
    if (hover && !wm.canAnnotate(hover)) hover = null
  }

  stage.addEventListener('pointerdown', (e) => {
    const win = wm.at(e)
    if (!win || !active() || (tool !== 'control' && !wm.canAnnotate(win))) return
    e.preventDefault()
    e.target.setPointerCapture?.(e.pointerId)
    down = win
    const p = { ...wm.pos(win, e), w: win.slot }
    if (tool === 'point') {
      send({ t: 'ping', ...p })
      win.ann.ping(me.id, p.x, p.y)
    } else if (tool === 'draw') {
      send({ t: 'draw', s: 'start', ...p })
      win.ann.draw(me.id, 'start', p.x, p.y)
    } else {
      keys.focus({ preventScroll: true })
      send({ t: 'mouse', a: 'down', b: e.button === 2 ? 2 : 0, ...p })
    }
  })

  stage.addEventListener('pointermove', (e) => {
    if (!active()) return
    stopBlockedAnnotations()
    const target = down ?? wm.at(e)
    const win = target && (tool === 'control' || wm.canAnnotate(target)) ? target : null
    // left a window: its cursor disappears there
    if (!down && hover && hover !== win) send({ t: 'hide', w: hover.slot })
    hover = down ? hover : win
    if (!win) return
    const now = performance.now()
    if (now - lastMove < (tool === 'draw' && down ? 16 : 33)) return
    lastMove = now
    const p = { ...wm.pos(win, e), w: win.slot }
    if (tool === 'draw' && down) {
      send({ t: 'draw', s: 'move', ...p })
      win.ann.draw(me.id, 'move', p.x, p.y)
    } else {
      send({ t: 'ptr', ...p })
    }
  })

  const release = (e) => {
    const win = down
    if (!win) return
    down = null
    if (!active() || (tool !== 'control' && !wm.canAnnotate(win))) return
    const p = { ...wm.pos(win, e), w: win.slot }
    if (tool === 'draw') {
      send({ t: 'draw', s: 'end', ...p })
      win.ann.draw(me.id, 'end', p.x, p.y)
    } else if (tool === 'control') {
      send({ t: 'mouse', a: 'up', ...p })
    }
  }
  stage.addEventListener('pointerup', release)
  stage.addEventListener('pointercancel', release)
  stage.addEventListener('contextmenu', (e) => active() && wm.at(e) && e.preventDefault())

  let wheelX = 0
  let wheelY = 0
  stage.addEventListener(
    'wheel',
    (e) => {
      const win = wm.at(e)
      if (!win || !active() || tool !== 'control') return
      e.preventDefault()
      const f = e.deltaMode === 1 ? 40 : 1
      wheelX += e.deltaX * f
      wheelY += e.deltaY * f
      const dx = Math.trunc(wheelX / 50)
      const dy = Math.trunc(wheelY / 50)
      if (!dx && !dy) return
      wheelX -= dx * 50
      wheelY -= dy * 50
      send({ t: 'wheel', dx, dy, ...wm.pos(win, e), w: win.slot })
    },
    { passive: false },
  )

  // ------------------------------------------------------------ keyboard (control mode)
  // Printable text arrives via `input` (dead keys, umlauts, IME), special keys and shortcuts
  // via `keydown`. Cmd/Ctrl+V pastes the *viewer's* clipboard as text.

  keys.addEventListener('keydown', (e) => {
    if (tool !== 'control' || e.isComposing || e.key === 'Dead' || e.key === 'Process' || MODIFIERS.includes(e.key)) return
    const cmd = isMac ? e.metaKey : e.ctrlKey
    // each viewer's own shortcuts: ⌘C/⌘X on a Mac, Ctrl+C/Ctrl+X (or Ctrl+Insert / Shift+Delete) elsewhere
    const key = e.key.toLowerCase()
    if ((cmd && (key === 'c' || key === 'x')) || (!isMac && e.ctrlKey && key === 'insert') || (!isMac && e.shiftKey && key === 'delete')) {
      e.preventDefault()
      return remoteCopy(key === 'x' || key === 'delete')
    }
    // ⌘V / Ctrl+V / Shift+Insert: the browser's paste event follows
    if ((cmd && key === 'v') || (!isMac && e.shiftKey && key === 'insert')) return
    if (!cmd && e.key.length === 1) return
    e.preventDefault()
    send({ t: 'key', key: e.key.length === 1 ? e.key.toLowerCase() : e.key, cmd, shift: e.shiftKey, alt: e.altKey, w: wm.active })
  })
  const flushText = () => {
    const s = keys.value
    keys.value = ''
    if (s && tool === 'control') send({ t: 'text', s, w: wm.active })
  }
  keys.addEventListener('input', (e) => !e.isComposing && flushText())
  keys.addEventListener('compositionend', flushText)
  keys.addEventListener('paste', (e) => {
    e.preventDefault()
    if (tool === 'control') remotePaste(e.clipboardData)
  })

  setTool('point')
  update('connecting')
  connect()
  if (window.__PV_STATS__) toggleStats()

  return {
    setTool,
    clear,
    destroy() {
      destroyed = true
      voice.setEnabled(false)
      clearTimeout(helloTimer)
      clearTimeout(blockTimer)
      if (pc) signaling?.send({ type: 'bye', from: peerId })
      closePeer()
      signaling?.close()
      resetVideo()
      stageObserver.disconnect()
      window.removeEventListener('keydown', onGlobalKey)
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(viewportTimer)
      dockObserver.disconnect()
      cancelAnimationFrame(dockFrame)
      clipPanel?.destroy()
      clearTimeout(toastTimer)
      wm.destroy()
      el.replaceChildren()
      el.classList.remove('pv-viewer')
      el.style.removeProperty('--pv-toolbar-bottom')
    },
  }
}
