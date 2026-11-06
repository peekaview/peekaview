// "Bildschirmfreigabe light" goes on in PeekaView Desktop: a viewer watching the browser share keeps
// watching – same link, not asked again – once the presenter hands over. The desktop app is played
// by a second light host in another tab with what the app gets from "peekaview://continue?…": the
// room, the presenter key and who was let in (client/src-tauri/src/invite.rs takes the same link;
// its Rust tests check that it gives the same viewer link). Signaling between the tabs instead of
// public relays (see light-fixture.mjs).
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { startServer } from './light-fixture.mjs'

test('a browser share goes on in PeekaView Desktop: viewers switch over by themselves', { timeout: 180000 }, async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const session = 'pv-light-handover-' + process.pid
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (code) => JSON.parse(await browser('eval', code))
  const waitFor = (fn) => browser('wait', '--fn', fn)
  const tab = (id) => browser('tab', id)
  try {
    // the presenter shares from the browser (as in Firefox: everything in this tab)
    await browser('open', base + '/share.html?browser=firefox')
    await browser('set', 'viewport', '1280', '900')
    await browser('wait', '#start')
    await browser('fill', '#name', 'Patrick')
    await evaluate("const open = window.open; window.open = (url, ...rest) => (String(url).includes('panel') ? null : open.call(window, url, ...rest)); true")
    await browser('click', '#start')
    await tab('t1')
    await waitFor("!document.querySelector('#pick').hidden")
    await browser('click', '#pick-screen')
    await waitFor("!document.querySelector('#running').hidden")
    const link = await evaluate("document.querySelector('#link').value")
    const room = link.split('#')[1]

    // a viewer, let in
    await browser('tab', 'new', `${base}/?name=Anna#${room}`)
    await tab('t1')
    await browser('wait', '#requests [data-allow]')
    await browser('click', '#requests [data-allow]')
    await waitFor("document.querySelector('#viewers').innerText.includes('Anna')")
    await tab('t3')
    await waitFor("document.querySelector('video')?.videoWidth > 0")

    // "Steuern" offers to go on in PeekaView Desktop (the app is opened by its link – looked at here)
    await tab('t1')
    await evaluate("window.pvLight.openApp = (url) => (window.qaAppLink = url); true")
    await browser('click', '#running-modes [data-mode=control]')
    assert.match(await evaluate("document.querySelector('#running-mode-note').innerText"), /Steuern lassen geht nur mit PeekaView Desktop/)
    await browser('click', '#running-mode-note [data-continue]')
    const appLink = new URL(await evaluate('window.qaAppLink'))
    assert.equal(appLink.protocol, 'peekaview:')
    assert.equal(appLink.host, 'continue')
    const handed = Object.fromEntries(appLink.searchParams)
    assert.equal(`${handed.room}.`, room.slice(0, room.indexOf('.') + 1), 'the same room')
    assert.match(handed.key, /^[0-9a-f]{64}$/)
    assert.match(handed.admitted, /^[0-9a-f]{64}$/, 'Anna, let in')
    assert.equal(handed.name, 'Patrick')
    assert.equal(handed.mode, 'draw')
    // until the app is live, the browser goes on sharing – and says how to get the app
    assert.match(await evaluate("document.querySelector('#running-mode-note').innerText"), /PeekaView Desktop öffnet sich[\s\S]*Noch kein PeekaView Desktop\?/)
    assert.equal(await evaluate("new URL(document.querySelector('#running-mode-note a').href).pathname"), '/download.html')
    assert.equal(await evaluate("document.querySelector('#running').hidden"), false)

    // "PeekaView Desktop" comes up in the room with that key and those viewers
    await browser('tab', 'new', `${base}/impressum.html`)
    await evaluate(`(async () => {
      const { LightHost } = await import('/light-host.js')
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 360 })
      const ctx = canvas.getContext('2d')
      setInterval(() => { ctx.fillStyle = '#16a34a'; ctx.fillRect(0, 0, 640, 360) }, 50)
      const unhex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16))
      const handed = ${JSON.stringify(handed)}
      window.qaDesktop = new LightHost({ stream: canvas.captureStream(10), name: 'Desktop', turnService: null, room: { secret: handed.room, secretKey: unhex(handed.key), admitted: handed.admitted.split(',') } })
      await window.qaDesktop.start()
    })(); true`)
    assert.equal(await evaluate('window.qaDesktop.link.split("#")[1]'), room, 'the same link')

    // the browser steps down and says where the share went on
    await tab('t1')
    await waitFor("!document.querySelector('#ended').hidden")
    assert.equal(await evaluate("document.querySelector('#ended-title').textContent"), 'Läuft jetzt in PeekaView Desktop')
    assert.match(await evaluate("document.querySelector('#ended-why').textContent"), /Zuschauer sind mitgewechselt – mit demselben Link/)
    assert.equal(await evaluate("document.querySelector('#again').hidden"), true)

    // the viewer is with the app now, without asking to come in again, and watches its picture
    await tab('t4')
    await waitFor("window.qaDesktop.viewerList.some((v) => v.name === 'Anna')")
    assert.equal(await evaluate('window.qaDesktop.requestList.length'), 0, 'nobody asked again')
    await tab('t3')
    await waitFor("document.querySelector('video')?.videoWidth === 640 && document.querySelector('.pv-notice').hidden")
    assert.equal(await evaluate("location.hash.slice(1)"), room)
  } finally {
    try {
      await browser('close')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})
