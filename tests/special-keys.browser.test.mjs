// "Sondertasten" menu (Windows and macOS hosts, restart through the macOS service) and the desktop hint of the actual viewer; only incoming
// data-channel messages are simulated.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web')
const fixture = `<!doctype html><html><head><style>html,body{margin:0;height:100%}#viewer{height:100%}</style></head>
<body><div id="viewer"></div><script>if(location.search==='?win')Object.defineProperty(Navigator.prototype,'platform',{get:()=>'Win32'})</script><script type="module">
import {mountViewer} from '/viewer.js';
localStorage.setItem('pv-dock',JSON.stringify({collapsed:false}));
window.viewer=mountViewer(document.querySelector('#viewer'),{room:'',name:'Viewer',voice:false});
</script></body></html>`

test('special keys menu follows mode and host OS; desk hint follows state.desk', {timeout:120000}, async () => {
 const server=createServer(async(request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname
  if(path==='/fixture.html'){response.setHeader('Content-Type','text/html');response.end(fixture);return}
  const file=resolve(web,'.'+path)
  if(!file.startsWith(web+sep)){response.writeHead(403).end();return}
  try{
   let content=await readFile(file)
   if(path==='/viewer.js')content=Buffer.from(content.toString()
    .replace("  setTool('point')\n  update('connecting')", "  window.qa = {wm, receive: onText, sent: []}\n  setTool('point')\n  update('connecting')")
    .replace("const send = (m) => dc?.readyState === 'open' && dc.send(JSON.stringify(m))", "const send = (m) => {window.qa?.sent.push(m);return dc?.readyState === 'open' && dc.send(JSON.stringify(m))}"))
   response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');response.end(content)
  }catch{response.writeHead(404).end()}
 })
 const session='pv-special-keys-'+process.pid
 const browser=async(...args)=>(await promisify(execFile)('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000})).stdout
 const evaluate=async(code)=>JSON.parse(await browser('eval',code))
 const state=(extra={})=>({t:'state',mode:'control',title:'Shared desktop',windows:[{w:0,kind:'screen',title:'Bildschirm',pw:1920,ph:1080}],...extra})
 const receive=(m)=>evaluate(`qa.receive(${JSON.stringify(m)});true`)
 const visible=(sel)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && !e.hidden && e.getBoundingClientRect().width>0})()`)
 const items="[...document.querySelectorAll('.pv-special [role=menuitem]')].map(b=>b.textContent)"
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  await browser('set','viewport','1280','900')
  await browser('open','http://127.0.0.1:'+server.address().port+'/fixture.html')
  await browser('wait','--fn','!!window.qa')
  await receive({t:'welcome',id:1})
  await receive({t:'peers',list:[{id:0,host:true,name:'Host',color:'#ff0000'}]})

  // only while controlling
  await receive(state({mode:'draw'}))
  assert.equal(await visible('[data-special]'),false,'hidden in mode draw')
  await receive(state())
  await evaluate("document.querySelector('video').dispatchEvent(new Event('loadeddata'));true")
  assert.equal(await visible('[data-special]'),true,'visible in mode control')
  assert.equal(await evaluate("document.querySelector('[data-special]').getAttribute('aria-label')"),'Sondertasten')

  // Windows host (also when the host sends no os)
  await browser('click','[data-special]')
  assert.equal(await visible('.pv-special'),true)
  assert.deepEqual(await evaluate(items),['Strg+Alt+Entf','Windows-Taste','Alt+Tab','Alt+F4','Strg+Umschalt+Esc','Sperren'])
  await browser('press','Escape')
  assert.equal(await visible('.pv-special'),false,'Escape closes the menu')
  assert.equal(await evaluate("qa.sent.some(m=>m.t==='key' && m.key==='Escape')"),false,'… without passing Escape on')

  await receive(state({os:'windows'}))
  await browser('click','[data-special]')
  assert.equal((await evaluate(items)).length,6)
  await evaluate('qa.sent=[];true')
  await browser('click','.pv-special [data-k="cad"]')
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t==='special')"),[{t:'special',k:'cad',w:0}])
  assert.equal(await visible('.pv-special'),false,'choosing closes the menu')

  // click elsewhere closes it
  await browser('click','[data-special]')
  assert.equal(await visible('.pv-special'),true)
  await evaluate("document.querySelector('.pv-stage').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));true")
  assert.equal(await visible('.pv-special'),false)

  // macOS host
  await receive(state({os:'macos'}))
  await browser('click','[data-special]')
  const macItems=['Cmd+Tab','Cmd+Leertaste','Cmd+Q','Sofort beenden (Cmd+Alt+Esc)','Sperren (Ctrl+Cmd+Q)']
  assert.deepEqual(await evaluate(items),macItems)
  await evaluate('qa.sent=[];true')
  await browser('click','.pv-special [data-k="force-quit"]')
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t==='special')"),[{t:'special',k:'force-quit',w:0}])

  // the macOS service's agent can restart the Mac
  await receive(state({os:'macos',restart:true,filevault:false}))
  await browser('click','[data-special]')
  assert.deepEqual(await evaluate(items),[...macItems,'Neustart …'])
  await browser('click','.pv-special [data-k="restart"]')
  assert.equal(await visible('.pv-restart'),true,'restart asks first')
  assert.equal(await visible('.pv-restart input[name=password]'),false,'no password without FileVault')
  assert.match(await evaluate("document.querySelector('.pv-restart-text').textContent"),/von selbst wieder/)
  await evaluate('qa.sent=[];true')
  await browser('click','.pv-restart [data-cancel]')
  assert.equal(await visible('.pv-restart'),false)
  assert.deepEqual(await evaluate("qa.sent"),[],'cancel sends nothing')
  // FileVault: optional name and password for fdesetup authrestart
  await receive(state({os:'macos',restart:true,filevault:true}))
  await browser('click','[data-special]')
  await browser('click','.pv-special [data-k="restart"]')
  assert.equal(await visible('.pv-restart input[name=password]'),true)
  assert.match(await evaluate("document.querySelector('.pv-restart-text').textContent"),/FileVault ist an/)
  await evaluate("(()=>{const f=document.querySelector('.pv-restart-form');f.elements.user.value='anna';f.requestSubmit();return true})()")
  assert.match(await evaluate("document.querySelector('.pv-restart .pv-pin-error').textContent"),/Nutzername und Passwort/,'both or neither')
  // the dialog's typing stays in the viewer
  await evaluate("(()=>{const f=document.querySelector('.pv-restart-form');f.elements.password.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true}));f.elements.password.value='geheim';f.requestSubmit();return true})()")
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t!=='viewport')"),[{t:'restart',user:'anna',password:'geheim'}])
  assert.equal(await evaluate("document.querySelector('.pv-restart-form').elements.password.value"),'','password field cleared')
  await receive({t:'restart-error',error:'FileVault hat Nutzername oder Passwort nicht angenommen.'})
  assert.equal(await evaluate("document.querySelector('.pv-restart .pv-pin-error').textContent"),'FileVault hat Nutzername oder Passwort nicht angenommen.')
  await evaluate('qa.sent=[];true')
  await evaluate("(()=>{const f=document.querySelector('.pv-restart-form');f.elements.user.value='';f.requestSubmit();return true})()")
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t!=='viewport')"),[{t:'restart'}],'empty fields: plain restart')
  await receive({t:'restarting'})
  assert.equal(await visible('.pv-restart'),false)
  assert.match(await evaluate("document.querySelector('.pv-toast span').textContent"),/startet neu/)
  // not offered without the agent
  await receive(state({os:'macos'}))
  await browser('click','[data-special]')
  assert.deepEqual(await evaluate(items),macItems)
  await browser('press','Escape')
  // desk hints of a Mac
  await receive(state({os:'macos',desk:'login'}))
  assert.equal(await evaluate("document.querySelector('.pv-desk').textContent"),'Der Mac zeigt das Anmeldefenster.')
  await receive(state({os:'macos',desk:'locked'}))
  assert.equal(await evaluate("document.querySelector('.pv-desk').textContent"),'Der Mac ist gesperrt.')

  // leaving control mode hides button and menu
  await browser('click','[data-special]')
  await receive(state({os:'macos',mode:'view'}))
  assert.equal(await visible('[data-special]'),false)
  assert.equal(await visible('.pv-special'),false)

  // the host could not do it
  await receive(state())
  await receive({t:'special-error',k:'cad',error:'Strg+Alt+Entf braucht den Windows-Dienst.'})
  assert.equal(await evaluate("document.querySelector('.pv-toast span').textContent"),'Strg+Alt+Entf braucht den Windows-Dienst.')
  assert.equal(await visible('.pv-toast'),true)

  // desk hint: non-blocking, the picture stays
  await receive(state({desk:'login'}))
  assert.equal(await visible('.pv-desk'),true)
  assert.equal(await evaluate("document.querySelector('.pv-desk').textContent"),'Der Rechner zeigt den Anmeldebildschirm.')
  assert.equal(await visible('.pv-notice'),false,'the picture is not covered')
  await receive(state({desk:'secure'}))
  assert.equal(await evaluate("document.querySelector('.pv-desk').textContent"),'Windows zeigt eine Administrator-Abfrage.')
  await receive(state({desk:'locked'}))
  assert.equal(await evaluate("document.querySelector('.pv-desk').textContent"),'Der Rechner ist gesperrt.')
  await receive(state({desk:'normal'}))
  assert.equal(await visible('.pv-desk'),false)

  // keyboard: on a Mac viewer Cmd is the primary modifier (no Windows key)
  const press=(type,init)=>evaluate(`(()=>{const k=document.querySelector('.pv-keys');k.dispatchEvent(new KeyboardEvent('${type}',{bubbles:true,cancelable:true,...${JSON.stringify(init)}}));return true})()`)
  const macViewer=await evaluate("/Mac/.test(navigator.platform)")
  if(macViewer){
   await evaluate('qa.sent=[];true')
   await press('keydown',{key:'Meta',metaKey:true});await press('keydown',{key:'a',metaKey:true});await press('keyup',{key:'Meta'})
   assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t==='key'||m.t==='special')"),[{t:'key',key:'a',cmd:true,shift:false,alt:false,w:0}])
  }
  // a Windows/Linux viewer: the Windows key alone and held with another key
  await browser('open','http://127.0.0.1:'+server.address().port+'/fixture.html?win')
  await browser('wait','--fn','!!window.qa')
  assert.equal(await evaluate('navigator.platform'),'Win32')
  await receive({t:'welcome',id:1})
  await receive({t:'peers',list:[{id:0,host:true,name:'Host',color:'#ff0000'}]})
  await receive(state())
  await evaluate('qa.sent=[];true')
  await press('keydown',{key:'Meta',metaKey:true});await press('keyup',{key:'Meta'})
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t==='key'||m.t==='special')"),[{t:'special',k:'win',w:0}],'Windows key alone')
  await evaluate('qa.sent=[];true')
  await press('keydown',{key:'Meta',metaKey:true});await press('keydown',{key:'e',metaKey:true});await press('keyup',{key:'e',metaKey:true});await press('keyup',{key:'Meta'})
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t==='key'||m.t==='special')"),[{t:'key',key:'e',cmd:false,shift:false,alt:false,win:true,w:0}],'Windows+E')
  await evaluate('qa.sent=[];true')
  await press('keydown',{key:'Tab',altKey:true});await press('keydown',{key:'c',ctrlKey:true,altKey:false})
  assert.deepEqual(await evaluate("qa.sent.filter(m=>m.t==='key')"),[{t:'key',key:'Tab',cmd:false,shift:false,alt:true,w:0}],'Alt+Tab passes, Ctrl+C stays the viewer\'s copy')
 }finally{try{await browser('close')}finally{await new Promise(resolve=>server.close(resolve))}}
})
