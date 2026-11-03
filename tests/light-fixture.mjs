// Serves web/ for "Bildschirmfreigabe light" tests and previews, isolated from the outside:
//   - Nostr relays are replaced by a BroadcastChannel between the tabs of one browser – with the
//     same identity rules (presenter messages only from the room key, the presenter only takes
//     "from" = signing key)
//   - getDisplayMedia returns an animated canvas the size of the screen (a fake "whole screen")
//   - no TURN request leaves the page
//
//   node tests/light-fixture.mjs [port]   – a server for the browser preview
import { readFile } from 'node:fs/promises'
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

// a "whole screen": the size of this screen, something moving on it
const fakeScreen = `<script>
navigator.mediaDevices.getDisplayMedia = async () => {
  const canvas = document.createElement('canvas')
  canvas.width = screen.width
  canvas.height = screen.height
  const ctx = canvas.getContext('2d')
  let t = 0
  const paint = () => {
    t++
    ctx.fillStyle = '#f4f4f5'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, canvas.width, 48)
    ctx.fillStyle = '#18181b'; ctx.font = '600 28px system-ui'
    for (let i = 0; i < 12; i++) ctx.fillText('Testzeile ' + (i + 1) + ' – Bildschirmfreigabe light', 80, 120 + i * 60)
    ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(canvas.width / 2 + Math.sin(t / 20) * 200, canvas.height * 0.75, 40, 0, 7); ctx.fill()
  }
  paint()
  setInterval(paint, 100)
  window.qaScreen = canvas.captureStream(30)
  return window.qaScreen
}
</script>`

export function startServer(port = 0) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const file = resolve(web, path === '/' ? 'index.html' : '.' + path)
    if (!file.startsWith(web + sep)) return response.writeHead(403).end()
    try {
      let body = await readFile(file, 'utf8')
      if (path === '/signal.js') body += fakeRelay
      if (path === '/share.html') body = body.replace('<head>', '<head>' + fakeScreen)
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
  const server = await startServer(Number(process.argv[2] ?? 8091))
  console.log(`light fixture on http://127.0.0.1:${server.address().port}/share.html`)
}
