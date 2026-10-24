import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here=dirname(fileURLToPath(import.meta.url))
const folder=await mkdtemp(resolve(tmpdir(),'peekaview-rooms-test-'))
await mkdir(resolve(folder,'mail'))
const portProbe=createServer()
await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve))
const address=`127.0.0.1:${portProbe.address().port}`
await new Promise(resolve=>portProbe.close(resolve))
const api=`http://${address}/api.php`
const processPhp=spawn('php',['-d',`sendmail_path=php ${resolve(here,'mail.php')}`,'-S',address,'-t',resolve(here,'../public')],{
  env:{...process.env,PEEKAVIEW_DATA_DIR:resolve(folder,'data'),PEEKAVIEW_TEST_MAILBOX:resolve(folder,'mail'),PEEKAVIEW_API_URL:api,PEEKAVIEW_MAIL_FROM:'test@example.test',PEEKAVIEW_SITE:'http://127.0.0.1:8872',PEEKAVIEW_ORIGINS:'http://127.0.0.1:8872'},stdio:['ignore','ignore','pipe'],
})
let logs='';processPhp.stderr.on('data',d=>{logs+=d})
async function request(action,body,token){
  const response=await fetch(`${api}?action=${action}&v=2`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  return {response,data:await response.json()}
}
try {
  let ready=false
  for(let i=0;i<40;i++){
    if(processPhp.exitCode!==null) throw new Error('PHP-Testserver konnte nicht starten: '+logs)
    try{const response=await fetch(`${api}?action=config`);ready=response.ok;if(ready)break}catch{}
    await new Promise(r=>setTimeout(r,100))
  }
  assert.ok(ready,'PHP-Testserver ist nicht bereit: '+logs)
  const unauth=await request('state');assert.equal(unauth.response.status,401)
  const bad=await fetch(`${api}?action=config`,{headers:{Origin:'https://evil.example.test'}});assert.equal(bad.status,403)
  async function register(email,name){
    const before=new Set(await readdir(resolve(folder,'mail')))
    const sent=await request('device/request',{email});assert.equal(sent.response.status,200)
    const file=(await readdir(resolve(folder,'mail'))).find(f=>!before.has(f))
    const mail=await readFile(resolve(folder,'mail',file),'utf8')
    const invitation=mail.match(/invite=([^&\s]+)/)[1]
    const opening={invitation,handoff:'a'.repeat(32)}
    const unopened=await request('invitation/open-status',opening);assert.equal(unopened.response.status,200);assert.equal(unopened.data.opened,false)
    const opened=await request('invitation/opened',opening);assert.equal(opened.response.status,200);assert.equal(opened.data.opened,true)
    const receipt=await request('invitation/open-status',opening);assert.equal(receipt.data.opened,true)
    const accepted=await request('invitation/accept',{invitation,name,platform:'browser'});assert.equal(accepted.response.status,200)
    return accepted.data
  }
  const anna=await register('anna@example.test','Annas Computer')
  const room=await request('rooms/create',{name:'Familie'},anna.token);assert.equal(room.response.status,200)
  const invited=await request('rooms/invite',{room:room.data.id,email:'ben@example.test'},anna.token);assert.equal(invited.response.status,200)
  const mailFiles=await readdir(resolve(folder,'mail'))
  let benInvitation
  for(const file of mailFiles){const mail=await readFile(resolve(folder,'mail',file),'utf8');if(mail.includes('To: ben@example.test'))benInvitation=mail.match(/invite=([^&\s]+)/)[1]}
  assert.ok(benInvitation)
  const ben=await request('invitation/accept',{invitation:benInvitation,name:'Bens Browser',platform:'browser'});assert.equal(ben.response.status,200)
  const state=await request('state',undefined,ben.data.token);assert.equal(state.data.rooms[0].participants.length,2)
  const call=await request('calls/start',{room:room.data.id},anna.token);assert.equal(call.response.status,200)
  const ringing=await request('state',undefined,ben.data.token);assert.equal(ringing.data.calls[0].status,'ringing');assert.equal(ringing.data.calls[0].secret,undefined)
  await request('calls/join',{call:call.data.id},ben.data.token)
  const joined=await request('state',undefined,ben.data.token);assert.equal(joined.data.calls[0].participants.length,2)
  await request('calls/leave',{call:call.data.id},ben.data.token)
  await request('calls/leave',{call:call.data.id},anna.token)
  const final=await request('state',undefined,anna.token);assert.equal(final.data.calls.length,0)
  assert.equal(final.data.contacts.length,1);assert.equal(final.data.contacts[0].email,ben.data.device.email)
  const direct=await request('calls/direct',{person:final.data.contacts[0].id},anna.token);assert.equal(direct.response.status,200)
  const directRing=await request('state',undefined,ben.data.token);assert.equal(directRing.data.calls[0].kind,'contact');assert.equal(directRing.data.calls[0].secret,undefined)
  const heartbeat=await request('calls/heartbeat',{call:direct.data.id},anna.token);assert.equal(heartbeat.response.status,200)
  await request('calls/join',{call:direct.data.id},ben.data.token)
  await request('calls/leave',{call:direct.data.id},ben.data.token)
  await request('calls/leave',{call:direct.data.id},anna.token)
  const noPin=await request('rooms/access',{room:room.data.id,unattended:true},ben.data.token);assert.equal(noPin.response.status,400)
  const shortPin=await request('rooms/settings',{room:room.data.id,pin_enabled:true,pin:'12345'},anna.token);assert.equal(shortPin.response.status,400)
  const policy=await request('rooms/settings',{room:room.data.id,pin_enabled:true,pin:'Test!6'},anna.token);assert.equal(policy.response.status,200)
  const access=await request('rooms/access',{room:room.data.id,unattended:true},ben.data.token);assert.equal(access.response.status,200)
  const deniedPin=await request('calls/start',{room:room.data.id},anna.token);assert.equal(deniedPin.response.status,403)
  const protectedCall=await request('calls/start',{room:room.data.id,pin:'Test!6'},anna.token);assert.equal(protectedCall.response.status,200)
  const auto=await request('calls/auto-join',{call:protectedCall.data.id},ben.data.token);assert.equal(auto.response.status,200)
  const mustKeepPin=await request('rooms/settings',{room:room.data.id,pin_enabled:false},anna.token);assert.equal(mustKeepPin.response.status,400)
  await request('calls/leave',{call:protectedCall.data.id},ben.data.token)
  await request('calls/leave',{call:protectedCall.data.id},anna.token)
  await request('rooms/access',{room:room.data.id,unattended:false},ben.data.token)
  await request('rooms/settings',{room:room.data.id,pin_enabled:false},anna.token)
  const admissionCall=await request('calls/start',{room:room.data.id},anna.token)
  const beforeInvite=new Set(await readdir(resolve(folder,'mail')))
  await request('rooms/invite',{room:room.data.id,email:'carla@example.test'},anna.token)
  const inviteFile=(await readdir(resolve(folder,'mail'))).find(file=>!beforeInvite.has(file))
  const inviteMail=await readFile(resolve(folder,'mail',inviteFile),'utf8')
  const carla=await request('invitation/accept',{invitation:inviteMail.match(/invite=([^&\s]+)/)[1],name:'Carlas Browser',platform:'browser'})
  assert.equal(carla.data.request_call,admissionCall.data.id)
  const pending=await request('state',undefined,carla.data.token)
  assert.equal(pending.data.calls[0].status,'requested');assert.equal(pending.data.calls[0].secret,undefined)
  const beforeApproval=await request('calls/join',{call:admissionCall.data.id},carla.data.token);assert.equal(beforeApproval.response.status,403)
  const ownerState=await request('state',undefined,anna.token);assert.equal(ownerState.data.calls[0].requests[0].id,carla.data.device.id)
  const approved=await request('calls/admit',{call:admissionCall.data.id,device:carla.data.device.id,allow:true},anna.token);assert.equal(approved.response.status,200)
  const afterApproval=await request('state',undefined,carla.data.token);assert.equal(afterApproval.data.calls[0].status,'joined');assert.ok(afterApproval.data.calls[0].secret)
  await request('calls/leave',{call:admissionCall.data.id},carla.data.token)
  await request('calls/leave',{call:admissionCall.data.id},anna.token)
  const dave=await register('dave@example.test','Daves Computer'),dave2=await register('dave@example.test','Daves Handy')
  const ownGroup=await request('rooms/create',{name:'Daves Gruppe'},dave.token)
  assert.equal((await request('devices/remove',{device:ben.data.device.id},dave.token)).response.status,403)
  assert.equal((await request('devices/remove',{device:dave2.device.id},dave.token)).response.status,200)
  assert.equal((await request('state',undefined,dave2.token)).response.status,401)
  const dave3=await register('dave@example.test','Daves Browser')
  assert.equal((await request('session/logout',{},dave.token)).response.status,200)
  assert.equal((await request('state',undefined,dave.token)).response.status,401)
  const retained=(await request('state',undefined,dave3.token)).data
  assert.equal(retained.rooms[0].id,ownGroup.data.id);assert.equal(retained.rooms[0].can_manage,true)
  assert.equal((await request('profile/delete',{email:'wrong@example.test'},dave3.token)).response.status,400)
  assert.equal((await request('state',undefined,dave3.token)).response.status,200)
  assert.equal((await request('profile/delete',{email:'dave@example.test'},dave3.token)).response.status,200)
  assert.equal((await request('state',undefined,dave3.token)).response.status,401)
  assert.equal((await request('state',undefined,ben.data.token)).response.status,200)
  await writeFile(resolve(folder,'fixtures.json'),JSON.stringify({api,anna,ben:ben.data,room:room.data.id,benInvitation}))
  console.log(`HTTP, CORS, Mailtransport, Anmeldung, Räume und Anrufablauf erfolgreich. Fixture: ${folder}`)
  if(process.env.PEEKAVIEW_KEEP_TEST_SERVER==='1'){
    await writeFile('/tmp/peekaview-rooms-fixture-path',folder)
    await new Promise(resolve=>{process.on('SIGINT',resolve);process.on('SIGTERM',resolve)})
  }
}catch(e){console.error(logs);throw e}
finally{processPhp.kill('SIGTERM')}
