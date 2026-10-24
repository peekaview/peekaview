// Actual home page; mail and signaling are isolated so no invitations or captures leave this test.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {dirname,extname,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import test from 'node:test'

const web=resolve(dirname(fileURLToPath(import.meta.url)),'../web')
const room='a'.repeat(22)+'.'+'b'.repeat(43)
const own={id:'0000000000000000',email:'own@example.test',name:'Mein Browser',platform:'browser'}
const state={device:own,person:{id:'1111111111111111',email:own.email,name:'Ich',devices:[own]},contacts:[],rooms:[],calls:[],invitations:[]}
const shim=`<script>window.qa={requests:[]};const pageFetch=window.fetch;window.fetch=async(url,options)=>{if(!String(url).includes('api.php'))return pageFetch(url,options);const action=new URL(url).searchParams.get('action');qa.requests.push({action,body:options.body?JSON.parse(options.body):null});return Response.json(action==='state'?${JSON.stringify(state)}:{sent:true})};</script>`

test('home gives usable entry points, remembers the choice and requests identity only for the chosen action',{timeout:90000},async()=>{
  const server=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname
    const file=resolve(web,path==='/'?'index.html':'.'+path)
    if(!file.startsWith(web+sep)){response.writeHead(403).end();return}
    try{
      let body=await readFile(file,'utf8')
      if(extname(file)==='.html')body=body.replace('<head>','<head>'+shim)
      if(path==='/signal.js')body+='\nSignaling.open=async options=>{const connection={pubkey:"00".repeat(32),closed:false,send(){},close(){this.closed=true}};if(options.secretKey)qa.viewerConnection=connection;return connection};'
      if(path==='/viewer.js')body=body.replace("  setTool('point')\n  update('connecting')","  window.qa.receive=onText\n  setTool('point')\n  update('connecting')")
      response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');response.end(body)
    }catch{response.writeHead(404).end()}
  })
  const session='pv-home-'+process.pid
  const browser=async(...args)=>(await promisify(execFile)('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000})).stdout
  const evaluate=async(code)=>JSON.parse(await browser('eval',code))
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    const base='http://127.0.0.1:'+server.address().port
    await browser('open',base+'/')
    await browser('wait','#share-url')
    for(const [width,height] of [[1280,900],[393,852],[320,700],[844,390]]){
      await browser('set','viewport',String(width),String(height))
      const layout=await evaluate("({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,footer:document.querySelector('#footer').getBoundingClientRect().bottom})")
      assert.deepEqual([layout.width,layout.height],[width,Math.max(height,Math.round(layout.footer))],'the home page only scrolls when its content exceeds the viewport')
    }
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#footer a'),a=>a.textContent)"),['Impressum','Datenschutz','Sicherheit'])
    assert.equal(await evaluate("document.querySelector('#trust').textContent"),'P2P · Ende-zu-Ende verschlüsselt')
    // the legal pages open over the start page, which stays where it is
    await browser('click','#footer a[href="impressum.html"]')
    await browser('wait','.pv-legal-dialog[open] h1')
    assert.equal(await evaluate("document.querySelector('.pv-legal-dialog h1').textContent+'|'+location.pathname+'|'+!!document.querySelector('.pv-legal-dialog .back')"),'Impressum|/|false')
    await browser('click','.pv-legal-close')
    assert.equal(await evaluate("document.querySelector('.pv-legal-dialog').open"),false)
    await browser('click','#footer a[href="sicherheit.html"]')
    await browser('wait','.pv-legal-dialog[open] h1')
    assert.equal(await evaluate("document.querySelector('.pv-legal-dialog h1').textContent"),'Sicherheit')
    await browser('press','Escape')
    assert.equal(await evaluate("document.querySelector('.pv-legal-dialog').open"),false)
    assert.equal(await evaluate("document.querySelector('#name-box').hidden && document.querySelector('#connect').hidden"),true)
    assert.equal(await evaluate("document.querySelectorAll('[data-home]').length"),2)
    await browser('click','[data-home="contacts"]')
    assert.equal(await evaluate("document.querySelector('#fixed-room-entry').hidden"),false)
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    await browser('set','viewport','393','852')
    await browser('screenshot','/tmp/peekaview-ux-contacts-after.png')
    await browser('find','role','button','click','--name','Person einladen')
    await browser('wait','input[type=email]')
    assert.equal(await evaluate("document.body.innerText.includes('Wen möchtest du einladen?') && !document.body.innerText.includes('Und wie lautet deine E-Mail-Adresse?')"),true)
    await browser('fill','input[type=email]','friend@example.test')
    await browser('click','.fixed-rooms form button')
    await browser('wait','--text','Und wie lautet deine E-Mail-Adresse?')
    assert.equal(await evaluate('qa.requests.length'),0)
    await browser('open',base+'/')
    await browser('wait','--text','Und wie lautet deine E-Mail-Adresse?')
    assert.equal(await evaluate("document.body.innerText.includes('friend@example.test')"),true)
    await browser('fill','input[type=email]','own@example.test')
    await browser('click','.fixed-rooms form button')
    await browser('wait','--text','Prüfe jetzt deine E-Mails')
    assert.deepEqual(await evaluate('qa.requests'),[{action:'device/request',body:{email:'own@example.test',next_action:'contact',contact_email:'friend@example.test'}}])
    await browser('open',base+'/')
    await browser('wait','--text','Prüfe jetzt deine E-Mails')
    assert.equal(await evaluate("document.querySelector('[data-home=contacts]').getAttribute('aria-pressed')"),'true')
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    await browser('find','role','button','click','--name','Zurück')
    await browser('click','[data-home="link"]')
    await browser('screenshot','/tmp/peekaview-ux-home-after.png')
    await browser('fill','#share-url','https://example.test/#'+room)
    await browser('click','#paste-open')
    assert.equal(await evaluate("document.querySelector('#link-error').hidden"),false)
    assert.equal(await evaluate("document.querySelector('#name-box').hidden"),true)
    await browser('screenshot','/tmp/peekaview-ux-link-after.png')
    await browser('fill','#share-url','https://peekaview.de/#'+room)
    await browser('click','#paste-open')
    await browser('wait','#name')
    assert.equal(await evaluate('location.hash'),'#'+room)
    assert.equal(await evaluate("document.querySelector('#recent-links').hidden"),true)
    assert.equal(await evaluate("document.querySelector('#link-error').hidden"),true)
    // with a link there is only one thing to do: no tabs, no second link field
    assert.equal(await evaluate("document.querySelector('.home-nav').hidden && document.querySelector('#paste-link').hidden && document.querySelector('#host-note').hidden"),true)
    await browser('click','#other-link')
    await browser('wait','#share-url')
    assert.equal(await evaluate("location.hash==='' && !document.querySelector('.home-nav').hidden && document.querySelector('#name-box').hidden"),true)
    await browser('fill','#share-url','https://peekaview.de/#'+room)
    await browser('press','Enter')
    await browser('wait','#name')
    // joining without a name says what is missing
    await browser('click','#connect')
    assert.equal(await evaluate("!document.querySelector('#name-error').hidden && document.querySelector('#viewer').hidden"),true)
    await browser('fill','#name','Testgast')
    assert.equal(await evaluate("document.querySelector('#name-error').hidden"),true)
    await browser('click','#connect')
    await browser('wait','#viewer:not([hidden])')
    assert.equal(await evaluate("document.querySelector('#home').hidden"),true)
    assert.equal(await evaluate("document.querySelector('#footer').hidden"),true)
    assert.deepEqual(await evaluate('[document.documentElement.scrollWidth,document.documentElement.scrollHeight]'),[393,852],'joining leaves no page scroll area behind the fixed viewer')
    assert.equal(await evaluate('qa.requests.length'),0)
    await evaluate("qa.receive({t:'welcome',id:1});qa.receive({t:'state',mode:'control',windows:[{w:0,kind:'window',title:'Testfenster',pw:1280,ph:720}]});qa.video=document.querySelector('#viewer video');qa.contacts=document.querySelector('#fixed-rooms');true")
    await browser('click','[data-fixed-rooms]')
    assert.equal(await evaluate("!!document.querySelector('#contacts-dialog[open] #fixed-rooms')"),true,'contacts open over the viewer instead of navigating away')
    for(const [width,height] of [[1280,900],[393,852],[320,480]]){
      await browser('set','viewport',String(width),String(height))
      assert.equal(await evaluate("(()=>{const r=document.querySelector('#contacts-dialog').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()"),true)
    }
    if(process.env.PV_CONTACTS_DIALOG_SCREENSHOT)await browser('screenshot',process.env.PV_CONTACTS_DIALOG_SCREENSHOT)
    await browser('press','Escape')
    await browser('wait','--fn',"!!document.querySelector('#fixed-room-entry #fixed-rooms')")
    assert.equal(await evaluate("!document.querySelector('#contacts-dialog').open && document.activeElement.matches('[data-fixed-rooms]')"),true)
    await browser('click','[data-fixed-rooms]')
    assert.equal(await evaluate("document.querySelector('#contacts-dialog #fixed-rooms')===qa.contacts"),true,'reopening reuses the contact UI')
    await browser('click','#contacts-close')
    await browser('wait','--fn',"!!document.querySelector('#fixed-room-entry #fixed-rooms')")
    assert.equal(await evaluate("!qa.viewerConnection.closed && document.querySelector('#viewer video')===qa.video && !document.querySelector('#viewer').hidden"),true,'the same viewer connection remains open')
    assert.equal(await evaluate('location.hash'),'#'+room)
    await browser('set','viewport','393','852')
    await browser('click','[data-fixed-rooms]')
    await evaluate('history.back();true')
    await browser('wait','#home:not([hidden])')
    assert.equal(await evaluate("!document.querySelector('#contacts-dialog').open && !!document.querySelector('#fixed-room-entry #fixed-rooms')"),true,'leaving also closes the contact dialog and restores the home view')
    assert.equal(await evaluate("location.hash==='' && document.querySelector('#name-box').hidden"),true)
    await evaluate("localStorage.removeItem('pv-name');localStorage.setItem('pv-start-view','contacts');true")
    await browser('open',base+'/?app=1#'+room)
    await browser('wait','#name')
    assert.equal(await evaluate("document.querySelector('[data-home=link]').getAttribute('aria-pressed')"),'true')
    assert.equal(await evaluate("document.querySelector('#fixed-room-entry').hidden"),true)
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    await evaluate(`localStorage.setItem('pv-fixed-rooms-v1',JSON.stringify({api:'https://rooms.example.test/api.php',token:'test-token',device:${JSON.stringify(own)}}));window.dispatchEvent(new StorageEvent('storage',{key:'pv-fixed-rooms-v1'}));true`)
    await browser('wait','#profile:not([hidden]) summary')
    assert.equal(await evaluate("!!document.querySelector('.brand #profile .fr-profile')"),true)
    await evaluate("location.hash='';true")
    await browser('click','[data-home="contacts"]')
    await browser('click','[data-home="link"]')
    assert.equal(await evaluate("document.querySelector('#profile').hidden"),false)
    await browser('set','viewport','320','700')
    await browser('click','#profile summary')
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.fr-profile-panel').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})()"),true)
    await browser('screenshot','/tmp/peekaview-home-profil.png')
  }finally{try{await browser('close')}finally{await new Promise(resolve=>server.close(resolve))}}
})
