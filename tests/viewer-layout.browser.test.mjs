// Actual viewer and window manager; only incoming signaling/video events are simulated.
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
<body><div id="viewer"></div><script type="module">
import {mountViewer} from '/viewer.js';
localStorage.setItem('pv-dock',JSON.stringify({x:.3,y:.9,collapsed:false}));
window.viewer=mountViewer(document.querySelector('#viewer'),{room:'',name:'Viewer',voice:false});
</script></body></html>`

test('viewer toolbar stays at the top; initial windows fit below it without scrollbars', {timeout:120000}, async () => {
 const server=createServer(async(request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname
  if(path==='/fixture.html'){response.setHeader('Content-Type','text/html');response.end(fixture);return}
  const file=resolve(web,'.'+path)
  if(!file.startsWith(web+sep)){response.writeHead(403).end();return}
  try{
   let content=await readFile(file)
   if(path==='/viewer.js')content=Buffer.from(content.toString().replace("  setTool('point')\n  update('connecting')", "  window.qa = {wm, receive: onText}\n  setTool('point')\n  update('connecting')"))
   response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');response.end(content)
  }catch{response.writeHead(404).end()}
 })
 const session='pv-viewer-layout-'+process.pid
 const browser=async(...args)=>(await promisify(execFile)('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000})).stdout
 const evaluate=async(code)=>JSON.parse(await browser('eval',code))
 const settle=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))')
 const state=(count,extra={})=>({t:'state',mode:'control',title:'Shared desktop',windows:Array.from({length:count},(_,w)=>({w,kind:'window',app:'Application '+w,title:'Window '+w,pw:3200,ph:2200,rect:{x:w*60,y:w*50,w:1600,h:1100},z:w})),...extra})
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  await browser('open','http://127.0.0.1:'+server.address().port+'/fixture.html')
  await browser('wait','--fn','!!window.qa')
  await evaluate("qa.receive({t:'welcome',id:1});qa.receive({t:'peers',list:[{id:0,host:true,name:'Host',color:'#ff0000'}]});true")
  for(const [width,height] of [[1280,900],[640,480],[393,852],[844,390]]){
   await browser('set','viewport',String(width),String(height))
   for(const count of [1,4]){
    await evaluate(`qa.receive(${JSON.stringify(state(count))});document.querySelector('video').dispatchEvent(new Event('loadeddata'));true`)
    await settle()
    const geometry=await evaluate(`(()=>{
     const v=document.querySelector('#viewer').getBoundingClientRect(),d=document.querySelector('.pv-dock').getBoundingClientRect();
     return {dockTop:d.top-v.top,dockLeft:d.left-v.left,dockRight:d.right-v.left,space:qa.wm.area(true).top,
      wins:qa.wm.list.map(w=>{const r=w.el.getBoundingClientRect();return {top:r.top-v.top,bottom:r.bottom-v.top,left:r.left-v.left,right:r.right-v.left}}),
      scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],overflow:getComputedStyle(document.querySelector('.pv-stage')).overflow}
    })()`)
    assert.equal(geometry.dockTop,12)
    assert.equal(await evaluate("!!document.querySelector('.pv-dock .pv-status') && !document.querySelector('.pv-top')"),true)
    assert.equal(await evaluate("document.querySelector('.pv-mode').getAttribute('aria-label')"),'Steuern')
    assert.equal(await evaluate("document.querySelector('.pv-live').title"),'Shared desktop')
    assert.equal(await evaluate("Math.ceil(document.querySelector('.pv-dock').getBoundingClientRect().bottom+12)"),geometry.space)
    assert.ok(geometry.dockLeft>=0 && geometry.dockRight<=width)
    assert.deepEqual(geometry.scroll,[width,height])
    assert.equal(geometry.overflow,'hidden')
    for(const win of geometry.wins){
     assert.ok(win.top>=geometry.space-1,JSON.stringify({width,height,count,geometry}))
     assert.ok(win.bottom<=height+1 && win.left>=-1 && win.right<=width+1,JSON.stringify({width,height,count,geometry}))
    }
   }
  }
  if (process.env.PV_VIEWER_SCREENSHOT) await browser('screenshot',process.env.PV_VIEWER_SCREENSHOT)
  // A manually moved window may occupy the toolbar's space; the toolbar still receives clicks.
  await browser('set','viewport','1280','900')
  await evaluate(`qa.receive(${JSON.stringify(state(2))});true`);await settle()
  await evaluate(`(()=>{const b=qa.wm.list[0].el.querySelector('.pv-win-bar'),r=b.getBoundingClientRect();
   b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+15,clientY:r.top+15,pointerId:1}));
   b.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+15,clientY:15,pointerId:1}));
   b.dispatchEvent(new PointerEvent('pointerup',{clientX:r.left+15,clientY:15,pointerId:1}));return true})()`)
  assert.equal(await evaluate('Math.round(qa.wm.list[0].el.getBoundingClientRect().top)'),0)
  await evaluate('qa.wm.list[0].el.style.zIndex="999999999";true')
  assert.equal(await evaluate(`(()=>{const d=document.querySelector('.pv-dock'),r=d.getBoundingClientRect();return !!document.elementFromPoint(r.left+20,r.top+20)?.closest('.pv-dock')})()`),true)
  // The avatars remain at the right edge but can be covered by a shared window.
  await evaluate(`(()=>{const w=qa.wm.list[0],p=document.querySelector('.pv-peers li').getBoundingClientRect();
   w.x=p.right-w.el.offsetWidth;w.y=0;qa.wm.paint(w);return true})()`)
  assert.equal(await evaluate(`(()=>{const p=document.querySelector('.pv-peers li').getBoundingClientRect();return !!document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.closest('.pv-win')})()`),true)
  await browser('click','.pv-fold');await settle()
  assert.equal(await evaluate('Math.round(qa.wm.list[0].el.getBoundingClientRect().top)'),0)
  assert.equal(await evaluate("Math.round(document.querySelector('.pv-dock').getBoundingClientRect().top)"),12)
  // Safety status remains visible when the controls are collapsed.
  await evaluate(`qa.receive(${JSON.stringify(state(2,{recording:true,reachable:false}))});true`);await settle()
  assert.equal(await evaluate("document.querySelector('.pv-rec').getBoundingClientRect().width>0 && document.querySelector('.pv-paused').getBoundingClientRect().width>0"),true)
  assert.equal(await evaluate("document.querySelector('.pv-mode').getBoundingClientRect().width"),0)
  // Mirror mode and a phone's soft navigation also use the unobscured initial area.
  await evaluate(`qa.receive(${JSON.stringify(state(2,{resize:true,screens:[{x:0,y:0,w:1920,h:1080}]}))});true`);await settle()
  assert.equal(await evaluate('qa.wm.list.every(w=>w.y>=qa.wm.area(true).top-1)'),true)
  await evaluate(`qa.receive(${JSON.stringify(state(1,{windows:[{w:0,kind:'screen',title:'Phone',pw:720,ph:1600,nav:true}]}))});true`);await settle()
  assert.equal(await evaluate("document.querySelector('.pv-nav').getBoundingClientRect().bottom<=innerHeight+1"),true)
  // Embedding in part of a page keeps the toolbar at the viewer edge, not the page edge.
  await evaluate("Object.assign(document.querySelector('#viewer').style,{position:'absolute',top:'65px',left:'80px',width:'620px',height:'420px'});true");await settle()
  assert.equal(await evaluate("Math.round(document.querySelector('.pv-dock').getBoundingClientRect().top-document.querySelector('#viewer').getBoundingClientRect().top)"),12)
  assert.deepEqual(await evaluate('[document.documentElement.scrollWidth,document.documentElement.scrollHeight]'),[1280,900])
 }finally{try{await browser('close')}finally{await new Promise(resolve=>server.close(resolve))}}
})
