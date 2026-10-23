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
const shim=`<script>window.qa={requests:[]};window.fetch=async(url,options)=>{qa.requests.push({action:new URL(url).searchParams.get('action'),body:JSON.parse(options.body)});return Response.json({sent:true})};</script>`

test('home gives usable entry points, remembers the choice and requests identity only for the chosen action',{timeout:90000},async()=>{
  const server=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname
    const file=resolve(web,path==='/'?'index.html':'.'+path)
    if(!file.startsWith(web+sep)){response.writeHead(403).end();return}
    try{
      let body=await readFile(file,'utf8')
      if(extname(file)==='.html')body=body.replace('<head>','<head>'+shim)
      if(path==='/signal.js')body+='\nSignaling.open=async()=>({pubkey:"00".repeat(32),send(){},close(){}});'
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
    assert.equal(await evaluate("document.querySelector('#name-label').hidden && document.querySelector('#connect').hidden"),true)
    assert.equal(await evaluate("document.querySelectorAll('[data-home]').length"),2)
    await browser('click','[data-home="contacts"]')
    assert.equal(await evaluate("document.querySelector('#fixed-room-entry').hidden"),false)
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    await browser('set','viewport','393','852')
    await browser('screenshot','/tmp/peekaview-ux-contacts-after.png')
    await browser('find','role','button','click','--name','Person einladen')
    await browser('wait','input[type=email]')
    assert.equal(await evaluate("document.body.innerText.includes('Schritt 1 von 2')"),true)
    await browser('fill','input[type=email]','own@example.test')
    await browser('click','.fixed-rooms form button')
    await browser('wait','--text','Prüfe deine E-Mails')
    assert.deepEqual(await evaluate('qa.requests'),[{action:'device/request',body:{email:'own@example.test',next_action:'contact'}}])
    await browser('open',base+'/')
    await browser('wait','--text','Prüfe deine E-Mails')
    assert.equal(await evaluate("document.querySelector('[data-home=contacts]').getAttribute('aria-pressed')"),'true')
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
    await browser('find','role','button','click','--name','Zurück')
    await browser('click','[data-home="link"]')
    await browser('screenshot','/tmp/peekaview-ux-home-after.png')
    await browser('fill','#share-url','https://example.test/#'+room)
    await browser('click','#paste-open')
    assert.equal(await evaluate("document.querySelector('#link-error').hidden"),false)
    assert.equal(await evaluate("document.querySelector('#name-label').hidden"),true)
    await browser('screenshot','/tmp/peekaview-ux-link-after.png')
    await browser('fill','#share-url','https://peekaview.de/#'+room)
    await browser('click','#paste-open')
    await browser('wait','#name')
    assert.equal(await evaluate('location.hash'),'#'+room)
    assert.equal(await evaluate("document.querySelector('#recent-links').hidden"),true)
    assert.equal(await evaluate("document.querySelector('#link-error').hidden"),true)
    await browser('click','#paste-link summary')
    await browser('fill','#share-url','https://example.test/#'+room)
    await browser('press','Enter')
    assert.equal(await evaluate("!document.querySelector('#link-error').hidden && document.querySelector('#viewer').hidden"),true)
    await browser('fill','#name','Testgast')
    await browser('click','#connect')
    await browser('wait','#viewer:not([hidden])')
    assert.equal(await evaluate("document.querySelector('#home').hidden"),true)
    assert.equal(await evaluate('qa.requests.length'),0)
    await evaluate('history.back();true')
    await browser('wait','#home:not([hidden])')
    assert.equal(await evaluate("location.hash==='' && document.querySelector('#name-label').hidden"),true)
    await evaluate("localStorage.removeItem('pv-name');localStorage.setItem('pv-start-view','contacts');true")
    await browser('open',base+'/?app=1#'+room)
    await browser('wait','#name')
    assert.equal(await evaluate("document.querySelector('[data-home=link]').getAttribute('aria-pressed')"),'true')
    assert.equal(await evaluate("document.querySelector('#fixed-room-entry').hidden"),true)
    assert.equal(await evaluate("document.querySelector('input[type=email]')===null"),true)
  }finally{try{await browser('close')}finally{await new Promise(resolve=>server.close(resolve))}}
})
