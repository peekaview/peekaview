import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

test('room transcript mixes stereo into one second of silent-output mono PCM',async()=>{
  let Processor
  const sent=[]
  class AudioWorkletProcessor {constructor(){this.port={postMessage:buffer=>sent.push(new Int16Array(buffer))}}}
  vm.runInNewContext(await readFile(new URL('../web/room-pcm-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor,Int16Array,Math,registerProcessor:(name,cls)=>{assert.equal(name,'peekaview-room-pcm');Processor=cls}})
  const pcm=new Processor()
  const a=new Float32Array(128).fill(.5),b=new Float32Array(128).fill(-.25)
  for(let i=0;i<125;i++) assert.equal(pcm.process([[a,b]]),true)
  assert.equal(sent.length,1);assert.equal(sent[0].length,16000);assert.equal(sent[0][0],4095)
})

test('service worker rejects expired/invalid calls and opens only its own room page without credentials',async()=>{
  const handlers={}, shown=[], opened=[], closed=[]
  const self={addEventListener:(t,h)=>handlers[t]=h,registration:{scope:'https://peekaview.de/',showNotification:async(...args)=>shown.push(args),getNotifications:async options=>[{close:()=>closed.push(options.tag)}]}}
  vm.runInNewContext(await readFile(new URL('../web/room-sw.js',import.meta.url),'utf8'),{self,URL,URLSearchParams,Date,clients:{openWindow:async url=>opened.push(url)}})
  async function push(data){let work;handlers.push({data:{json:()=>data},waitUntil:p=>work=p});await work}
  await push({call:'bad',api:'https://api.example.test/api.php',expires:Date.now()/1000+45});assert.equal(shown.length,0)
  await push({call:'0123456789abcdef',api:'https://api.example.test/api.php',expires:1});assert.equal(shown.length,0)
  await push({call:'0123456789abcdef',api:'http://api.example.test/api.php',expires:Date.now()/1000+45});assert.equal(shown.length,0)
  await push({call:'0123456789abcdef',api:'https://api.example.test/api.php',caller:'Anna',expires:Date.now()/1000+45});assert.equal(shown.length,1)
  let work;handlers.notificationclick({notification:{close(){},data:shown[0][1].data},waitUntil:p=>work=p});await work
  assert.match(opened[0],/^https:\/\/peekaview\.de\/fixed-rooms.html#call=/)
  assert.equal(/token|secret|email/.test(opened[0]),false)
  await push({call:'0123456789abcdef',api:'https://api.example.test/api.php',caller:'Anna',admitted:true,expires:Date.now()/1000+45})
  assert.equal(shown[1][0],'PeekaView: Du kannst teilnehmen')
  assert.equal(shown[1][1].body,'Du wurdest zum Gespräch zugelassen.')
  await push({answered_call:'0123456789abcdef',api:'https://api.example.test/api.php',expires:Date.now()/1000+45})
  assert.deepEqual(closed,['peekaview-0123456789abcdef'])
  assert.equal(shown.length,2)
})
