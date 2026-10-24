// Actual Android sharing UI; bridge changes are simulated, not video privacy checks.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shim = `window.qa = {
  calls: [], reject: false,
  settings: { enabled:true, port:0, appsOnly:false, apps:[{id:'app.blue',name:'Blaue App',selected:true,shareable:true},{id:'app.red',name:'Rote App',selected:false,shareable:true},{id:'app.system',name:'System-App',selected:false,shareable:false}] },
  state: {sharing:false,shell:true,helperReady:true,shellSupported:true,appSharingSupported:true,notificationsAllowed:true,overlayAllowed:true,appVisible:true,mode:'view',viewers:[],requests:[],clip:[],link:'https://example.invalid/same-room'}
};
const own={id:'0000000000000000',email:'me@example.test',name:'Mein Handy',platform:'android'};
localStorage.setItem('pv-fixed-rooms-v1',JSON.stringify({api:'https://rooms.example.test/api.php',token:'test-token',device:own}));
window.fetch=async()=>Response.json({device:own,person:{id:'1111111111111111',email:own.email,devices:[own]},contacts:[],rooms:[],calls:[],invitations:[]});
window.PeekaViewHost = new Proxy({
 state:()=>JSON.stringify(qa.state), shellSettings:()=>JSON.stringify(qa.settings), keepLink:()=>false,hasPin:()=>false,
 shareViaLink:()=>{qa.state.fixedCall=null;window.pvHostUpdate(qa.state)},
 setSharedApps:(only,json)=>{
  qa.calls.push({method:'setSharedApps',only,apps:JSON.parse(json)});
  if(qa.reject){qa.reject=false;window.pvAppsResult('Auswahl fehlgeschlagen');return;}
  qa.settings.appsOnly=only;qa.state.appsOnly=only;
  qa.settings.apps.forEach(app=>app.selected=JSON.parse(json).includes(app.id));
  window.pvAppsResult('');window.pvHostUpdate(qa.state);
 }
},{get:(object,key)=>object[key]||((...args)=>qa.calls.push({method:key,args}))});`

test('Android app choices remain editable in the live share and never restart it', {timeout:90000}, async () => {
 const server=createServer(async(request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname
  const file=path==='/ui/share.html'?resolve(repo,'android/app/src/main/assets/ui/share.html'):resolve(repo,'.'+path)
  if(!file.startsWith(repo+sep)){response.writeHead(403).end();return}
  try{
   let body=await readFile(file)
   if(extname(file)==='.html')body=Buffer.from(body.toString().replace('<head>', '<head><script>'+shim+'</script>'))
   response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript'})[extname(file)]??'application/octet-stream');response.end(body)
  }catch{response.writeHead(404).end()}
 })
 const session='pv-android-selection-'+process.pid
 const browser=async(...args)=>(await promisify(execFile)('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000})).stdout
 const evaluate=async(code)=>JSON.parse(await browser('eval',code))
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  await browser('open', 'http://127.0.0.1:'+server.address().port+'/ui/share.html')
  await browser('set','viewport','393','852')
  await evaluate("qa.state.helperReady=false;qa.state.adbPaired=true;window.pvHostUpdate(qa.state);true")
  assert.equal(await evaluate("document.querySelector('#start').textContent"),'Freigabe starten')
  await browser('click','#start')
  assert.equal(await evaluate("qa.calls.at(-1).method"),'start')
  assert.equal(await evaluate("qa.calls.some(c=>c.method==='adbSetup')"),false)
  await evaluate("qa.state.starting=true;qa.state.adbSetup={active:true,phase:'searching',message:'Android-Verbindung vorbereiten'};window.pvHostUpdate(qa.state);true")
  assert.equal(await evaluate("document.querySelector('#adb-cancel').hidden"),false)
  assert.equal(await evaluate("document.querySelector('#start').disabled"),true)
  await browser('click','#adb-cancel')
  assert.equal(await evaluate('qa.calls.at(-1).method'),'adbSetupStop')
  await evaluate("qa.calls=[];qa.state.starting=false;qa.state.helperReady=true;qa.state.adbSetup={active:false,phase:'ready'};window.pvHostUpdate(qa.state);true")
  await browser('click','#shell-app-options summary')
  await browser('check','#apps-only')
  assert.equal(await evaluate("document.querySelector('[value=\"app.system\"]').disabled"),true)
  await evaluate("qa.state.sharing=true;window.pvHostUpdate(qa.state);true")
  await browser('set','viewport','360','800')
  assert.equal(await evaluate("document.querySelector('header #profile summary').getBoundingClientRect().right<=innerWidth"),true)
  await browser('click','header #profile summary')
  assert.equal(await evaluate("document.querySelector('.fr-profile-device').textContent.includes('Dieses Gerät')"),true)
  await browser('press','Escape')
  assert.equal(await evaluate("document.querySelector('#running-apps #shell-app-options')!==null"),true)
  await browser('check','input[value="app.red"]')
  await browser('uncheck','input[value="app.blue"]')
  assert.deepEqual(await evaluate('qa.calls.at(-1)'),{method:'setSharedApps',only:true,apps:['app.red']})
  assert.equal(await evaluate("document.querySelector('#link').textContent"),'https://example.invalid/same-room')
  await browser('uncheck','input[value="app.red"]')
  assert.deepEqual(await evaluate('qa.calls.at(-1).apps'),[])
  await evaluate('qa.state.appVisible=false;window.pvHostUpdate(qa.state);true')
  assert.equal(await evaluate("document.querySelector('#apps-visibility').hidden"),false)
  await evaluate('qa.reject=true')
  await browser('click','input[value="app.blue"]')
  assert.equal(await evaluate("document.querySelector('#apps-error').hidden"),false)
  assert.equal(await evaluate("document.querySelector('input[value=\"app.blue\"]').checked"),false)
  assert.equal(await evaluate("document.querySelector('#app-selection').disabled"),false)
  assert.equal(await evaluate("qa.calls.some(call=>['start','stop'].includes(call.method))"),false)
  assert.equal(await evaluate("document.querySelectorAll('#app-choices').length"),1)
  await evaluate('qa.state.sharing=false;window.pvHostUpdate(qa.state);true')
  assert.equal(await evaluate("document.querySelector('#setup-apps #shell-app-options')!==null"),true)
  // Disabling the helper must not turn a requested app-only share into a full-screen share.
  await browser('uncheck','#shell')
  assert.equal(await evaluate("document.querySelector('#shell-app-options').hidden"),false)
  await browser('click','#start')
  assert.equal(await evaluate("qa.calls.findLast(c=>c.method==='start').args.at(-1)"),true)
  await browser('click','#share-group')
  await browser('open', 'http://127.0.0.1:'+server.address().port+'/ui/share.html')
  await browser('wait','#fixed-rooms')
  assert.equal(await evaluate("document.querySelector('#setup').hidden"),true)
  assert.equal(await evaluate("document.querySelector('#fixed-rooms').hidden"),false)
  assert.equal(await evaluate("[...document.querySelectorAll('#fixed-rooms input[type=email]')].every(input=>!input.checkVisibility())"),true)
  await evaluate('window.pvHostUpdate(qa.state);true')
  assert.equal(await evaluate("document.querySelector('#setup').hidden"),true)
  await evaluate("qa.state.fixedCall='0123456789abcdef';window.pvShareInCall();true")
  assert.equal(await evaluate("document.querySelector('#setup').hidden"),false)
  assert.equal(await evaluate("document.querySelector('#fixed-rooms').hidden"),true)
  assert.equal(await evaluate("document.querySelector('#group-context').hidden"),false)
  assert.equal(await evaluate("document.querySelector('#share-options').hidden"),true)
  assert.equal(await evaluate("document.querySelector('#share-group').getAttribute('aria-pressed')"),'true')
  await browser('click','#change-group')
  assert.equal(await evaluate("document.querySelector('#fixed-rooms').hidden"),false)
  await browser('click','#share-link')
  await browser('open', 'http://127.0.0.1:'+server.address().port+'/ui/share.html')
  await browser('wait','#setup')
  assert.equal(await evaluate("document.querySelector('#setup').hidden"),false)
  assert.equal(await evaluate("document.querySelector('#share-options').hidden"),false)
  assert.equal(await evaluate('qa.state.fixedCall ?? null'),null)
 }finally{try{await browser('close')}finally{await new Promise(resolve=>server.close(resolve))}}
})
