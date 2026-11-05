// Serves web/ for "Bildschirmfreigabe light" tests and previews, isolated from the outside:
//   - Nostr relays are replaced by a BroadcastChannel between the tabs of one browser – with the
//     same identity rules (presenter messages only from the room key, the presenter only takes
//     "from" = signing key)
//   - getDisplayMedia returns animated canvases: a fake "whole screen" or a fake window on it
//   - no TURN request leaves the page
//   - share.html?browser=firefox: as in Firefox, no Picture-in-Picture window a page can open
//     and no cutting a window out of the screen
//
//   node tests/light-fixture.mjs [port]          – a server for the browser preview
//   node tests/light-fixture.mjs [port] --real   – web/ as it is (real relays and screen), never
//                                                  cached: for trying it out on this computer
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web')

const fakeRelay = `
Signaling.open = async ({ hostKey = null, secretKey, strictFrom = false, onMessage }) => {
  const key = secretKey ?? schnorr.utils.randomSecretKey()
  const pubkey = hex(schnorr.getPublicKey(key))
  const channel = new BroadcastChannel('pv-fake-relay')
  window.qaRelay ??= { sent: [] }
  channel.onmessage = ({ data }) => {
    if (data.pubkey === pubkey) return
    const msg = data.msg
    if (hostKey && msg.from === 'host' && data.pubkey !== hostKey) return
    if (strictFrom && msg.from !== data.pubkey) return
    onMessage(structuredClone(msg))
  }
  return {
    pubkey,
    send(msg) { window.qaRelay.sent.push(msg); channel.postMessage({ pubkey, msg }) },
    close() { channel.close() },
  }
}
`

// What is shared: one call after the other takes the next of window.qaSurfaces ("monitor" when
// none is left). A "monitor" is the size of this screen with a "window" at window.qaWindowAt; a
// "window" is exactly that window's picture – so the window can be found on the screen.
const fakeScreen = `<script>
// ?browser=firefox: no Picture-in-Picture windows for pages (only the user's own on videos)
// (also for the small window it opens: localStorage qaFirefox)
let qaFirefox = false
try { qaFirefox = !!localStorage.getItem('qaFirefox') } catch {}
if (new URLSearchParams(location.search).get('browser') === 'firefox' || qaFirefox) {
  delete window.documentPictureInPicture
  Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', { get: () => false })
  // … and no cutting a window out of the screen (MediaStreamTrackGenerator)
  delete window.MediaStreamTrackGenerator
}
// localStorage qaNoPip: no interactive Picture-in-Picture (as in Firefox, Safari) – for this page
// and the small window it opens
try { if (localStorage.getItem('qaNoPip')) delete window.documentPictureInPicture } catch {}
window.qaSurfaces = []
window.qaWindowAt = { x: 220, y: 140, width: 480, height: 320 }
// black bars above and below the window's picture (px), as Chrome adds when a window's shape changed
window.qaLetterbox = 0
const paintWindow = (ctx, t) => {
  const { width, height } = window.qaWindowAt
  ctx.fillStyle = '#f4f4f5'; ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, width, 34)
  // the title bar's buttons (as on macOS, in colour: the active window)
  for (const [i, c] of ['#ff5f57', '#febc2e', '#28c840'].entries()) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(16 + i * 20, 17, 6, 0, 7); ctx.fill() }
  // … and its title
  ctx.fillStyle = '#fff'; ctx.font = '600 15px system-ui'; ctx.fillText('Projektplan.txt – Editor', 96, 23)
  ctx.fillStyle = '#18181b'; ctx.font = '600 20px system-ui'
  for (let i = 0; i < 7; i++) ctx.fillText('Testzeile ' + (i + 1) + ' – im Fenster', 24, 70 + i * 36)
  ctx.fillStyle = '#16a34a'; ctx.fillRect(width - 120, 60, 90, 90)
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(width / 2 + Math.sin(t / 20) * 120, height - 40, 22, 0, 7); ctx.fill()
}
const paintScreen = (ctx, w, h, t) => {
  ctx.fillStyle = '#334155'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#475569'
  for (let y = 0; y < h; y += 60) for (let x = (y / 60) % 2 * 60; x < w; x += 120) ctx.fillRect(x, y, 60, 60)
  ctx.fillStyle = '#e2e8f0'; ctx.font = '600 28px system-ui'
  ctx.fillText('Schreibtisch', 40, h - 40)
  // window.qaHideWindow: the window is minimized – not to be seen on the screen
  if (window.qaHideWindow) return
  const at = window.qaWindowAt
  ctx.save(); ctx.translate(at.x, at.y); paintWindow(ctx, t); ctx.restore()
}
navigator.mediaDevices.getDisplayMedia = async () => {
  const surface = window.qaSurfaces.shift() ?? 'monitor'
  const canvas = document.createElement('canvas')
  canvas.width = surface === 'monitor' ? screen.width : window.qaWindowAt.width
  const bar = surface === 'monitor' ? 0 : window.qaLetterbox
  canvas.height = surface === 'monitor' ? screen.height : window.qaWindowAt.height + 2 * bar
  const ctx = canvas.getContext('2d')
  let t = 0
  const paint = () => {
    t++
    if (surface === 'monitor') return paintScreen(ctx, canvas.width, canvas.height, t)
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.save(); ctx.translate(0, bar); paintWindow(ctx, t); ctx.restore()
  }
  paint()
  setInterval(paint, 100)
  const stream = canvas.captureStream(30)
  const track = stream.getVideoTracks()[0]
  const settings = track.getSettings.bind(track)
  track.getSettings = () => ({ ...settings(), width: canvas.width, height: canvas.height, displaySurface: surface })
  return stream
}
</script>`

export function startServer(port = 0, { real = false } = {}) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    // (trying it out: which files the browser really fetched)
    if (real) console.log(new Date().toLocaleTimeString('de-DE'), request.method, path)
    // (trying it out: share.html?debug sends what the window picker found here, to read it)
    if (real && request.method === 'POST' && path === '/qa-log') {
      const chunks = []
      for await (const c of request) chunks.push(c)
      console.log('qa-log', Buffer.concat(chunks).toString())
      return response.writeHead(200).end()
    }
    // (trying it out: share.html?debug sends the window picker's picture here, to look at it)
    if (real && request.method === 'POST' && path === '/qa-upload') {
      const chunks = []
      for await (const c of request) chunks.push(c)
      const out = resolve(tmpdir(), `peekaview-auswahl-${Date.now()}.png`)
      await writeFile(out, Buffer.concat(chunks))
      console.log('saved', out)
      return response.writeHead(200).end(out)
    }
    const file = resolve(web, path === '/' ? 'index.html' : '.' + path)
    if (!file.startsWith(web + sep)) return response.writeHead(403).end()
    try {
      let body = await readFile(file)
      if (path === '/signal.js' && !real) body = body.toString() + fakeRelay
      if (path === '/share.html' && !real) body = body.toString().replace('<head>', '<head>' + fakeScreen)
      response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(file)] ?? 'application/octet-stream')
      response.setHeader('Cache-Control', 'no-cache')
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const real = process.argv.includes('--real')
  const server = await startServer(Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 8091), { real })
  console.log(`${real ? 'web/' : 'light fixture'} on http://127.0.0.1:${server.address().port}/share.html`)
}
