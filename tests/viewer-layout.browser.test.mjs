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
   if(path==='/viewer.js')content=Buffer.from(content.toString()
    .replace("  setTool('point')\n  update('connecting')", "  window.qa = {wm, receive: onText, sent: []}\n  setTool('point')\n  update('connecting')")
    .replace("const send = (m) => dc?.readyState === 'open' && dc.send(JSON.stringify(m))", "const send = (m) => {window.qa?.sent.push(m);return dc?.readyState === 'open' && dc.send(JSON.stringify(m))}"))
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
  // Host foreground, not local viewer focus, determines where pointing and drawing work.
  await browser('click','.pv-fold');await settle()
  const foreground=state(4,{mode:'draw'})
  foreground.windows[0].front=true
  foreground.windows[1].front=false;foreground.windows[1].reachable=true
  foreground.windows[2].front=false;foreground.windows[2].reachable=false
  foreground.windows[3].front=true;foreground.windows[3].paused=true
  await evaluate(`qa.receive(${JSON.stringify(foreground)});qa.sent=[];
   qa.pointer=(slot,type)=>{const view=qa.wm.wins.get(slot).view,r=view.getBoundingClientRect();view.setPointerCapture=()=>{};view.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:9,button:0}))};true`)
  await settle()
  assert.deepEqual(await evaluate('qa.wm.list.map(w=>w.el.classList.contains("covered"))'),[false,true,true,false])
  await browser('wait','--fn','getComputedStyle(qa.wm.wins.get(1).video).filter.includes("grayscale(1)")')
  assert.equal(await evaluate('getComputedStyle(qa.wm.wins.get(1).view).cursor'),'not-allowed')
  await evaluate("qa.wm.focus(1);for(const w of qa.wm.list){qa.pointer(w.slot,'pointerdown');qa.pointer(w.slot,'pointerup')};true")
  assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="ping").map(m=>m.w)'),[0])
  assert.equal(await evaluate('qa.wm.canAnnotate(qa.wm.wins.get(1))'),false)
  await evaluate("for(const w of [0,1,2,3])for(const t of ['ptr','ping','draw'])qa.receive({t,from:2,w,x:.2,y:.3,s:'start'});true")
  assert.equal(await evaluate('qa.wm.wins.get(0).ann.active.has(2)'),true)
  assert.equal(await evaluate('qa.wm.list.slice(1).every(w=>!w.ann.active.size && !w.ann.cursors.size && !w.ann.root.querySelector(".pv-ping"))'),true)
  await browser('click','.pv-dock [data-tool="draw"]')
  await evaluate("qa.sent=[];qa.pointer(0,'pointerdown');true")
  assert.equal(await evaluate('qa.wm.wins.get(0).ann.active.has(1)'),true)
  foreground.windows[0].front=false
  await evaluate(`qa.receive(${JSON.stringify(foreground)});qa.pointer(0,'pointermove');qa.pointer(0,'pointerup');true`)
  assert.equal(await evaluate('qa.wm.wins.get(0).ann.strokes.length===0 && qa.wm.wins.get(0).ann.cursors.size===0 && !qa.wm.wins.get(0).ann.root.querySelector(".pv-ping")'),true)
  assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="draw").map(m=>m.s)'),['start'])
  foreground.windows[0].front=true
  await evaluate(`qa.receive(${JSON.stringify(foreground)});qa.pointer(0,'pointermove');qa.pointer(0,'pointerup');true`)
  assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="draw").map(m=>m.s)'),['start'],'A covered gesture cannot resume after the host brings the window back')
  await evaluate("qa.pointer(0,'pointerdown');qa.pointer(0,'pointerup');true")
  assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="draw").map(m=>m.s)'),['start','start','end'])
  // Remote control keeps its existing host-side input guard and can still activate a window.
  await evaluate(`qa.receive(${JSON.stringify({...foreground,mode:'control'})});qa.sent=[];qa.pointer(1,'pointerdown');qa.pointer(1,'pointerup');true`)
  assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="mouse").map(m=>m.a)'),['down','up'])
  // An explicit title-bar click can raise a background window with arrangement permission,
  // including while watching or annotating. Only a new host state unlocks annotations.
  await evaluate(`qa.titlePointer=(type,selector='.pv-win-bar',dx=0,id=11)=>{const bar=qa.wm.wins.get(1).el.querySelector(selector),r=bar.getBoundingClientRect();bar.setPointerCapture=()=>{};bar.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:r.left+15+dx,clientY:r.top+10,pointerId:id,button:0}))};true`)
  for(const mode of ['view','draw','control']){
   await evaluate(`qa.receive(${JSON.stringify({...foreground,mode,resize:true})});qa.wm.wins.get(1).activated=0;qa.sent=[];qa.titlePointer('pointerdown');qa.titlePointer('pointerup');true`)
   assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="activate").map(m=>m.w)'),[1],mode)
   assert.equal(await evaluate('qa.wm.wins.get(1).el.classList.contains("covered") && !qa.wm.canAnnotate(qa.wm.wins.get(1))'),true)
   assert.equal(await evaluate('qa.wm.wins.get(1).el.querySelector(".pv-win-bar").title'),'Bei der teilenden Person in den Vordergrund holen')
  }
  await evaluate(`qa.receive(${JSON.stringify({...foreground,mode:'draw',resize:false})});qa.wm.wins.get(1).activated=0;qa.sent=[];qa.titlePointer('pointerdown');qa.titlePointer('pointerup');true`)
  assert.equal(await evaluate('qa.sent.some(m=>m.t==="activate")'),false)
  assert.equal(await evaluate('qa.wm.wins.get(1).el.querySelector(".pv-win-bar").title'),'')
  await evaluate(`qa.receive(${JSON.stringify({...foreground,mode:'draw',resize:true})});qa.sent=[];qa.pointer(1,'pointerdown');qa.pointer(1,'pointerup');true`)
  assert.equal(await evaluate('qa.sent.some(m=>m.t==="activate" || m.t==="ping" || m.t==="draw")'),false,'The gray picture itself does not activate or annotate')
  await evaluate("qa.titlePointer('pointerdown');qa.titlePointer('pointercancel');qa.titlePointer('pointerup');true")
  assert.equal(await evaluate('qa.sent.some(m=>m.t==="activate")'),false,'Canceled gestures cannot activate a window')
  await evaluate("qa.titlePointer('pointerdown');qa.titlePointer('pointermove','.pv-win-bar',40);qa.titlePointer('pointerup','.pv-win-bar',40);true")
  assert.equal(await evaluate('qa.sent.some(m=>m.t==="activate" || m.t==="arrange")'),false,'Dragging a local preview is not a host activation click')
  await evaluate("qa.titlePointer('pointerdown','[data-min]');qa.titlePointer('pointerup','[data-min]');true")
  assert.equal(await evaluate('qa.sent.some(m=>m.t==="activate")'),false,'Minimize and resize controls do not activate the host window')
  await evaluate(`qa.receive(${JSON.stringify({...foreground,mode:'draw',resize:true,windows:foreground.windows.map(w=>({...w,front:true,reachable:true,paused:false}))})});qa.sent=[];qa.pointer(1,'pointerdown');qa.pointer(1,'pointerup');true`)
  assert.equal(await evaluate('qa.wm.canAnnotate(qa.wm.wins.get(1)) && qa.sent.some(m=>m.t==="ping" && m.w===1)'),true,'The host foreground update unlocks annotations')
  await evaluate(`qa.receive(${JSON.stringify(state(1,{mode:'draw',windows:[{w:0,kind:'screen',title:'Phone',pw:720,ph:1600}]}))});qa.sent=[];qa.pointer(0,'pointerdown');qa.pointer(0,'pointerup');true`)
  assert.deepEqual(await evaluate('qa.sent.filter(m=>m.t==="ping").map(m=>m.w)'),[0],'Shared screens without window foreground metadata remain usable')
  // Embedding in part of a page keeps the toolbar at the viewer edge, not the page edge.
  await evaluate("Object.assign(document.querySelector('#viewer').style,{position:'absolute',top:'65px',left:'80px',width:'620px',height:'420px'});true");await settle()
  assert.equal(await evaluate("Math.round(document.querySelector('.pv-dock').getBoundingClientRect().top-document.querySelector('#viewer').getBoundingClientRect().top)"),12)
  assert.deepEqual(await evaluate('[document.documentElement.scrollWidth,document.documentElement.scrollHeight]'),[1280,900])
 }finally{try{await browser('close')}finally{await new Promise(resolve=>server.close(resolve))}}
})
