// Real shared UI + PHP/SQLite. The mail transport writes only to a temporary local mailbox.
import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {createServer as portProbe} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,extname,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import test from 'node:test'

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),web=resolve(repo,'web')
test('recipient survives verification in another tab or browser and invitation sends automatically',{timeout:120000},async()=>{
  const folder=await mkdtemp(resolve(tmpdir(),'pv-invitation-')),mailbox=resolve(folder,'mail')
  await mkdir(mailbox)
  const probe=portProbe();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${probe.address().port}/api.php`;await new Promise(r=>probe.close(r))
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname,file=resolve(web,'.'+path)
    if(!file.startsWith(web+sep)){res.writeHead(403).end();return}
    try{
      let body=await readFile(file)
      if(extname(file)==='.html')body=body.toString().replace('<head>',`<head><script>
        if(!localStorage.getItem('pv-fixed-rooms-v1'))localStorage.setItem('pv-fixed-rooms-v1',JSON.stringify({api:${JSON.stringify(api)}}));
        if(new URLSearchParams(location.search).has('native'))window.__TAURI__={core:{invoke:async()=>{}},event:{listen:async()=>()=>{}}};
        window.qaOpenings=[];const realFetch=window.fetch;window.fetch=(url,options)=>{if(new URL(url).searchParams.get('action')==='invitation/open-status')qaOpenings.push(JSON.parse(options.body));return realFetch(url,options)};
      </script>`)
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');res.end(body)
    }catch{res.writeHead(404).end()}
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
  const php=spawn('php',['-d',`sendmail_path=php ${resolve(repo,'room-service/tests/mail.php')}`,'-S',new URL(api).host,'-t',resolve(repo,'room-service/public')],{
    env:{...process.env,PEEKAVIEW_DATA_DIR:resolve(folder,'data'),PEEKAVIEW_TEST_MAILBOX:mailbox,PEEKAVIEW_API_URL:api,PEEKAVIEW_MAIL_FROM:'test@example.test',PEEKAVIEW_SITE:base,PEEKAVIEW_ORIGINS:base},stdio:['ignore','ignore','pipe']})
  let logs='';php.stderr.on('data',d=>{logs+=d})
  const sessions=['pv-invite-'+process.pid,'pv-confirm-'+process.pid,'pv-receiver-'+process.pid]
  const browser=async(session,...args)=>(await promisify(execFile)('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000})).stdout
  const evaluate=async(session,code)=>JSON.parse(await browser(session,'eval',code))
  const mails=async()=>Promise.all((await readdir(mailbox)).map(async f=>(await readFile(resolve(mailbox,f),'utf8')).replaceAll('\r\n','\n')))
  const confirmation=async email=>{
    const mail=(await mails()).find(m=>m.includes('To: '+email+'\n'))
    assert.ok(mail,'Owner confirmation mail exists')
    return mail.match(/http:\/\/[^\s]+#invite=[^\s]+/)[0]
  }
  const start=async(session,recipient,own)=>{
    await browser(session,'open',base+'/fixed-rooms.html')
    await browser(session,'find','role','button','click','--name','Person einladen')
    await browser(session,'find','label','E-Mail-Adresse der Person','fill',recipient)
    await browser(session,'find','role','button','click','--name','Weiter','--exact')
    await browser(session,'wait','--text','Und wie lautet deine E-Mail-Adresse?')
    await browser(session,'find','label','Deine E-Mail-Adresse','fill',own)
    await browser(session,'find','role','button','click','--name','Bestätigungslink senden')
    await browser(session,'wait','--text','Prüfe jetzt deine E-Mails')
  }
  try{
    let ready=false
    for(let i=0;i<40;i++){try{ready=(await fetch(api+'?action=config')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,100))}
    assert.ok(ready,logs)
    const [main,other,receiver]=sessions
    await start(main,'friend@example.test','owner@example.test')
    assert.equal((await mails()).length,1)
    await browser(main,'open',base+'/fixed-rooms.html')
    await browser(main,'wait','--text','Prüfe jetzt deine E-Mails')
    assert.equal(await evaluate(main,"document.body.innerText.includes('friend@example.test')"),true)
    const link=await confirmation('owner@example.test')
    await browser(main,'tab','new',link)
    await browser(main,'wait','--text','Wo möchtest du PeekaView benutzen?')
    assert.equal(await evaluate(main,"document.body.innerText.includes('Für ein anderes Gerät öffne den Link aus der E-Mail einfach dort.')"),true)
    assert.equal(await evaluate(main,"document.querySelector('.fr-device-choice a')===null && !document.body.innerText.includes('schon installiert?')"),true)
    await evaluate(main,"document.querySelector('.fr-device-choice button').click();true")
    await browser(main,'wait','--fn','qaOpenings.length>0')
    const opening=await evaluate(main,'qaOpenings[0]')
    await evaluate(main,"window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));true")
    assert.equal(await evaluate(main,"!document.body.innerText.includes('Desktop ist geöffnet')"),true,'Focus changes alone never prove that Desktop opened')
    const nativeLink=new URL(link);nativeLink.searchParams.set('native','1');nativeLink.hash+='&handoff='+opening.handoff
    await browser(receiver,'open',nativeLink.href)
    await browser(receiver,'wait','--text','Wo möchtest du PeekaView benutzen?')
    await browser(main,'wait','--text','PeekaView Desktop ist geöffnet. Bestätige das Gerät dort.')
    assert.equal(await evaluate(main,"document.querySelector('form').hidden"),true,'Browser registration is not offered while confirming in Desktop')
    assert.equal((await mails()).length,1,'Opening Desktop neither registers nor sends the invitation')
    await browser(main,'find','role','button','click','--name','Stattdessen diesen Browser hinzufügen')
    await evaluate(main,"document.querySelector('.fr-device-choice button').click();true")
    await browser(main,'wait','--text','Keine Rückmeldung von PeekaView Desktop.')
    const retry=await evaluate(main,'qaOpenings.at(-1)')
    assert.notEqual(retry.handoff,opening.handoff,'Retry requires a fresh receipt, never an old installation flag')
    assert.equal(await evaluate(main,"document.querySelector('.fr-device-choice a').href.endsWith('/download.html')"),true)
    assert.equal(await evaluate(main,"document.querySelector('form').hidden"),false,'Browser registration remains available when no Desktop responds')
    await browser(main,'set','viewport','393','852')
    await browser(main,'screenshot','/tmp/peekaview-add-device.png')
    assert.equal((await mails()).length,1,'Opening the email link alone sends nothing')
    assert.equal(await evaluate(main,"document.body.innerText.includes('friend@example.test')"),true)
    // The external-protocol dialog is outside this headless test; exercise the DOM click directly.
    await evaluate(main,"document.querySelector('form > button').click();true")
    await browser(main,'wait','--text','E-Mail bestätigt. Einladung an friend@example.test gesendet.')
    assert.equal((await mails()).length,2)
    await browser(main,'tab','close')
    await browser(main,'wait','--text','friend@example.test · eingeladen, wartet auf Bestätigung')
    assert.equal(await evaluate(main,"!document.body.innerText.includes('Prüfe jetzt deine E-Mails') && !document.querySelector('.fr-invite-contact').open"),true)
    await browser(main,'click','.fr-invite-contact summary')
    await browser(main,'find','label','E-Mail-Adresse der Person','fill','second@example.test')
    await browser(main,'find','role','button','click','--name','Einladung senden','--exact')
    await browser(main,'wait','--text','Einladung an second@example.test gesendet.')
    assert.equal((await mails()).length,3,'Verified sender sends immediately without confirming their email again')
    await browser(main,'open',link)
    await browser(main,'wait','--text','bereits verwendet')
    assert.equal((await mails()).length,3,'Reopening the confirmation cannot resend the invitation')

    await start(other,'remote@example.test','new@example.test')
    const remoteLink=await confirmation('new@example.test')
    // The other profile never saw the recipient form: only the server knows its recipient.
    await browser(receiver,'open',remoteLink)
    await browser(receiver,'wait','--text','Wo möchtest du PeekaView benutzen?')
    assert.equal(await evaluate(receiver,"document.body.innerText.includes('remote@example.test')"),true)
    await browser(receiver,'find','role','button','click','--name','Nur diesen Browser hinzufügen')
    await browser(receiver,'wait','--text','E-Mail bestätigt. Einladung an remote@example.test gesendet.')
    assert.equal((await mails()).length,5)
    assert.equal((await mails()).filter(m=>m.includes('To: remote@example.test\n')).length,1)
    await browser(receiver,'set','viewport','393','852')
    await browser(receiver,'screenshot','/tmp/peekaview-invitation-sent.png')
  }catch(e){
    console.error(await browser(sessions[0],'snapshot'))
    throw e
  }finally{
    await Promise.allSettled(sessions.map(s=>browser(s,'close')))
    php.kill('SIGTERM');await new Promise(r=>server.close(r));await rm(folder,{recursive:true,force:true})
  }
})
