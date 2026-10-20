// PeekaView viewer – framework independent. Mount it into any element:
//
//   import { mountViewer } from '@peekaview/viewer'
//   const viewer = mountViewer(el, { room: '<room secret from the link>', name: 'Anna', color: '#e6194b' })
//   viewer.destroy()
//
// Peer-to-peer: the connection to the presenter is set up over public Nostr relays (end-to-end
// encrypted with the room secret), then video (WebRTC H.264, decoded in hardware), pointer, ink,
// remote control and voice flow directly between the participants. No server of our own.

import { Annotations, injectStyle } from './annotate.js'
import { icon } from './icons.js'
import { Voice } from './voice.js'
import { Signaling, parseRoom } from './signal.js'

export { peerColor } from './icons.js'

const MODES = { view: 'Nur ansehen', draw: 'Zeigen & Malen', control: 'Fernsteuerung' }
const MODE_ICONS = { view: 'view', draw: 'draw', control: 'control' }
const TOOLS = { view: [], draw: ['point', 'draw'], control: ['point', 'draw', 'control'] }
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS']
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

const CSS = `
.pv-viewer {
  --pv-accent: #ef4444; --pv-bg: #09090b; --pv-fg: #fafafa; --pv-muted: #a1a1aa;
  --pv-glass: rgba(24, 24, 27, .78); --pv-line: rgba(255, 255, 255, .09);
  position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  background: var(--pv-bg); color: var(--pv-fg);
  font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased; user-select: none;
}
.pv-viewer [hidden] { display: none !important; }
.pv-glass { background: var(--pv-glass); border: 1px solid var(--pv-line); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 8px 28px rgba(0, 0, 0, .35); }
.pv-stage { position: absolute; inset: 0; display: grid; place-items: center; }
.pv-view { position: relative; touch-action: none; }
.pv-view[data-tool="draw"] { cursor: crosshair; }
.pv-screen, .pv-ann { position: absolute; inset: 0; width: 100%; height: 100%; }
.pv-screen { object-fit: fill; background: #000; pointer-events: none; }
.pv-top { position: absolute; top: 12px; left: 12px; right: 140px; display: flex; gap: 8px; pointer-events: none; }
.pv-chip { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: 999px; min-width: 0; }
.pv-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--pv-accent); box-shadow: 0 0 0 3px rgba(239, 68, 68, .25); animation: pv-pulse 2s ease-in-out infinite; }
.pv-mode { color: var(--pv-muted); }
.pv-mode[data-mode="draw"] { color: #fde68a; }
.pv-mode[data-mode="control"] { color: #fca5a5; }
.pv-peers { position: absolute; top: 12px; right: 12px; display: flex; margin: 0; padding: 0 0 0 6px; list-style: none; }
.pv-peers li { width: 30px; height: 30px; margin-left: -6px; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--pv-bg); color: #fff; font-size: 11px; font-weight: 650; letter-spacing: .02em; text-shadow: 0 1px 1px rgba(0,0,0,.3); }
.pv-peers li.me { border-color: var(--pv-fg); }
.pv-peers li.voice { box-shadow: 0 0 0 2px #22c55e; }
.pv-rec { color: #fca5a5; }
.pv-paused { color: #fde68a; }
.pv-dock button.live { background: #16a34a; color: #fff; }
.pv-dock { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 14px; }
.pv-dock.placed { transform: none; bottom: auto; }
.pv-dock.collapsed > :not(.pv-grip):not(.pv-fold) { display: none !important; }
.pv-dock .pv-grip { width: 18px; margin-right: -2px; color: var(--pv-muted); cursor: grab; touch-action: none; }
.pv-dock .pv-grip:active { cursor: grabbing; }
.pv-dock .pv-grip:hover:not(:disabled) { background: transparent; color: var(--pv-fg); }
.pv-dock .pv-fold { width: 26px; color: var(--pv-muted); }
.pv-dock .pv-fold:hover:not(:disabled) { color: var(--pv-fg); }
.pv-dock.dragging button::after { display: none; }
.pv-toast { position: absolute; top: 54px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 24px); color: #fde68a; pointer-events: none; animation: pv-in .2s ease-out; }
@keyframes pv-in { from { opacity: 0; transform: translate(-50%, -4px); } }
.pv-dock button { position: relative; width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 10px; background: transparent; color: var(--pv-fg); cursor: pointer; transition: background .15s, color .15s, opacity .15s; }
.pv-dock button:hover:not(:disabled) { background: rgba(255, 255, 255, .09); }
.pv-dock button.active { background: var(--pv-fg); color: var(--pv-bg); }
.pv-dock button:disabled { opacity: .28; cursor: default; }
.pv-dock button::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translate(-50%, 4px); padding: 5px 9px; border-radius: 8px; background: #18181b; border: 1px solid var(--pv-line); white-space: nowrap; font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .12s, transform .12s; }
.pv-dock button:hover::after { opacity: 1; transform: translate(-50%, 0); }
.pv-sep { width: 1px; height: 22px; margin: 0 3px; background: var(--pv-line); }
.pv-notice { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 10px; max-width: min(420px, 80%); padding: 11px 16px; border-radius: 12px; color: var(--pv-fg); }
.pv-spinner { flex: none; width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, .2); border-top-color: var(--pv-fg); border-radius: 50%; animation: pv-spin .8s linear infinite; }
.pv-keys { position: absolute; left: -1000px; top: 0; width: 10px; height: 10px; opacity: 0; }
@keyframes pv-spin { to { transform: rotate(360deg); } }
@keyframes pv-pulse { 50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, .12); } }
`

/**
 * @param {HTMLElement} el
 * @param {{room: string, name: string, color?: string, relays?: string[], toolbar?: boolean, voice?: boolean,
 *          peers?: boolean, onStatus?: (status: string) => void, onPeers?: (list: any[]) => void}} options
 */
export function mountViewer(el, options) {
  const { room, name, color, relays, toolbar = true, peers = true, voice: voiceEnabled = true, onStatus, onPeers } = options
  injectStyle('pv-viewer-style', CSS)

  el.classList.add('pv-viewer')
  el.innerHTML = `
    <div class="pv-stage">
      <div class="pv-view"><video class="pv-screen" autoplay playsinline muted></video><div class="pv-ann"></div></div>
      <div class="pv-notice pv-glass"><span class="pv-spinner"></span><span class="pv-notice-text"></span></div>
    </div>
    <div class="pv-top">
      <div class="pv-chip pv-glass pv-live"><i class="pv-dot"></i><span class="pv-title"></span></div>
      <div class="pv-chip pv-glass pv-mode"></div>
      <div class="pv-chip pv-glass pv-rec" hidden><i class="pv-dot"></i><span>Wird aufgezeichnet</span></div>
      <div class="pv-chip pv-glass pv-paused" hidden>${icon('control', 15)}<span>Steuerung pausiert – Fenster ist beim Host verdeckt</span></div>
    </div>
    <div class="pv-chip pv-glass pv-toast" hidden>${icon('control', 15)}<span></span></div>
    <ul class="pv-peers"></ul>
    <div class="pv-dock pv-glass">
      <button class="pv-grip" data-tip="Verschieben">${icon('grip', 16)}</button>
      <button data-tool="point" data-tip="Zeigen">${icon('point')}</button>
      <button data-tool="draw" data-tip="Malen">${icon('draw')}</button>
      <button data-tool="control" data-tip="Steuern">${icon('control')}</button>
      <button data-clear data-tip="Meine Zeichnungen löschen">${icon('erase')}</button>
      <span class="pv-sep pv-tools-sep"></span>
      <button data-voice data-tip="Sprechen">${icon('micOff')}</button>
      <button class="pv-fold" data-tip="Einklappen">${icon('collapse', 16)}</button>
    </div>
    <textarea class="pv-keys" aria-hidden="true" tabindex="-1" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>`
  const q = (s) => el.querySelector(s)
  const stage = q('.pv-stage')
  const view = q('.pv-view')
  const screen = q('.pv-screen')
  const keys = q('.pv-keys')
  const ann = new Annotations(q('.pv-ann'), { voice: voiceEnabled })
  q('.pv-top').hidden = !toolbar
  q('.pv-dock').hidden = !toolbar
  q('.pv-peers').hidden = !peers

  let me
  const voice = new Voice({
    send: (m) => send(m),
    onChange: () => {
      const b = q('[data-voice]')
      b.classList.toggle('live', voice.on)
      b.dataset.tip = voice.on ? 'Mikrofon aus' : 'Sprechen'
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
  let helloTimer
  let statsTimer
  let lastPli = 0
  let offered = false
  let blocked = false
  let blockTimer
  let offerId
  // presenter candidates may overtake their offer on the relays
  let early = []
  // who we are on the signaling channel (the presenter answers with an offer addressed to it)
  const peerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')

  const send = (m) => dc?.readyState === 'open' && dc.send(JSON.stringify(m))

  // ------------------------------------------------------------ connection (peer-to-peer)

  async function connect() {
    if (!room || !window.isSecureContext) {
      error = !room ? 'Kein Raum angegeben.' : 'Bitte die Seite über https öffnen.'
      return update('error')
    }
    const { secret, hostKey } = parseRoom(room)
    signaling = await Signaling.open({ secret, hostKey, relays, onMessage: onSignal })
    hello()
  }

  // say hello until the presenter offers a connection (also after the share ended)
  function hello() {
    clearInterval(helloTimer)
    const say = () => !destroyed && signaling?.send({ type: 'hello', from: peerId, name, color })
    say()
    helloTimer = setInterval(say, 4000)
    setTimeout(() => !offered && !destroyed && update(), 6000)
  }

  async function onSignal(m) {
    if (m.type === 'host' && !dc) signaling.send({ type: 'hello', from: peerId, name, color })
    if (m.to !== peerId) return
    if (m.type === 'candidate') {
      if (pc?.remoteDescription && m.id === offerId) pc.addIceCandidate(m.candidate).catch(() => {})
      else early.push(m)
      return
    }
    if (m.type !== 'offer') return
    offered = true
    closePeer()
    offerId = m.id
    // no data channel after a while: direct connections are blocked in this network
    clearTimeout(blockTimer)
    blockTimer = setTimeout(() => {
      if (dc?.readyState === 'open') return
      blocked = true
      update()
    }, 15000)
    pc = new RTCPeerConnection({ iceServers: Array.isArray(m.ice) ? m.ice : [] })
    // trickle ICE: candidates go out as soon as they are found
    pc.onicecandidate = (e) => e.candidate && signaling.send({ type: 'candidate', from: peerId, to: 'host', candidate: e.candidate.toJSON() })
    pc.ontrack = (e) => {
      screen.srcObject = e.streams[0] ?? new MediaStream([e.track])
      screen.play().catch(() => {})
    }
    pc.ondatachannel = (e) => channel(e.channel)
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
      clearInterval(helloTimer)
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
  function watchStats() {
    clearInterval(statsTimer)
    statsTimer = setInterval(async () => {
      if (!pc) return
      const stats = await pc.getStats().catch(() => null)
      stats?.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          if ((r.pliCount ?? 0) > lastPli) send({ t: 'keyframe' })
          lastPli = r.pliCount ?? 0
        }
      })
    }, 1000)
  }

  function closePeer() {
    clearInterval(statsTimer)
    dc?.close()
    pc?.close()
    dc = undefined
    pc = undefined
    lastPli = 0
  }

  // connection gone (share ended, network): back to waiting for the next share
  function lost() {
    if (destroyed || !pc) return
    closePeer()
    me = undefined
    hostPresent = false
    offered = false
    state = { mode: 'view' }
    voice.stop()
    resetVideo()
    ann.reset()
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
        ann.handle(m)
        break
      case 'peers':
        hostPresent = m.list.some((p) => p.host)
        renderPeers(m.list)
        voice.setPeers(m.list)
        onPeers?.(m.list)
        ann.handle(m)
        break
      case 'end':
        lost()
        return
      case 'blocked':
        toast(m.why === 'focus' ? 'Zum Tippen zuerst in das geteilte Fenster klicken.' : 'Diese Stelle ist beim Host verdeckt – der Klick kommt dort nicht an.')
        return
      default:
        ann.handle(m)
    }
    update()
  }

  // ------------------------------------------------------------ video

  function resetVideo() {
    hasFrame = false
    screen.srcObject = null
  }

  const firstFrame = () => {
    fit()
    if (!hasFrame) {
      hasFrame = true
      update()
    }
  }
  screen.addEventListener('loadeddata', firstFrame)
  screen.addEventListener('resize', firstFrame)

  // ------------------------------------------------------------ ui

  let lastStatus
  function update(forced) {
    const status =
      forced ?? (blocked && !me ? 'blocked' : !me ? (offered ? 'connecting' : 'waiting') : !hostPresent ? 'waiting' : state.paused ? 'paused' : hasFrame ? 'live' : 'loading')
    const texts = {
      connecting: 'Verbinde direkt mit der Freigabe …',
      blocked: 'Direkte Verbindung nicht möglich – in diesem Netz wird ein TURN-Server benötigt. Bitte die teilende Person, einen in PeekaView einzutragen.',
      error,
      waiting: 'Noch keine Bildschirmfreigabe aktiv.',
      loading: 'Warte auf Bild …',
      paused: 'Freigabe pausiert – das geteilte Fenster ist gerade nicht sichtbar.',
      live: '',
    }
    const notice = typeof RTCPeerConnection === 'undefined'
      ? 'Dieser Browser unterstützt kein WebRTC. Bitte aktuellen Chrome, Edge, Safari oder Firefox verwenden.'
      : texts[status]
    q('.pv-notice-text').textContent = notice
    q('.pv-notice').hidden = !notice
    q('.pv-spinner').hidden = !['connecting', 'waiting', 'loading'].includes(status)

    q('.pv-live').hidden = !hostPresent
    q('.pv-title').textContent = state.title || 'Bildschirmfreigabe'
    const mode = q('.pv-mode')
    mode.hidden = !hostPresent
    mode.dataset.mode = state.mode
    mode.innerHTML = `${icon(MODE_ICONS[state.mode] ?? 'view', 15)}<span></span>`
    mode.querySelector('span').textContent = MODES[state.mode] ?? ''
    const allowed = hostPresent ? TOOLS[state.mode] ?? [] : []
    q('.pv-rec').hidden = !hostPresent || !state.recording
    q('.pv-paused').hidden = !hostPresent || state.mode !== 'control' || state.reachable !== false
    q('.pv-dock').hidden = !toolbar || (!allowed.length && !(voiceEnabled && me))
    for (const b of el.querySelectorAll('.pv-dock [data-tool]')) b.hidden = !allowed.includes(b.dataset.tool)
    q('[data-clear]').hidden = !allowed.length
    q('.pv-tools-sep').hidden = !allowed.length || !voiceEnabled
    q('[data-voice]').hidden = !voiceEnabled || !me
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
    view.dataset.tool = t
    for (const b of el.querySelectorAll('.pv-dock [data-tool]')) b.classList.toggle('active', b.dataset.tool === t)
    if (t === 'control') keys.focus({ preventScroll: true })
    else keys.blur()
  }

  function clear() {
    if (!me) return
    send({ t: 'clear' })
    ann.clear(me.id)
  }

  function renderPeers(list) {
    q('.pv-peers').replaceChildren(
      ...list.map((p) => {
        const li = document.createElement('li')
        li.style.background = p.color
        li.textContent = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
        li.title = `${p.name}${p.host ? ' – teilt' : ''}${p.id === me?.id ? ' (du)' : ''}`
        li.classList.toggle('me', p.id === me?.id)
        li.classList.toggle('voice', !!p.voice)
        return li
      }),
    )
  }

  function fit() {
    const W = screen.videoWidth || 16
    const H = screen.videoHeight || 9
    const r = stage.getBoundingClientRect()
    const s = Math.min(r.width / W, r.height / H)
    view.style.width = `${Math.floor(W * s)}px`
    view.style.height = `${Math.floor(H * s)}px`
  }
  const resizeObserver = new ResizeObserver(fit)
  resizeObserver.observe(stage)

  for (const b of el.querySelectorAll('.pv-dock [data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool))
  q('[data-clear]').addEventListener('click', clear)
  q('[data-voice]').addEventListener('click', () => {
    if (voice.on) voice.stop()
    else voice.start().catch(() => (q('[data-voice]').dataset.tip = 'Kein Zugriff auf das Mikrofon'))
  })

  // ------------------------------------------------------------ dock: drag & collapse
  // Position (as a fraction of the viewer) and collapsed state are remembered per browser.

  const dock = q('.pv-dock')
  const DOCK_KEY = 'pv-dock'
  const loadDock = () => {
    try {
      return JSON.parse(localStorage.getItem(DOCK_KEY)) ?? {}
    } catch {
      return {}
    }
  }
  const saveDock = (patch) => {
    try {
      localStorage.setItem(DOCK_KEY, JSON.stringify({ ...loadDock(), ...patch }))
    } catch {}
  }
  function placeDock(fx, fy) {
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return
    const r = el.getBoundingClientRect()
    const d = dock.getBoundingClientRect()
    dock.classList.add('placed')
    dock.style.left = `${Math.round(Math.min(Math.max(0, r.width - d.width), Math.max(0, fx * r.width)))}px`
    dock.style.top = `${Math.round(Math.min(Math.max(0, r.height - d.height), Math.max(0, fy * r.height)))}px`
  }
  function foldDock(collapsed) {
    dock.classList.toggle('collapsed', collapsed)
    const b = q('.pv-fold')
    b.innerHTML = icon(collapsed ? 'expand' : 'collapse', 16)
    b.dataset.tip = collapsed ? 'Ausklappen' : 'Einklappen'
  }
  {
    const saved = loadDock()
    foldDock(!!saved.collapsed)
    if (saved.x != null) requestAnimationFrame(() => placeDock(saved.x, saved.y))
  }
  q('.pv-fold').addEventListener('click', () => {
    const collapsed = !dock.classList.contains('collapsed')
    foldDock(collapsed)
    saveDock({ collapsed })
  })
  q('.pv-grip').addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const d = dock.getBoundingClientRect()
    const dx = e.clientX - d.left
    const dy = e.clientY - d.top
    dock.classList.add('dragging')
    const move = (ev) => placeDock((ev.clientX - dx - r.left) / r.width, (ev.clientY - dy - r.top) / r.height)
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      dock.classList.remove('dragging')
      const now = el.getBoundingClientRect()
      saveDock({ x: parseFloat(dock.style.left) / now.width, y: parseFloat(dock.style.top) / now.height })
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  })
  // keep a placed dock inside the viewer when it gets smaller
  const dockObserver = new ResizeObserver(() => {
    const saved = loadDock()
    if (dock.classList.contains('placed') && saved.x != null) placeDock(saved.x, saved.y)
  })
  dockObserver.observe(el)

  // ------------------------------------------------------------ pointer

  const pos = (e) => {
    const r = view.getBoundingClientRect()
    const c = (v) => Math.min(1, Math.max(0, v))
    return { x: c((e.clientX - r.left) / r.width), y: c((e.clientY - r.top) / r.height) }
  }
  const active = () => me && hostPresent && (TOOLS[state.mode] ?? []).includes(tool)
  let down = false
  let lastMove = 0

  view.addEventListener('pointerdown', (e) => {
    if (!active()) return
    e.preventDefault()
    view.setPointerCapture(e.pointerId)
    down = true
    const p = pos(e)
    if (tool === 'point') {
      send({ t: 'ping', ...p })
      ann.ping(me.id, p.x, p.y)
    } else if (tool === 'draw') {
      send({ t: 'draw', s: 'start', ...p })
      ann.draw(me.id, 'start', p.x, p.y)
    } else {
      keys.focus({ preventScroll: true })
      send({ t: 'mouse', a: 'down', b: e.button === 2 ? 2 : 0, ...p })
    }
  })

  view.addEventListener('pointermove', (e) => {
    if (!active()) return
    const now = performance.now()
    if (now - lastMove < (tool === 'draw' && down ? 16 : 33)) return
    lastMove = now
    const p = pos(e)
    if (tool === 'draw' && down) {
      send({ t: 'draw', s: 'move', ...p })
      ann.draw(me.id, 'move', p.x, p.y)
    } else {
      send({ t: 'ptr', ...p })
    }
  })

  const release = (e) => {
    if (!down) return
    down = false
    if (!active()) return
    const p = pos(e)
    if (tool === 'draw') {
      send({ t: 'draw', s: 'end', ...p })
      ann.draw(me.id, 'end', p.x, p.y)
    } else if (tool === 'control') {
      send({ t: 'mouse', a: 'up', ...p })
    }
  }
  view.addEventListener('pointerup', release)
  view.addEventListener('pointercancel', release)
  view.addEventListener('contextmenu', (e) => active() && e.preventDefault())

  let wheelX = 0
  let wheelY = 0
  view.addEventListener(
    'wheel',
    (e) => {
      if (!active() || tool !== 'control') return
      e.preventDefault()
      const f = e.deltaMode === 1 ? 40 : 1
      wheelX += e.deltaX * f
      wheelY += e.deltaY * f
      const dx = Math.trunc(wheelX / 50)
      const dy = Math.trunc(wheelY / 50)
      if (!dx && !dy) return
      wheelX -= dx * 50
      wheelY -= dy * 50
      send({ t: 'wheel', dx, dy, ...pos(e) })
    },
    { passive: false },
  )

  // ------------------------------------------------------------ keyboard (control mode)
  // Printable text arrives via `input` (dead keys, umlauts, IME), special keys and shortcuts
  // via `keydown`. Cmd/Ctrl+V pastes the *viewer's* clipboard as text.

  keys.addEventListener('keydown', (e) => {
    if (tool !== 'control' || e.isComposing || e.key === 'Dead' || e.key === 'Process' || MODIFIERS.includes(e.key)) return
    const cmd = isMac ? e.metaKey : e.ctrlKey
    if (cmd && e.key.toLowerCase() === 'v') return
    if (!cmd && e.key.length === 1) return
    e.preventDefault()
    send({ t: 'key', key: e.key.length === 1 ? e.key.toLowerCase() : e.key, cmd, shift: e.shiftKey, alt: e.altKey })
  })
  const flushText = () => {
    const s = keys.value
    keys.value = ''
    if (s && tool === 'control') send({ t: 'text', s })
  }
  keys.addEventListener('input', (e) => !e.isComposing && flushText())
  keys.addEventListener('compositionend', flushText)
  keys.addEventListener('paste', (e) => {
    e.preventDefault()
    const s = e.clipboardData?.getData('text') ?? ''
    if (s && tool === 'control') send({ t: 'text', s: s.slice(0, 10000) })
  })

  setTool('point')
  update('connecting')
  connect()

  return {
    setTool,
    clear,
    destroy() {
      destroyed = true
      voice.stop()
      clearInterval(helloTimer)
      clearTimeout(blockTimer)
      if (pc) signaling?.send({ type: 'bye', from: peerId })
      closePeer()
      signaling?.close()
      resetVideo()
      resizeObserver.disconnect()
      dockObserver.disconnect()
      clearTimeout(toastTimer)
      ann.destroy()
      el.replaceChildren()
      el.classList.remove('pv-viewer')
    },
  }
}
