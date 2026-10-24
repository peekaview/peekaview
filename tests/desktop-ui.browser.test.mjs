// Actual desktop frontend with simulated local IPC; does not alter OS permissions.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web')
const sources = [
  { id: 'window:1', kind: 'window', app: 'Editor', title: 'Entwurf <1>', thumb: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=' },
  { id: 'window:2', kind: 'window', app: 'Browser', title: 'Zweiter Fenstertitel' },
]
const shim = `window.qa = { calls: [], listeners: {}, emit: (name, payload) => qa.listeners[name]?.({payload}) };
localStorage.setItem('pv-keep-room', 'previous-link-secret');
localStorage.setItem('pv-keep-key', 'previous-presenter-key');
const own={id:'0000000000000000',email:'me@example.test',name:'Mein Computer',platform:'desktop'};
localStorage.setItem('pv-fixed-rooms-v1',JSON.stringify({api:'https://rooms.example.test/api.php',token:'test-token',device:own}));
window.fetch=async()=>Response.json({device:own,person:{id:'1111111111111111',email:own.email,devices:[own]},contacts:[],rooms:[],calls:[],invitations:[]});
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    qa.calls.push({cmd, args});
    if (cmd === 'main_requested') return true;
    if (cmd === 'permission_status') return { screen: !location.pathname.includes('permission'), accessibility: false, targetVisible: true };
    if (cmd === 'list_sources') return ${JSON.stringify(sources)};
    if (['rooms_list', 'peers'].includes(cmd)) return [];
    if (cmd === 'get_settings') return { name: 'Host', keep_link: true, site: 'https://old-viewer.example.test' };
    if (cmd === 'live_info') return {link:'https://peekaview.de/#test-link',title:'Editor',mode:'view',copied:true};
    if (cmd === 'transcripts_list') return [
      {id:'PeekaView-Sitzung-2026-10-23_12-30.html',title:'Editor',date:'23. Oktober 2026 um 12:30',day:'2026-10-23',conversation:{id:'group-a',kind:'group',name:'Team & Partner'}},
      {id:'PeekaView-Sitzung-2026-10-23_11-30.html',title:'Browser',date:'23. Oktober 2026 um 11:30',day:'2026-10-23',conversation:{id:'contact-b',kind:'contact',name:'ben@example.test · Telefon'}},
      {id:'PeekaView-Sitzung-2026-10-22_10-00.html',title:'Älterer Bericht',date:'22. Oktober 2026 um 10:00',day:'2026-10-22',conversation:null}
    ];
    if (cmd === 'start_share') return { secret: 'link-secret', signingKey: 'presenter-key' };
    return null;
  } }, event: { listen: async (name, handler) => { qa.listeners[name] = handler; return () => {}; }, emitTo: async () => {} }
};`

test('desktop permissions, source selection and the remembered contacts destination', { timeout: 90000 }, async () => {
  const server = createServer(async (request, response) => {
    const file = resolve(web, '.' + new URL(request.url, 'http://localhost').pathname)
    if (!file.startsWith(web + sep)) { response.writeHead(403).end(); return }
    try {
      let content = await readFile(file)
      if (extname(file) === '.html') content = Buffer.from(content.toString().replace('<head>', `<head><script>${shim}</script>`))
      response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' })[extname(file)] ?? 'application/octet-stream')
      response.end(content)
    } catch { response.writeHead(404).end() }
  })
  const session = `pv-desktop-regression-${process.pid}`
  const browser = async (...args) => (await promisify(execFile)('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 })).stdout
  const evaluate = async (expression) => JSON.parse(await browser('eval', expression))
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    await browser('open', base + '/desktop/permission.html')
    await browser('wait', '#permission-title')
    const colors = []
    for (const theme of ['light', 'dark', 'light']) {
      await browser('set', 'media', theme)
      assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'light dark')
      colors.push(await evaluate('getComputedStyle(document.body).backgroundColor'))
    }
    assert.notEqual(colors[0], colors[1])
    assert.equal(colors[0], colors[2])

    await browser('open', base + '/desktop/index.html')
    await browser('wait','.app-head #profile:not([hidden]) summary')
    await browser('click','.app-head #profile summary')
    assert.equal(await evaluate("document.querySelector('.fr-profile-device').textContent.includes('Mein Computer')"),true)
    await browser('press','Escape')
    await browser('click', '[data-kind="window"]')
    await browser('wait', '.card')
    await browser('click', '.card:nth-child(1)')
    await browser('click', '.card:nth-child(2)')
    assert.equal(await evaluate("document.querySelector('#picker-lead').textContent.includes('Mehrere Fenster')"),true)
    const cards = await evaluate(`Array.from(document.querySelectorAll('.card')).map(card => ({
      badge: card.querySelector('.pick')?.textContent,
      title: card.querySelector('.meta span').textContent,
      tooltip: card.getAttribute('title')
    }))`)
    assert.deepEqual(cards, sources.map((source, i) => ({ badge: String(i + 1), title: source.title, tooltip: null })))
    await browser('click', '.card:nth-child(1)')
    assert.equal(await evaluate("document.querySelector('.card:nth-child(2) .pick').textContent"), '1')
    assert.equal(await evaluate("document.querySelector('.card:nth-child(1) .meta span').textContent"), sources[0].title)

    // Destination is independent of the selected content; choosing it never captures.
    await browser('click', '[data-destination="contacts"]')
    await browser('open', base + '/desktop/index.html')
    await browser('wait', '#fixed-rooms')
    assert.equal(await evaluate("document.querySelector('#picker').hidden"), true)
    assert.equal(await evaluate("document.querySelector('#fixed-rooms').hidden"), false)
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('[data-kind]'), el => el.dataset.kind)"), ['screen', 'window'])
    assert.equal(await evaluate("qa.calls.some(c => c.cmd === 'start_share')"), false)
    await evaluate("qa.emit('invite', {room:'external-invite', site:'https://example.invalid'}); qa.emit('fixed-share', {id:'0123456789abcdef',name:'Familie'}); true")
    assert.equal(await evaluate("document.querySelector('#picker').hidden"), false)
    assert.equal(await evaluate("document.querySelector('.tab.active').dataset.kind"), 'window')
    assert.equal(await evaluate("document.querySelector('#fixed-call-label').textContent"), 'Teilen mit Familie')
    assert.equal(await evaluate("document.querySelector('#start-hint').textContent"),'')
    assert.equal(await evaluate("document.querySelector('#room-choice').hidden"), true)
    assert.equal(await evaluate("document.querySelector('#invite').hidden"), true)
    await browser('click', '#start')
    await browser('wait', '--fn', "qa.calls.some(c => c.cmd === 'start_share')")
    const groupShare = await evaluate("qa.calls.findLast(c => c.cmd === 'start_share').args")
    assert.equal(groupShare.fixedCall, '0123456789abcdef')
    assert.equal(groupShare.room, null)
    assert.equal(groupShare.signingKey, null)
    assert.equal(groupShare.site, 'https://peekaview.de')
    assert.deepEqual(groupShare.sources, ['window:2'])

    await browser('open', base + '/desktop/index.html')
    await browser('wait', '.card')
    assert.equal(await evaluate("document.querySelector('#fixed-call-banner').hidden"), false)
    assert.equal(await evaluate("document.querySelector('#fixed-call-label').textContent"), 'Teilen mit Familie')
    await browser('click', '#fixed-call-change')
    assert.equal(await evaluate("document.querySelector('#picker').hidden"), true)
    await browser('click', '[data-destination="link"]')
    await browser('open', base + '/desktop/index.html')
    await browser('wait', '.card')
    assert.equal(await evaluate("document.querySelector('#picker').hidden"), false)
    assert.equal(await evaluate("document.querySelector('#fixed-call-banner').hidden"), true)
    assert.equal(await evaluate("document.querySelector('#room-choice').hidden"), false)
    await browser('click', '#start')
    await browser('wait', '--fn', "qa.calls.some(c => c.cmd === 'start_share')")
    assert.equal(await evaluate("qa.calls.findLast(c => c.cmd === 'start_share').args.fixedCall"), null)
    assert.equal(await evaluate("qa.calls.findLast(c => c.cmd === 'start_share').args.site"), 'https://peekaview.de')
    await evaluate("localStorage.removeItem('pv-settings-page');true")
    await browser('open',base+'/desktop/rooms.html')
    await browser('wait','#own-name')
    assert.equal(await evaluate("document.querySelector('#settings-page').hidden"),false)
    await browser('open',base+'/desktop/rooms.html#links')
    await browser('reload')
    await browser('wait','--fn',"document.querySelector('#rooms-page').hidden===false")
    await evaluate("qa.emit('settings-page','settings-page');true")
    assert.equal(await evaluate("document.querySelector('#settings-page').hidden"),false)
    await browser('open',base+'/desktop/transcripts.html')
    await browser('wait','.transcript-card')
    assert.equal(await evaluate("document.querySelectorAll('.transcript-card').length"),3)
    await browser('select','#conversation','group-a')
    await browser('wait','--fn',"document.querySelectorAll('.transcript-card').length===1")
    assert.equal(await evaluate("document.querySelector('.transcript-card').textContent.includes('Team & Partner')"),true)
    await browser('click','.transcript-card')
    assert.equal(await evaluate("qa.calls.findLast(c=>c.cmd==='transcripts_window').args.id"),'PeekaView-Sitzung-2026-10-23_12-30.html')
    await browser('select','#conversation','contact-b')
    assert.equal(await evaluate("document.querySelector('.transcript-card strong').textContent"),'Browser')
    await browser('select','#conversation','legacy')
    assert.equal(await evaluate("document.querySelector('.transcript-card strong').textContent"),'Älterer Bericht')
    await browser('open',base+'/desktop/toolbar.html')
    await browser('wait','#guide:not([hidden])')
    assert.equal(await evaluate("document.querySelector('#guide-copied').textContent"),'Er ist schon kopiert.')
    assert.equal(await evaluate("document.querySelectorAll('.modes button').length"),3)
    assert.equal(await evaluate("document.querySelector('[data-mode=control]').textContent.trim()"),'Steuern')
    await evaluate("qa.emit('settings',{voice_enabled:false,transcript_enabled:false});true")
    assert.equal(await evaluate("document.querySelector('#mic-btn').hidden"),true)
    await evaluate("qa.emit('settings',{voice_enabled:true,transcript_enabled:false});true")
    assert.equal(await evaluate("document.querySelector('#mic-btn').hidden"),false)
    await evaluate("qa.emit('live',{link:'https://peekaview.de/#test-link',mode:'view',fixedCall:'group-test'});true")
    assert.equal(await evaluate("document.querySelector('#guide').hidden && document.querySelector('#mic-btn').hidden"),true)
    await evaluate("qa.emit('live',{link:'https://peekaview.de/#test-link',mode:'view'});true")
    assert.equal(await evaluate("document.querySelector('#guide').hidden"),false)
    await evaluate("qa.emit('peers',[{id:1,name:'Testgast',color:'#456',host:false}]);true")
    assert.equal(await evaluate("document.querySelector('#guide').hidden"),true)
    assert.equal(await evaluate("qa.calls.some(c=>c.cmd==='log_js')"),false)
  } finally {
    try { await browser('close') } finally { await new Promise(resolve => server.close(resolve)) }
  }
})
