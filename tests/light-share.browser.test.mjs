// "Bildschirmfreigabe light" end to end in one browser: the presenter's page (fake whole screen),
// its helper window and real viewers – connected over WebRTC, signaling between the tabs instead
// of public relays (see light-fixture.mjs).
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { startServer } from './light-fixture.mjs'

test('sharing from the browser: limits said, viewers let in, the helper jumps to pointers and draws back', { timeout: 180000 }, async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const session = 'pv-light-' + process.pid
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (code) => JSON.parse(await browser('eval', code))
  const waitFor = (fn) => browser('wait', '--fn', fn)
  const tab = (id) => browser('tab', id)
  const tabs = async () => browser('tab', 'list')
  try {
    // offered on the start page – with its limits, secondary to the desktop app
    await browser('open', base + '/')
    await browser('set', 'viewport', '1280', '900')
    await browser('wait', '#light-offer')
    assert.match(await evaluate("document.querySelector('#light-offer').textContent"), /einfache Variante, ohne Steuern/)
    assert.equal(await evaluate("document.querySelector('#light-offer').previousElementSibling.classList.contains('pv-download')"), true, 'below the desktop download')
    await browser('click', '#light-offer a')
    await browser('wait', '#start')

    // the presenter's page says briefly what the browser cannot do and points to the desktop app
    assert.equal(await evaluate("document.querySelector('#limits').innerText.replace(/\\s+/g, ' ').trim()"), 'Steuern, Sprache und mehr gehen nur mit PeekaView Desktop. Desktop-App holen')
    assert.equal(await evaluate("new URL(document.querySelector('#desktop-link').href).pathname"), '/download.html')
    await browser('click', '#setup-modes [data-mode=control]')
    assert.match(await evaluate("document.querySelector('#setup-mode-note').textContent"), /Steuern lassen geht nur mit PeekaView Desktop/)
    assert.equal(await evaluate("document.querySelector('#setup-modes [aria-pressed=true]').dataset.mode"), 'draw')
    // no name, no share
    await evaluate("localStorage.removeItem('pv-name');document.querySelector('#name').value='';true")
    await browser('click', '#start')
    assert.equal(await evaluate("!document.querySelector('#name-error').hidden && document.querySelector('#running').hidden"), true)
    await browser('fill', '#name', 'Patrick')

    // start: the picker (faked) and the helper window in the same click
    await browser('click', '#start')
    await waitFor("location.pathname.endsWith('share-helper.html') && window.pvHelper?.state === 'parked'")
    assert.match(await tabs(), /t1\].*share\.html[\s\S]*t2\].*share-helper\.html/)
    assert.match(await evaluate('document.body.innerText'), /Freigabe läuft[\s\S]*Noch niemand schaut zu/)
    await tab('t1')
    await waitFor("!document.querySelector('#running').hidden")
    const link = await evaluate("document.querySelector('#link').value")
    assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/#[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/, 'the normal viewer link: room secret and presenter key')
    const room = link.split('#')[1]
    assert.match(await evaluate("document.querySelector('#running').innerText"), /Steuern, Sprache und mehr gehen nur mit PeekaView Desktop/)
    assert.equal(await evaluate("document.querySelector('#locate-step').hidden"), true, 'a whole screen needs no second step')

    // a viewer asks to come in – nobody watches without "Zulassen"
    await browser('tab', 'new', `${base}/?name=Anna#${room}`)
    await waitFor("document.querySelector('.pv-notice-text')?.textContent.includes('hereinlässt')")
    await tab('t2')
    await waitFor("document.body.innerText.includes('Anna möchte zusehen')")
    await tab('t1')
    await browser('wait', '#requests [data-allow]')
    assert.match(await evaluate("document.querySelector('#requests').innerText"), /Anna\s+möchte deinen Bildschirm sehen/)
    await browser('click', '#requests [data-allow]')
    await waitFor("document.querySelector('#viewers').innerText.includes('Anna')")

    // the viewer sees the picture; remote control is shown as not possible, no clipboard
    await tab('t3')
    await waitFor("document.querySelector('video')?.videoWidth > 0")
    assert.equal(await evaluate("document.querySelector('.pv-notice').hidden"), true)
    assert.equal(await evaluate("[...document.querySelectorAll('.pv-dock [data-tool]')].filter(b=>!b.hidden).map(b=>b.dataset.tool+(b.classList.contains('unavailable')?'!':'')).join()"), 'point,draw,control!')
    assert.equal(await evaluate("document.querySelector('[data-clip]').hidden"), true)
    assert.match(await evaluate("document.querySelector('.pv-toast span').textContent"), /im Browser.*Steuern nicht/)
    await browser('click', '.pv-dock [data-tool=control]')
    assert.match(await evaluate("document.querySelector('.pv-toast span').textContent"), /PeekaView Desktop/)
    assert.equal(await evaluate("document.querySelector('.pv-viewer').dataset.tool"), 'point', 'the control tool is never chosen')

    // the viewer points: the helper jumps there and shows a still picture with the pointer
    const target = await evaluate("(()=>{const r=document.querySelector('video').getBoundingClientRect();return {x:Math.round(r.left+r.width*.6),y:Math.round(r.top+r.height*.4),nx:.6,ny:.4}})()")
    await browser('mouse', 'move', String(target.x), String(target.y))
    await browser('mouse', 'down')
    await browser('mouse', 'up')
    await tab('t2')
    await waitFor("pvHelper.state === 'focus'")
    const focus = await evaluate("({part:pvHelper.part,who:document.querySelector('#focus-who').textContent,shot:document.querySelector('#shot').width,cursor:[...document.querySelectorAll('.pv-cursor .pv-name')].map(n=>n.textContent)})")
    assert.equal(focus.who, 'Anna zeigt hier')
    assert.ok(focus.shot > 0, 'a still picture of the shared screen')
    assert.deepEqual(focus.cursor, ['Anna'])
    const { part } = focus
    assert.ok(part.x < target.nx && target.nx < part.x + part.w && part.y < target.ny && target.ny < part.y + part.h, `the spot ${JSON.stringify(part)} contains the pointer`)

    // the presenter draws into the helper: the viewer sees the stroke with the presenter's name
    const box = await evaluate("(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return {l:Math.max(0,r.left),t:Math.max(0,r.top),w:Math.min(innerWidth,r.right)-Math.max(0,r.left),h:Math.min(innerHeight,r.bottom)-Math.max(0,r.top)}})()")
    await browser('mouse', 'move', String(Math.round(box.l + box.w * 0.3)), String(Math.round(box.t + box.h * 0.5)))
    await browser('mouse', 'down')
    for (const f of [0.35, 0.4, 0.45, 0.5, 0.55]) {
      await browser('mouse', 'move', String(Math.round(box.l + box.w * f)), String(Math.round(box.t + box.h * 0.55)))
    }
    await browser('mouse', 'up')
    await tab('t3')
    await waitFor("[...document.querySelectorAll('.pv-cursor .pv-name')].some(n=>n.textContent==='Patrick')")

    // and back into the corner once nobody points any more
    await tab('t2')
    await waitFor("pvHelper.state === 'parked'")
    assert.match(await evaluate('document.body.innerText'), /Anna schaut zu/)

    // a viewer draws: the helper waits in its corner and says so, and comes only when they let go
    await tab('t3')
    await browser('click', '.pv-dock [data-tool=draw]')
    await browser('mouse', 'move', String(target.x - 80), String(target.y))
    await browser('mouse', 'down')
    for (const dx of [-60, -40, -20, 0, 20]) await browser('mouse', 'move', String(target.x + dx), String(target.y + dx / 2))
    await tab('t2')
    await waitFor("pvHelper.busy.includes('Anna malt gerade')")
    assert.equal(await evaluate('pvHelper.state'), 'parked')
    await tab('t3')
    await browser('mouse', 'up')
    await tab('t2')
    await waitFor("pvHelper.state === 'focus'")
    assert.equal(await evaluate("pvHelper.busy + '|' + document.querySelector('#focus-who').textContent"), '|Anna zeigt hier')
    await evaluate('pvHelper.park();true')

    // "Zusehen": the viewer only watches – still told why there is no remote control
    await tab('t1')
    await browser('click', '#running-modes [data-mode=view]')
    await tab('t3')
    await waitFor("document.querySelector('.pv-mode').dataset.mode === 'view'")
    assert.equal(await evaluate("[...document.querySelectorAll('.pv-dock [data-tool]')].filter(b=>!b.hidden).map(b=>b.dataset.tool).join()"), 'control')

    // somebody else is turned away
    await browser('tab', 'new', `${base}/?name=Bob#${room}`)
    await tab('t1')
    await waitFor("document.querySelector('#requests')?.innerText.includes('Bob')")
    await browser('click', '#requests [data-deny]')
    await tab('t4')
    await waitFor("document.querySelector('.pv-notice-text').textContent.includes('abgelehnt')")

    // stopping ends it everywhere: the helper closes, the viewer waits for the next share
    await tab('t1')
    await browser('click', '#stop')
    await waitFor("!document.querySelector('#ended').hidden")
    await tab('t3')
    await waitFor("document.querySelector('.pv-notice-text').textContent === 'Noch keine Bildschirmfreigabe aktiv.'")
    assert.doesNotMatch(await tabs(), /share-helper/)
  } finally {
    try {
      await browser('close')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test('a shared window: one more click on the whole screen, then the helper finds the window on it', { timeout: 180000 }, async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const session = 'pv-light-window-' + process.pid
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (code) => JSON.parse(await browser('eval', code))
  const waitFor = (fn) => browser('wait', '--fn', fn)
  const tab = (id) => browser('tab', id)
  try {
    await browser('open', base + '/share.html')
    await browser('set', 'viewport', '1280', '900')
    // the presenter picks a window – the fake one lies at qaWindowAt on the fake screen
    await evaluate("qaSurfaces.push('window', 'window', 'monitor');document.querySelector('#name').value='Patrick';true")
    const at = await evaluate('qaWindowAt')
    await browser('click', '#start')
    await waitFor("window.pvHelper?.state === 'parked'")
    await tab('t1')
    await waitFor("!document.querySelector('#running').hidden")
    assert.equal(await evaluate("document.querySelector('#live-title').textContent"), 'Dein Fenster wird geteilt')
    assert.equal(await evaluate("document.querySelector('#locate-step').hidden"), false)
    assert.match(await evaluate("document.querySelector('#locate-step').innerText"), /„Gesamter Bildschirm“[\s\S]*sehen weiterhin nur das Fenster/)
    assert.match(await evaluate("document.querySelector('#helper-text').textContent"), /in der Mitte deines Bildschirms/)
    // a window instead of the whole screen: said what to pick
    await browser('click', '#locate')
    await waitFor("!document.querySelector('#locate-error').hidden")
    assert.match(await evaluate("document.querySelector('#locate-error').textContent"), /Bitte „Gesamter Bildschirm“ wählen/)
    await browser('click', '#locate')
    await waitFor("document.querySelector('#locate-step').hidden")
    assert.match(await evaluate("document.querySelector('#helper-text').textContent"), /genau an der Stelle/)
    // the whole screen stays here: viewers get only the window
    assert.equal(await evaluate('pvLight.locatorStream.getVideoTracks()[0].getSettings().displaySurface + "|" + pvLight.status().locator'), 'monitor|true')

    const room = (await evaluate("document.querySelector('#link').value")).split('#')[1]
    await browser('tab', 'new', `${base}/?name=Anna#${room}`)
    await tab('t1')
    await browser('wait', '#requests [data-allow]')
    await browser('click', '#requests [data-allow]')
    await tab('t3')
    await waitFor("document.querySelector('video')?.videoWidth > 0")
    assert.equal(await evaluate("document.querySelector('video').videoWidth + 'x' + document.querySelector('video').videoHeight"), `${at.width}x${at.height}`, 'only the window goes out')

    // a stroke on the window: the helper comes when it is finished, over the window's place on the screen
    await browser('click', '.pv-dock [data-tool=draw]')
    const r = await evaluate("(()=>{const r=document.querySelector('video').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height}})()")
    const point = (fx, fy) => [String(Math.round(r.l + r.w * fx)), String(Math.round(r.t + r.h * fy))]
    await browser('mouse', 'move', ...point(0.3, 0.4))
    await browser('mouse', 'down')
    for (const f of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6]) await browser('mouse', 'move', ...point(f, 0.4 + (f - 0.3) / 2))
    await browser('mouse', 'up')
    await tab('t2')
    await waitFor("pvHelper.state === 'focus' && !!pvHelper.picture")
    const shown = await evaluate('({picture: pvHelper.picture, found: pvHelper.found, part: pvHelper.part, backdrop: !document.querySelector("#backdrop").hidden})')
    for (const [k, v] of [['left', at.x], ['top', at.y], ['width', at.width], ['height', at.height]]) assert.ok(Math.abs(shown.picture[k] - v) <= 3, `${k}: ${shown.picture[k]} ≈ ${v}`)
    assert.ok(shown.found.score > 0.8)
    assert.equal(shown.backdrop, true, 'the desktop around the window shows, too')
    const mid = { x: 0.45, y: 0.475 }
    assert.ok(shown.part.x < mid.x && mid.x < shown.part.x + shown.part.w && shown.part.y < mid.y && mid.y < shown.part.y + shown.part.h, 'the stroke is in view')

    // stopping ends the screen picture, too
    await tab('t1')
    await browser('click', '#stop')
    await waitFor("!document.querySelector('#ended').hidden")
    assert.equal(await evaluate('pvLight.locatorStream'), null)
  } finally {
    try {
      await browser('close')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})
