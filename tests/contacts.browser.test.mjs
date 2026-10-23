// Real shared contact UI with an isolated room API; never sends mail or opens capture.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web')
const device = { id: '0000000000000000', email: 'me@example.test', name: 'Mein Computer' }
const contacts = Array.from({length:8}, (_,i) => ({id:String(i+1).padStart(16,'0'),email:`kontakt${i+1}@example.test`,name:`Kontakt ${i+1}`,devices:[{id:String(i+101).padStart(16,'0'),name:`Gerät ${i+1}`,platform:['desktop','android','browser'][i%3]},{id:String(i+201).padStart(16,'0'),name:`Handy ${i+1}`,platform:'android'}],last_used:100-i}))
const rooms = Array.from({length:7}, (_,i) => ({id:String(i+11).padStart(16,'0'),name:`Gruppe ${i+1}`,owner:device.id,can_manage:true,participants:[device,{...contacts[i].devices[0],email:contacts[i].email}],people:[{id:device.id,name:'Ich',email:device.email,devices:[device]},contacts[i]],last_used:100-i}))
const fixture = `<!doctype html><html lang="de"><meta charset="utf-8"><link rel="stylesheet" href="/fixed-rooms.css"><style>body{background:#09090b;padding:20px;max-width:660px}</style><main></main>
<script>
window.qa={requests:[],opened:[],native:[],state:${JSON.stringify({device,contacts,rooms,calls:[]})}};
if(new URLSearchParams(location.search).has('call') || new URLSearchParams(location.search).has('joined'))qa.state.calls=[{id:'1234567890abcdef',room:qa.state.rooms[0].id,name:'Gruppe 1',kind:'group',status:'joined',secret:'isolated-test-secret',voice_id:1,participants:[{...qa.state.device,voice_id:1,voice:0}],requests:[{...qa.state.contacts[7].devices[0],email:qa.state.contacts[7].email,person_name:qa.state.contacts[7].name}]}];
localStorage.setItem('pv-fixed-rooms-v1',JSON.stringify({api:'https://rooms.example.test/api.php',token:'test-token',device:qa.state.device}));
window.__TAURI__={core:{invoke:async(cmd,args)=>{
 qa.native.push({cmd,args});
 if(cmd==='fixed_access_options')return {screens:[{id:'screen:1',name:'Bildschirm 1'}],apps:[{id:'/Example.app',name:'Beispiel-App'}],selection:{screens:[],apps:[]}};
 if(cmd==='fixed_access_configure'){qa.state.rooms.find(r=>r.id===args.room).unattended=args.selection.enabled;qa.state.rooms.find(r=>r.id===args.room).pin_required=args.selection.enabled;}
}},event:{listen:async()=>()=>{}}};
window.fetch=async(url,options)=>{
 const action=new URL(url).searchParams.get('action');
 qa.requests.push({action,body:options.body?JSON.parse(options.body):null});
 if(action==='rooms/settings')qa.state.rooms.find(r=>r.id===JSON.parse(options.body).room).pin=JSON.parse(options.body).pin_enabled;
 if(action==='rooms/add-contact'){const body=JSON.parse(options.body);qa.state.rooms.find(r=>r.id===body.room).people.push(qa.state.contacts.find(c=>c.id===body.person));}
 if(action==='calls/admit'){const body=JSON.parse(options.body);qa.state.calls[0].requests=qa.state.calls[0].requests.filter(p=>p.id!==body.device);}
 if(action==='invitation/preview' && new URLSearchParams(location.search).get('invite')==='verify')return new Response(JSON.stringify({kind:'device',email:qa.state.device.email,next_action:'contact'}),{headers:{'Content-Type':'application/json'}});
 if(action==='invitation/accept' && new URLSearchParams(location.search).get('invite')==='verify')return new Response(JSON.stringify({token:'test-token',device:qa.state.device,next_action:'contact'}),{headers:{'Content-Type':'application/json'}});
 if(action==='invitation/preview')return new Response(JSON.stringify({kind:'group',sender_name:'Anna',sender_email:'anna@example.test',name:'Gruppe 1',email:'me@example.test',room:qa.state.rooms[0].id}),{headers:{'Content-Type':'application/json'}});
 if(action==='invitation/accept'){
   qa.state.calls=[{id:'1234567890abcdef',room:qa.state.rooms[0].id,name:'Gruppe 1',kind:'group',status:'requested',voice_id:1,participants:[],requests:[]}];
   return new Response(JSON.stringify({token:'test-token',device:qa.state.device,request_call:'1234567890abcdef'}),{headers:{'Content-Type':'application/json'}});
 }
 return new Response(JSON.stringify(action==='state'?qa.state:{id:'1234567890abcdef'}),{headers:{'Content-Type':'application/json'}});
};
if(new URLSearchParams(location.search).has('signup'))localStorage.setItem('pv-fixed-rooms-v1',JSON.stringify({api:'https://rooms.example.test/api.php'}));
if(new URLSearchParams(location.search).has('browser'))delete window.__TAURI__;
</script><script type="module">import {Signaling} from '/signal.js';Signaling.open=async()=>({send(){},close(){}});import {mountRooms} from '/fixed-rooms.js';const ui=mountRooms(document.querySelector('main'),{callId:new URLSearchParams(location.search).get('call')||'',invitation:new URLSearchParams(location.search).get('invite')||'',onOpen:async id=>qa.opened.push(id)});qa.refresh=ui.refresh;</script></html>`

test('contacts and groups show five each, expand independently and call the chosen destination', {timeout:90000}, async () => {
  const server=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname
    if(path==='/contacts.html'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture);return}
    const file=resolve(web,'.'+path)
    if(!file.startsWith(web+sep)){response.writeHead(403).end();return}
    try {response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');response.end(await readFile(file))}
    catch {response.writeHead(404).end()}
  })
  const session=`pv-contacts-${process.pid}`
  const browser=async(...args)=>(await promisify(execFile)('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000})).stdout
  const evaluate=async(code)=>JSON.parse(await browser('eval',code))
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    await browser('open',`http://127.0.0.1:${server.address().port}/contacts.html`)
    await browser('wait','.fr-contact')
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.fr-collection > h3'),el=>el.textContent)"),['Kontakte','Gruppen'])
    assert.equal(await evaluate("document.querySelectorAll('.fr-contact').length"),5)
    assert.equal(await evaluate("document.querySelectorAll('.fr-room').length"),5)
    assert.equal(await evaluate("document.querySelector('.fr-contact strong').textContent"),'Kontakt 1')
    assert.equal(await evaluate("document.querySelector('.fr-contact .fr-badge')===null"),true)
    assert.equal(await evaluate("document.querySelector('.fr-person .fr-person-details').hidden"),true)
    await browser('click','.fr-person:first-of-type .fr-group-toggle')
    assert.equal(await evaluate("document.querySelector('.fr-person .fr-person-details').textContent.includes('Handy 1')"),true)
    assert.equal(await evaluate("document.querySelectorAll('.fr-contact .fr-avatar').length"),5)
    await browser('set','viewport','393','852')
    await browser('screenshot','/tmp/peekaview-kontakte-personen.png')
    assert.equal(await evaluate("document.querySelector('.fr-person').getBoundingClientRect().right<=innerWidth"),true)
    await browser('set','viewport','800','900')
    assert.equal(await evaluate("document.querySelector('.fr-room').getBoundingClientRect().height <= 56"),true)
    await browser('click','.fr-collection:nth-of-type(1) .fr-expand')
    assert.equal(await evaluate("document.querySelectorAll('.fr-contact').length"),8)
    assert.equal(await evaluate("document.querySelectorAll('.fr-room').length"),5)
    await browser('click','.fr-collection:nth-of-type(2) .fr-expand')
    assert.equal(await evaluate("document.querySelectorAll('.fr-room').length"),7)
    await evaluate('qa.refresh().then(()=>true)')
    assert.equal(await evaluate("document.querySelectorAll('.fr-contact').length"),8)
    await browser('click','.fr-collection:nth-of-type(1) .fr-expand')
    assert.equal(await evaluate("document.querySelectorAll('.fr-contact').length"),5)
    await browser('click','.fr-contact:first-of-type')
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='calls/direct').body"),{person:contacts[0].id})
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='calls/start')"),false)
    assert.deepEqual(await evaluate('qa.opened'),['1234567890abcdef'])
    assert.equal(await evaluate("qa.native.some(r=>r.cmd==='fixed_share_picker')"),true)
    await browser('click','.fr-room:first-of-type .fr-group-toggle')
    await browser('select','.fr-room:first-of-type [aria-label="Kontakt zur Gruppe hinzufügen"]',contacts[1].id)
    await browser('scrollintoview','.fr-room:first-of-type .fr-add-contact button')
    await browser('click','.fr-room:first-of-type .fr-add-contact button')
    assert.equal(await evaluate("document.querySelector('.fr-error').textContent"),'')
    await browser('wait','--fn',"qa.requests.some(r=>r.action==='rooms/add-contact')")
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='rooms/add-contact').body"),{room:rooms[0].id,person:contacts[1].id})
    await browser('check','.fr-room:first-of-type .fr-access-settings > label input')
    assert.equal(await evaluate("document.querySelector('.fr-error').textContent"),'')
    assert.equal(await evaluate("document.querySelector('.fr-notice').textContent.includes('mindestens 6')"),true)
    assert.equal(await evaluate("qa.native.some(c=>c.cmd==='fixed_access_options')"),false)
    const pinToggle='.fr-room:first-of-type .fr-access-settings form input[type="checkbox"]'
    await browser('check',pinToggle)
    await browser('fill','.fr-room:first-of-type [aria-label="Gruppen-PIN"]','12345')
    await browser('scrollintoview','.fr-room:first-of-type .fr-access-settings form button')
    await browser('click','.fr-room:first-of-type .fr-access-settings form button')
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='rooms/settings')"),false)
    await browser('fill','.fr-room:first-of-type [aria-label="Gruppen-PIN"]','Test!6')
    await browser('click','.fr-room:first-of-type .fr-access-settings form button')
    await browser('wait','--fn',"qa.state.rooms[0].pin === true")
    await browser('wait','.fr-access-selection input[type="checkbox"]')
    assert.equal(await evaluate("document.querySelector('.fr-access-selection .fr-primary').disabled"),true)
    await browser('check','.fr-access-selection input[value="/Example.app"]')
    await browser('fill','.fr-access-selection input[type="search"]','unbekannt')
    assert.equal(await evaluate("document.querySelector('.fr-access-selection input[value=\"/Example.app\"]').closest('label').hidden"),true)
    await browser('fill','.fr-access-selection input[type="search"]','')
    await browser('scrollintoview','.fr-access-selection .fr-primary')
    await browser('click','.fr-access-selection .fr-primary')
    assert.deepEqual(await evaluate("qa.native.find(c=>c.cmd==='fixed_access_configure').args.selection"),{enabled:true,screens:[],apps:['/Example.app']})
    assert.equal(await evaluate("document.querySelector('.fr-room:first-of-type .fr-access-settings form input[type=checkbox]').disabled"),true)
    await browser('click','.fr-room-name')
    await browser('wait','.fr-pin-dialog')
    await browser('fill','.fr-pin-dialog input','Test!6')
    await browser('click','.fr-pin-dialog .fr-primary')
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='calls/start').body"),{room:rooms[0].id,pin:'Test!6'})
    assert.equal(await evaluate("localStorage.getItem('pv-fixed-rooms-v1').includes('Test!6')"),false)
    await browser('click','.fr-room-name')
    await browser('wait','.fr-pin-dialog')
    await browser('click','.fr-pin-dialog button[type="button"]')
    assert.equal(await evaluate("qa.requests.filter(r=>r.action==='calls/start').length"),1)
    await browser('open',`http://127.0.0.1:${server.address().port}/contacts.html?call=1234567890abcdef`)
    await browser('wait','.fr-admissions .fr-ring')
    assert.equal(await evaluate("document.querySelector('.fr-admissions').textContent.includes('Zu diesem Gespräch zulassen?')"),true)
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='calls/admit')"),false)
    await browser('click','.fr-admissions button:first-of-type')
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='calls/admit').body"),{call:'1234567890abcdef',device:contacts[7].devices[0].id,allow:false})
    await evaluate('qa.state.calls[0].requests=[{...qa.state.contacts[6].devices[0],email:qa.state.contacts[6].email,person_name:qa.state.contacts[6].name}];qa.refresh().then(()=>true)')
    await browser('click','.fr-admissions .fr-primary')
    assert.deepEqual(await evaluate("qa.requests.filter(r=>r.action==='calls/admit').at(-1).body"),{call:'1234567890abcdef',device:contacts[6].devices[0].id,allow:true})
    await browser('click','.fr-call-invite > details > summary')
    await browser('select','.fr-call-invite select',contacts[2].id)
    await browser('click','.fr-call-invite .fr-add-contact button')
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='rooms/add-contact').body"),{room:rooms[0].id,person:contacts[2].id})
    assert.equal(await evaluate("qa.native.some(r=>r.cmd==='fixed_share_picker')"),false)
    await browser('open',`http://127.0.0.1:${server.address().port}/contacts.html?joined=1`)
    await browser('wait','.fr-room-name')
    await browser('click','.fr-room-name')
    assert.deepEqual(await evaluate('qa.opened'),['1234567890abcdef'])
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='calls/start') || qa.native.some(r=>r.cmd==='fixed_share_picker')"),false)
    await evaluate("qa.state.calls[0].kind='contact';qa.state.calls[0].contact_id=qa.state.contacts[0].id;qa.refresh().then(()=>true)")
    await browser('click','.fr-contact:first-of-type')
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='calls/direct')"),false)
    await browser('open',`http://127.0.0.1:${server.address().port}/contacts.html?signup=1`)
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    await browser('find','role','button','click','--name','Person einladen')
    await browser('fill','input[type="email"]','new@example.test')
    await browser('click','form button')
    await browser('wait','--text','Prüfe deine E-Mails')
    assert.equal(await evaluate("document.querySelector('.fr-error').textContent"),'')
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='device/request').body"),{email:'new@example.test',next_action:'contact'})
    await browser('open',`http://127.0.0.1:${server.address().port}/contacts.html?signup=1&browser=1&invite=verify`)
    await browser('wait','form button')
    await browser('click','form button')
    await browser('wait','.fr-invite-contact[open] input[type=email]')
    await browser('fill','.fr-invite-contact input','friend@example.test')
    await browser('click','.fr-invite-contact button')
    await browser('wait','--text','Einladung an friend@example.test gesendet.')
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='contacts/invite').body"),{email:'friend@example.test'})
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='device/request' || r.action==='rooms/create')"),false)
    await browser('click','.fr-new-group summary')
    await browser('fill','.fr-new-group input[type=text]','Familie')
    await browser('check',`.fr-new-group input[value="${contacts[0].id}"]`)
    await browser('click','.fr-new-group button')
    assert.deepEqual(await evaluate("qa.requests.find(r=>r.action==='rooms/create').body"),{name:'Familie',people:[contacts[0].id]})
    await browser('open',`http://127.0.0.1:${server.address().port}/contacts.html?browser=1&invite=link-test`)
    await browser('wait','form button')
    assert.equal(await evaluate("document.querySelector('input[type=text]').closest('details').open"),false)
    await browser('click','form button')
    await browser('wait','--text','Warte auf Zulassung')
    await evaluate("qa.state.calls[0].status='joined';qa.state.calls[0].secret='approved-test-secret';qa.state.calls[0].participants=[{...qa.state.device,voice_id:1,voice:0}];qa.refresh().then(()=>true)")
    await browser('wait','.fr-call')
    assert.equal(await evaluate("qa.requests.some(r=>r.action==='calls/join')"),false)
    assert.equal(await evaluate("document.querySelector('.fr-mic').textContent"),'Mikrofon aus')
  } finally {try {await browser('close')} finally {await new Promise(resolve=>server.close(resolve))}}
})
