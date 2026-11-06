// "Bildschirmfreigabe light" end to end in one browser: the presenter's page (fake screen and
// window), its helper and real viewers – connected over WebRTC, signaling between the tabs instead
// of public relays (see light-fixture.mjs).
//   1. as in Firefox, everything in the tab (the small window blocked): the helper comes by itself
//   2. only the whole screen is taken: a window or tab picked in the browser's dialog is turned away
//   3. as in Chrome: the share in its own small window – the whole screen, one window of it picked
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { startServer } from './light-fixture.mjs'

test('sharing from the browser (as in Firefox): limits said, viewers let in, the helper jumps to pointers and draws back', { timeout: 180000 }, async () => {
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
    assert.equal(await evaluate("new URL(document.querySelector('#light-offer a').href).pathname"), '/share.html')
    // as in Firefox: no Picture-in-Picture window a page can open
    await browser('open', base + '/share.html?browser=firefox')
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

    // start (the share's own window blocked: all in this tab): the picker (faked) and the helper
    // window in the same click; the whole screen shown
    await evaluate("const open = window.open; window.open = (url, ...rest) => (String(url).includes('panel') ? null : open.call(window, url, ...rest)); true")
    await browser('click', '#start')
    await tab('t1')
    await waitFor("!document.querySelector('#pick').hidden")
    await browser('click', '#pick-screen')
    await tab('t2')
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

    // the viewer sees the picture; remote control is shown as not possible
    await tab('t3')
    await waitFor("document.querySelector('video')?.videoWidth > 0")
    assert.equal(await evaluate("document.querySelector('.pv-notice').hidden"), true)
    assert.equal(await evaluate("[...document.querySelectorAll('.pv-dock [data-tool]')].filter(b=>!b.hidden).map(b=>b.dataset.tool+(b.classList.contains('unavailable')?'!':'')).join()"), 'point,draw,control!')

    // the shared clipboard, as with the desktop app: the presenter puts a text in, the viewer sees it
    // and gets its bytes; the viewer pastes one, the presenter has it
    assert.equal(await evaluate("document.querySelector('[data-clip]').hidden"), false, 'the clipboard is offered')
    await tab('t1')
    await browser('click', '#clip-open')
    await waitFor("!!document.querySelector('#clip-box .pv-clip')")
    await evaluate("pvLight.host.clip.addFile(new File(['Hallo von Patrick'], 'Notiz.txt', { type: 'text/plain' })); true")
    await waitFor("document.querySelector('#clip-count').textContent === '1' && document.querySelector('#clip-box').innerText.includes('Notiz.txt')")
    await tab('t3')
    await waitFor("document.querySelector('[data-clip]').dataset.count === '1'")
    await browser('click', '[data-clip]')
    await waitFor("document.querySelector('.pv-clip')?.innerText.includes('Notiz.txt')")
    const paste = "(() => { const d = new DataTransfer(); d.setData('text/plain', 'Hallo von Anna'); document.querySelector('.pv-clip').dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true })); return true })()"
    await evaluate(paste)
    await waitFor("document.querySelector('[data-clip]').dataset.count === '2'")
    await tab('t1')
    await waitFor("document.querySelector('#clip-count').textContent === '2'")
    const items = await evaluate("Promise.all(pvLight.host.clip.all().map(async (it) => [it.name, it.from, await it.blob.text()]))")
    assert.deepEqual(items.map((i) => i[2]).sort(), ['Hallo von Anna', 'Hallo von Patrick'])
    assert.ok(items.some((i) => i[1] !== 0), 'one is the viewer\'s')
    await browser('click', '#clip-open')
    await tab('t3')
    await browser('click', '[data-clip]')
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
    // (held there until the presenter has drawn: under load the test may take longer than it stays)
    await evaluate('pvHelper.hold(); true')
    const focus = await evaluate("({part:pvHelper.part,who:document.querySelector('#focus-who').textContent,shot:document.querySelector('#shot').width,cursor:[...document.querySelectorAll('.pv-cursor .pv-name')].map(n=>n.textContent)})")
    assert.equal(focus.who, 'Anna zeigt hier')
    assert.ok(focus.shot > 0, 'a still picture of the shared screen')
    assert.deepEqual(focus.cursor, ['Anna'])
    const { part } = focus
    assert.ok(part.x < target.nx && target.nx < part.x + part.w && part.y < target.ny && target.ny < part.y + part.h, `the spot ${JSON.stringify(part)} contains the pointer`)
    await tab('t1')
    assert.equal(await evaluate('pvLight.lastReveal.ping && pvLight.lastReveal.name'), 'Anna')
    await tab('t2')

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

test('only the whole screen is taken: a single window or tab picked in the browser is turned away, with what to pick instead', { timeout: 180000 }, async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const session = 'pv-light-whole-' + process.pid
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (code) => JSON.parse(await browser('eval', code))
  const waitFor = (fn) => browser('wait', '--fn', fn)
  const tab = (id) => browser('tab', id)
  const tabs = async () => browser('tab', 'list')
  try {
    // (as in Safari: no Picture-in-Picture; the share's own window blocked: all in this tab)
    await browser('open', base + '/share.html')
    await evaluate("localStorage.setItem('qaNoPip', '1'); true")
    await browser('open', base + '/share.html')
    await browser('set', 'viewport', '1280', '900')
    await evaluate("const open = window.open; window.qaOpened = []; window.open = (url, ...rest) => (qaOpened.push(String(url)), String(url).includes('panel') ? null : open.call(window, url, ...rest)); qaSurfaces.push('window', 'monitor'); document.querySelector('#name').value = 'Patrick'; true")
    // a window picked in the browser's dialog: not taken – said what to pick, here in the tab;
    // nothing shared, no small window opened at all
    await evaluate("document.querySelector('#start').click(); true")
    await waitFor("!document.querySelector('#start-error').hidden")
    assert.match(await evaluate("document.querySelector('#start-error').textContent"), /„Gesamter Bildschirm“[\s\S]*Keine Sorge[\s\S]*auf ein einzelnes Fenster beschränken[\s\S]*wo dein Fenster liegt/)
    assert.equal(await evaluate("document.querySelector('#pick').hidden && document.querySelector('#running').hidden && !pvLight.host && !document.querySelector('#start').disabled"), true)
    await waitFor('1')
    assert.deepEqual(await evaluate('qaOpened'), [], 'no window opened')
    assert.doesNotMatch(await tabs(), /share-helper|panel/)
    // the whole screen: the window is picked here
    await browser('click', '#start')
    await tab('t1')
    await waitFor("!document.querySelector('#pick').hidden && document.querySelector('#start-error').hidden")
  } finally {
    try {
      await browser('close')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test('the share in its own small window (as in Firefox: no Picture-in-Picture, cut out on a canvas): the screen picked in the tab and handed over, one window of it picked – viewers get only that window', { timeout: 180000 }, async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const session = 'pv-light-pick-' + process.pid
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (code) => JSON.parse(await browser('eval', code))
  const waitFor = (fn) => browser('wait', '--fn', fn)
  const tab = (id) => browser('tab', id)
  try {
    // (as in Firefox: no Picture-in-Picture, no MediaStreamTrackGenerator – the window
    // "Freigabe läuft" is a popup, a canvas cuts the window out)
    await browser('open', base + '/share.html')
    await evaluate("localStorage.setItem('qaFirefox', '1'); true")
    await browser('open', base + '/share.html')
    await browser('set', 'viewport', '1280', '1000')
    // (what to pick is said beside the browser's dialog – no line under the button)
    assert.equal(await evaluate("document.querySelector('#start-hint').hidden"), true)
    await evaluate("document.querySelector('#name').value='Patrick';true")
    const win = await evaluate('qaWindowAt')
    // the screen is picked in the tab's click, checked there and handed to the small window; the
    // tab stays open. (The click spent while the browser asked, as after 5 s: one more,
    // "Freigabe starten" – the small window not even tried before)
    // notifications: asked beside "Bildschirm teilen", optional, with a click of its own (a fake one
    // here – the browser's own asks the user)
    await evaluate("window.Notification = class { static permission = 'default'; static requestPermission() { Notification.permission = 'granted'; return Promise.resolve('granted') } }; window.dispatchEvent(new Event('focus')); true")
    assert.match(await evaluate("document.querySelector('#notify-opt').innerText"), /Benachrichtigen, wenn jemand etwas zeigt oder malt\s*optional/)
    await browser('click', '#notify-on')
    await waitFor("document.querySelector('#notify-on').checked && document.querySelector('#notify-on').disabled && !document.querySelector('#notify-text').hidden")
    await evaluate("Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true }); true")
    await browser('click', '#start')
    await waitFor("!document.querySelector('#start-ready').hidden && document.querySelector('#start').hidden")
    assert.doesNotMatch(await browser('tab', 'list'), /panel/)
    await browser('click', '#start-open')
    await tab('t1')
    await waitFor("!document.querySelector('#elsewhere').hidden")
    assert.match(await evaluate("document.querySelector('#elsewhere').innerText"), /Freigabe läuft[\s\S]*Lass diesen Tab bitte offen/)
    const P = 't2'
    // (the fake screen is the tab's – it was picked there: what happens on it, there)
    const onScreen = async (code) => {
      await tab('t1')
      await evaluate(code)
      await tab(P)
    }
    const V = 't3'
    await tab(P)
    await waitFor("document.body.classList.contains('panel') && document.querySelector('#name').value === 'Patrick'")
    // it asks for the screen itself, right away (where a browser wants a click there: its button)
    // which window? the screen with the windows found
    await waitFor("!document.querySelector('#pick').hidden && document.querySelector('#pick-view').width > 0")
    assert.equal(await evaluate("document.querySelector('#running').hidden && document.querySelector('#pick-ok').disabled"), true, 'nothing shared before the choice')
    // (as if the presenter had been over at the window: the picture from the background)
    await evaluate("document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); true")
    await new Promise((done) => setTimeout(done, 900))
    await evaluate("delete document.hasFocus; window.dispatchEvent(new Event('focus')); true")
    // the window just worked in is recognized by its title bar's buttons, and picked right away
    await waitFor("document.querySelector('#pick-lead').textContent.startsWith('Erkannt') && !document.querySelector('#pick-ok').disabled")
    // … it lights up, and the small window needs no scrolling
    assert.equal(await evaluate("document.querySelector('#pick-preview').classList.contains('glow')"), true, 'recognized: a glow')
    assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('#pick-preview')).maxHeight)") <= 150)
    // a drag draws a part by hand – which would stay where it is; the window is shown here
    assert.equal(await evaluate("document.querySelector('#pick-ok').textContent"), 'Dieses Fenster zeigen')
    const sw = await evaluate('screen.width')
    await waitFor("!document.querySelector('#pick-ok').disabled")
    await evaluate("document.querySelector('#pick-ok').scrollIntoView({ block: 'center' }); true")
    await browser('click', '#pick-ok')
    await waitFor("!document.querySelector('#running').hidden && !!pvLight.host")
    assert.match(await evaluate("document.querySelector('#live-title').textContent"), /^Freigabe läuft · /)
    assert.equal(await evaluate("document.querySelector('#locate-step').hidden && !document.querySelector('#repick').hidden"), true, 'no second screen to pick: the place is known')
    const size = await evaluate('pvLight.host.size')
    assert.ok(Math.abs(size.width - win.width) <= 4 && Math.abs(size.height - win.height) <= 4, JSON.stringify(size))

    // a viewer gets only the window
    const room = (await evaluate("document.querySelector('#link').value")).split('#')[1]
    await browser('tab', 'new', `${base}/?name=Anna#${room}`)
    await tab(P)
    await browser('wait', '#requests [data-allow]')
    // (the headless browser keeps the small window at its first size: the request scrolled up, clear of the footer)
    await evaluate("document.querySelector('#requests [data-allow]').scrollIntoView({ block: 'center' }); true")
    await browser('click', '#requests [data-allow]')
    // (notifications were allowed in the tab before: allowed for the page – a fake one here)
    await evaluate("window.qaNotes = []; window.Notification = class { static permission = 'granted'; constructor(title) { this.title = title; qaNotes.push(this) } close() {} }; true")
    // what viewers may: switched right in the small window's footer – "Steuern" only with the desktop app
    await evaluate("document.querySelector('#footer-modes [data-mode=view]').click(); true")
    await waitFor("pvLight.host.mode === 'view' && document.querySelector('#footer-modes [data-mode=view]').getAttribute('aria-pressed') === 'true'")
    await evaluate("document.querySelector('#footer-modes [data-mode=control]').click(); true")
    assert.match(await evaluate("document.querySelector('#footer-mode-note').textContent"), /PeekaView Desktop/)
    assert.equal(await evaluate('pvLight.host.mode'), 'view')
    await evaluate("document.querySelector('#footer-modes [data-mode=draw]').click(); true")
    await waitFor("pvLight.host.mode === 'draw'")
    await tab(V)
    await waitFor("document.querySelector('video')?.videoWidth > 0")
    const video = await evaluate("[document.querySelector('video').videoWidth, document.querySelector('video').videoHeight]")
    assert.ok(Math.abs(video[0] - win.width) <= 4 && Math.abs(video[1] - win.height) <= 4, `${video}`)
    assert.equal(await evaluate("document.querySelector('.pv-title').textContent"), 'Fenster')

    // a stroke: its place on the screen is the window's – no search
    await browser('click', '.pv-dock [data-tool=draw]')
    const r = await evaluate("(()=>{const r=document.querySelector('video').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height}})()")
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.3)), String(Math.round(r.t + r.h * 0.5)))
    await browser('mouse', 'down')
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.5)), String(Math.round(r.t + r.h * 0.55)))
    await browser('mouse', 'up')
    await tab(P)
    await waitFor('!!pvLight.lastReveal')
    // the small window itself shows the spot (and goes back to its panel afterwards)
    await waitFor("document.body.classList.contains('spotting') && document.querySelector('#spot').contentWindow.pvHelper.state === 'focus'")
    assert.equal(await evaluate("document.querySelector('#spot').contentDocument.querySelector('#focus-who').textContent"), 'Anna zeigt hier')
    // … and meanwhile no new pictures go out (the drawing over the window would be seen twice)
    assert.equal(await evaluate('pvLight.frames.paused'), true)
    const picture = await evaluate('pvLight.lastReveal.capture.picture')
    for (const [k, v] of [['left', win.x], ['top', win.y], ['width', win.width], ['height', win.height]]) assert.ok(Math.abs(picture[k] - v) <= 3, `${k}: ${picture[k]} ≈ ${v}`)

    // every picture is checked right in the video's way: while the window stays, none is held back
    const still = await evaluate('pvLight.frames')
    assert.ok(still.checked > 10 && still.held <= 2, JSON.stringify(still))

    // (the helper back in its corner, the pictures going out again)
    await waitFor("!document.body.classList.contains('spotting') && !pvLight.frames.paused")

    // the window moved – and drawn on right away: the drawing appears where it is now (the
    // presenter in another program meanwhile: a notification)
    const moved = { ...win, x: win.x - 160, y: win.y + 120 }
    await onScreen(`qaWindowAt = ${JSON.stringify(moved)}; true`)
    await evaluate('document.hasFocus = () => false; true')
    await tab(V)
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.6)), String(Math.round(r.t + r.h * 0.4)))
    await browser('mouse', 'down')
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.7)), String(Math.round(r.t + r.h * 0.45)))
    await browser('mouse', 'up')
    await tab(P)
    await waitFor(`pvLight.lastReveal?.capture?.picture?.left < ${win.x - 100}`).catch(async (e) => {
      throw new Error(`${e.message}\n${JSON.stringify(await evaluate('({crop: pvLight.crop, tracked: pvLight.tracked, picture: pvLight.lastReveal?.capture?.picture, at: pvLight.lastReveal?.at, now: Date.now()})'))}`)
    })
    const there = await evaluate('pvLight.lastReveal.capture.picture')
    // a notification – its click brings the small window with the drawing to the front
    assert.deepEqual(await evaluate('qaNotes.map((n) => n.title)'), ['Anna hat etwas gemalt'])
    await evaluate('delete document.hasFocus; qaNotes[0].onclick(); true')
    await waitFor("document.body.classList.contains('spotting') && document.querySelector('#spot').contentWindow.pvHelper.state === 'focus'")
    // (the move was noticed – in the video's way, pictures held back until it was found, or by the
    // search itself first: on a canvas only every third picture is checked)
    assert.ok((await evaluate('pvLight.frames')).held > still.held || (await evaluate('pvLight.tracked?.how')) !== 'nicht gefunden', 'noticed')
    for (const [k, v] of [['left', moved.x], ['top', moved.y], ['width', win.width], ['height', win.height]]) assert.ok(Math.abs(there[k] - v) <= 3, `moved, ${k}: ${there[k]} ≈ ${v}`)
    // … and viewers still see the whole window, at the same size
    const after = await evaluate('pvLight.host.size')
    assert.ok(Math.abs(after.width - size.width) <= 2 && Math.abs(after.height - size.height) <= 2, JSON.stringify(after))

    // a small window that cannot be moved (Firefox on a second screen: its numbers counted from that
    // screen's corner): no 1:1 picture under it – that would be its own old picture – but the part
    // around the drawing, fitted (nothing dimmed); it is never moved
    await waitFor("!document.body.classList.contains('spotting') && !pvLight.frames.paused")
    await evaluate("for (const [k, v] of Object.entries({ left: screen.width, availLeft: 0 })) Object.defineProperty(screen, k, { value: v, configurable: true }); window.qaMoves = 0; window.qaMoveTo = window.moveTo; window.moveTo = () => qaMoves++; true")
    await tab(V)
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.2)), String(Math.round(r.t + r.h * 0.7)))
    await browser('mouse', 'down')
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.3)), String(Math.round(r.t + r.h * 0.75)))
    await browser('mouse', 'up')
    await tab(P)
    await waitFor("document.body.classList.contains('spotting') && document.querySelector('#spot').contentWindow.pvHelper.state === 'focus'")
    const zoomed = await evaluate("(()=>{const f=document.querySelector('#spot').contentWindow;const d=f.document;return {layout:f.pvHelper.layout,part:f.pvHelper.part,dim:!!d.querySelector('#dim'),backdrop:!d.querySelector('#backdrop').hidden,moves:qaMoves}})()")
    assert.equal(zoomed.layout, 'zoom', JSON.stringify(zoomed))
    assert.ok(!zoomed.dim && !zoomed.backdrop && zoomed.moves === 0, JSON.stringify(zoomed))
    assert.ok(zoomed.part.x < 0.25 && 0.25 < zoomed.part.x + zoomed.part.w && zoomed.part.y < 0.72 && 0.72 < zoomed.part.y + zoomed.part.h, `the drawing in the part shown: ${JSON.stringify(zoomed.part)}`)
    // Anna moves her mouse far off: the part shown moves on, calmly, until her pointer is inside again
    await tab(V)
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.75)), String(Math.round(r.t + r.h * 0.3)))
    await tab(P)
    await waitFor("(()=>{const p=document.querySelector('#spot').contentWindow.pvHelper.part;return p.x + p.w * 0.12 < 0.75 && 0.75 < p.x + p.w * 0.88 && p.y + p.h * 0.12 < 0.3 && 0.3 < p.y + p.h * 0.88})()")
    await evaluate("document.querySelector('#spot').contentWindow.pvHelper.park(); delete screen.left; delete screen.availLeft; window.moveTo = qaMoveTo; true")

    // the window gone from the screen: viewers see its last picture blurred with a note, never what
    // lies there now
    const dark = "(()=>{const v=document.querySelector('video');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i];return s/(d.length/4)})()"
    await tab(V)
    const bright = await evaluate(dark)
    await tab(P)
    await onScreen('qaHideWindow = true; true')
    await waitFor("document.querySelector('#problem-title').textContent === 'Wechsle zu deinem Fenster' && !document.querySelector('#place-problem').hidden")
    // (blurred and darkened, with the note over it)
    await tab(V)
    await waitFor(`${dark} < ${bright * 0.6}`)
    await tab(P)
    await onScreen('qaHideWindow = false; true')
    await waitFor("document.querySelector('#place-problem').hidden")
    await tab(V)
    await waitFor(`${dark} > 60`)
    await tab(P)

    // maximized (larger, elsewhere): found again by its title, read from its title bar
    const big = { x: 40, y: 60, width: 700, height: 460 }
    await onScreen(`qaWindowAt = ${JSON.stringify(big)}; true`)
    await waitFor(`Math.abs(pvLight.crop.x - ${big.x}) <= 4 && Math.abs(pvLight.crop.width - ${big.width}) <= 6 && Math.abs(pvLight.crop.height - ${big.height}) <= 6`).catch(async (e) => {
      throw new Error(`${e.message}\n${JSON.stringify(await evaluate('({crop: pvLight.crop, tracked: pvLight.tracked})'))}`)
    })
    await tab(V)
    await waitFor(`Math.abs(document.querySelector('video').videoWidth - ${big.width}) <= 6 && ${dark} > 60`)
    await tab(P)
    // made smaller where it is (its right and bottom borders move): the new size, too
    const smaller = { ...big, width: big.width - 120, height: big.height - 60 }
    await onScreen(`qaWindowAt = ${JSON.stringify(smaller)}; true`)
    await waitFor(`pvLight.crop.x === ${big.x} && Math.abs(pvLight.crop.width - ${smaller.width}) <= 6 && Math.abs(pvLight.crop.height - ${smaller.height}) <= 6`).catch(async (e) => {
      throw new Error(`${e.message}\n${JSON.stringify(await evaluate('({crop: pvLight.crop, tracked: pvLight.tracked})'))}`)
    })
    await tab(V)
    await waitFor(`Math.abs(document.querySelector('video').videoWidth - ${smaller.width}) <= 6`)
    await tab(P)

    // another choice while sharing: the whole screen – the same viewers, the whole picture
    // (once the small window shows its panel again)
    await waitFor("!document.body.classList.contains('spotting')")
    await waitFor('!pvLight.frames.paused')
    // (in the small window: a link)
    await browser('click', '#repick-link')
    await waitFor("!document.querySelector('#pick').hidden")
    await browser('click', '#pick-screen')
    await waitFor("!document.querySelector('#running').hidden && pvLight.host.surface === 'monitor'")
    await tab(V)
    await waitFor(`document.querySelector('video').videoWidth === ${sw}`)
    await waitFor("document.querySelector('.pv-title').textContent === 'Bildschirm'")

    await tab(P)
    assert.equal(await evaluate('!!pvLight.host && pvLight.status().viewers.length'), 1)
    // stopped: the small window closes by itself – "Freigabe beendet" in the tab, to share again from there
    await evaluate("setTimeout(() => document.querySelector('#stop').click(), 50); true")
    await tab('t1')
    await waitFor("!document.querySelector('#ended').hidden && document.querySelector('#elsewhere').hidden && !!document.querySelector('#again')")
    await waitFor('1')
    assert.doesNotMatch(await browser('tab', 'list'), /panel/)
  } finally {
    try {
      await browser('close')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test('the window "Freigabe läuft" always on top (Picture-in-Picture, as in Chrome): opened by the small window, a drawing shown large with a click', { timeout: 180000 }, async () => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const session = 'pv-light-pip-' + process.pid
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (code) => JSON.parse(await browser('eval', code))
  const waitFor = (fn) => browser('wait', '--fn', fn)
  const tab = (id) => browser('tab', id)
  const tabs = async () => browser('tab', 'list')
  const idOf = async (part) => (await tabs()).split('\n').find((l) => l.includes(part))?.match(/t\d+/)?.[0]
  try {
    await browser('open', base + '/share.html')
    await browser('set', 'viewport', '1280', '1000')
    await evaluate("document.querySelector('#name').value='Patrick';true")
    const win = await evaluate('qaWindowAt')
    // the small window takes over; the window is picked there
    await browser('click', '#start')
    await tab('t1')
    await waitFor("!document.querySelector('#elsewhere').hidden")
    const S = await idOf('panel')
    await tab(S)
    await waitFor("!document.querySelector('#pick').hidden && document.querySelector('#pick-view').width > 0")
    await evaluate("document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); true")
    await new Promise((done) => setTimeout(done, 900))
    await evaluate("delete document.hasFocus; window.dispatchEvent(new Event('focus')); true")
    await waitFor("document.querySelector('#pick-lead').textContent.startsWith('Erkannt') && !document.querySelector('#pick-ok').disabled")
    // "Dieses Fenster zeigen": the small window opens the always-on-top one; the controls move there
    await evaluate("document.querySelector('#pick-ok').scrollIntoView({ block: 'center' }); true")
    await browser('click', '#pick-ok')
    await tab(S)
    // (asked to be as small as it goes, behind the always-on-top one: seen by its calls – the headless
    // browser does not size its windows)
    await evaluate("window.qaSizes = []; const r = window.resizeTo.bind(window); window.resizeTo = (w, h) => { qaSizes.push([w, h]); r(w, h) }; true")
    await waitFor("!document.querySelector('#in-pip').hidden && !!pvLight.host && !document.getElementById('running')")
    await waitFor("qaSizes.some(([w, h]) => w === 160 && h === 100)")
    assert.match(await evaluate("document.querySelector('#in-pip').textContent"), /Lass dieses Fenster bitte offen[\s\S]*immer vorne/, await evaluate("JSON.stringify({d: getComputedStyle(document.querySelector('#in-pip')).display, main: getComputedStyle(document.querySelector('main')).display, vis: getComputedStyle(document.querySelector('main')).visibility, body: document.body.className})"))
    let P = await idOf('about:blank')
    await tab(P)
    assert.equal(await evaluate("document.body.classList.contains('pip') && !!document.querySelector('#running #requests')"), true)
    // "Link kopieren" there writes there – the window clicked in (another one's clipboard: Chrome
    // refuses, or asks behind this window)
    await evaluate("window.qaCopied = null; navigator.clipboard.writeText = (t) => { qaCopied = t; return Promise.resolve() }; true")
    await browser('click', '#copy')
    await waitFor('!!window.qaCopied')
    assert.match(await evaluate('qaCopied'), /#[A-Za-z0-9_-]{22}\./)

    // let in from there
    const room = (await evaluate("document.querySelector('#link').value")).split('#')[1]
    await browser('tab', 'new', `${base}/?name=Anna#${room}`)
    const V = await idOf('name=Anna')
    await tab(P)
    await browser('wait', '#requests [data-allow]')
    await browser('click', '#requests [data-allow]')
    await tab(V)
    await waitFor("document.querySelector('video')?.videoWidth > 0")

    // a stroke: a preview in the always-on-top window, in place of the controls (its size stays)
    await browser('click', '.pv-dock [data-tool=draw]')
    const r = await evaluate("(()=>{const r=document.querySelector('video').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height}})()")
    const stroke = async (from, to) => {
      await tab(V)
      await browser('mouse', 'move', String(Math.round(r.l + r.w * from)), String(Math.round(r.t + r.h * 0.5)))
      await browser('mouse', 'down')
      await browser('mouse', 'move', String(Math.round(r.l + r.w * to)), String(Math.round(r.t + r.h * 0.55)))
      await browser('mouse', 'up')
      await tab(P)
      await waitFor("!document.querySelector('#pip-spot').hidden && document.body.classList.contains('pip-spotting')")
    }
    await stroke(0.3, 0.5)
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#run-footer')).display"), 'none', 'the controls make room')
    // Anna moves her mouse: the preview follows it calmly – her pointer inside the part shown
    await tab(V)
    await browser('mouse', 'move', String(Math.round(r.l + r.w * 0.9)), String(Math.round(r.t + r.h * 0.45)))
    await tab(P)
    await waitFor("(()=>{const p=pvLight.preview;if(!p?.pointers.length)return false;const [x,y]=p.pointers[0];const px=x*p.image.width,py=y*p.image.height,c=p.crop;return px>c.x+c.w*0.12&&px<c.x+c.w*0.88&&py>c.y+c.h*0.12&&py<c.y+c.h*0.88})()")
    assert.ok(Math.abs((await evaluate('pvLight.preview.pointers[0]'))[0] - 0.9) < 0.05)
    // … and when it rests, its pointer goes (no longer followed)
    await waitFor('pvLight.preview && pvLight.preview.pointers.length === 0')

    // "Am Fenster zeigen": the drawing over the very spot, in a window of its own that closes again;
    // the controls back
    await browser('click', '#pip-jump')
    await waitFor('1')
    assert.equal(await evaluate("document.body.classList.contains('pip-spotting')"), false)
    const helper = await idOf('share-helper')
    assert.ok(helper, await tabs())
    await tab(helper)
    await waitFor("window.pvHelper?.state === 'focus'")
    const picture = await evaluate('pvHelper.picture')
    assert.ok(Math.abs(picture.left - win.x) <= 3 && Math.abs(picture.top - win.y) <= 3, JSON.stringify(picture))

    // "Groß anzeigen": the window large, nothing but the drawing – and no new pictures meanwhile
    await stroke(0.4, 0.6)
    await browser('click', '#pip-look')
    assert.equal(await evaluate("document.body.classList.contains('pip-large') && !document.querySelector('#pip-small').hidden && document.querySelector('#pip-jump').hidden"), true)
    await tab(S)
    assert.equal(await evaluate('pvLight.frames.paused'), true)
    await tab(P)
    await new Promise((done) => setTimeout(done, 7500))
    assert.equal(await evaluate("!document.querySelector('#pip-spot').hidden"), true, 'kept while large')
    // "Wieder klein": opened anew, small, in the browser's corner; the controls back, the pictures going out again
    await browser('click', '#pip-small')
    await tab(S)
    await waitFor("!pvLight.frames.paused && !document.querySelector('#in-pip').hidden")
    P = await idOf('about:blank')
    await tab(P)
    await waitFor("!!document.querySelector('#running #stop') && !document.body.classList.contains('pip-spotting') && document.querySelector('#pip-spot').hidden")

    // stopping there ends it, and the always-on-top window closes
    // (… and the small window, too: "Freigabe beendet" in the tab)
    await tab(P)
    await evaluate("setTimeout(() => document.querySelector('#stop').click(), 50); true")
    await tab('t1')
    await waitFor("!document.querySelector('#ended').hidden && document.querySelector('#elsewhere').hidden").catch(async (e) => {
      throw new Error(`${e.message}\n${JSON.stringify(await evaluate("({ended: document.querySelector('#ended').hidden, elsewhere: document.querySelector('#elsewhere').hidden})"))}\n${await tabs()}`)
    })
    await waitFor('1')
    assert.doesNotMatch(await tabs(), /panel|about:blank/)
  } finally {
    try {
      await browser('close')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})
