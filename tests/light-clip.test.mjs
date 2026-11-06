// The shared clipboard held by the presenter's browser (light-clip.js), in the protocol of the
// desktop and Android apps: an upload over "pvfile", the list announced, a download served back.
import assert from 'node:assert/strict'
import test from 'node:test'
import { LightClip } from '../web/light-clip.js'

function channel() {
  const sent = []
  return { sent, readyState: 'open', bufferedAmount: 0, send: (d) => sent.push(typeof d === 'string' ? JSON.parse(d) : Buffer.from(d).toString()), addEventListener() {} }
}

test('LightClip: a viewer uploads, everybody hears of it, another viewer downloads it, only its owner removes it', async () => {
  const pv = []
  const anna = { id: 1 }
  const bob = { id: 2 }
  const clip = new LightClip({ broadcast: (m) => pv.push(['all', m]), send: (v, m) => pv.push([v.id, m]), viewers: () => [anna, bob] })
  clip.attach(anna, channel())
  clip.attach(bob, channel())
  // up: put + chunks
  anna.files.onmessage({ data: JSON.stringify({ t: 'put', id: 'abc', name: 'Notiz.txt', mime: 'text/plain', size: 11, text: 'Hallo Welt!' }) })
  anna.files.onmessage({ data: new TextEncoder().encode('Hallo ').buffer })
  anna.files.onmessage({ data: new TextEncoder().encode('Welt!').buffer })
  assert.deepEqual(anna.files.sent.at(-1), { t: 'stored', id: 'abc' })
  const list = pv.findLast(([to, m]) => to === 'all' && m.t === 'clip')[1]
  assert.deepEqual(list.items.map((i) => [i.id, i.name, i.from, i.size, i.text]), [['abc', 'Notiz.txt', 1, 11, 'Hallo Welt!']])
  // down: get → data, chunks, end
  bob.files.onmessage({ data: JSON.stringify({ t: 'get', id: 'abc', req: 7 }) })
  await bob.serving
  assert.deepEqual(bob.files.sent, [{ t: 'data', id: 'abc', req: 7, size: 11 }, 'Hallo Welt!', { t: 'end', id: 'abc', req: 7 }])
  // gone: an error for that request
  bob.files.onmessage({ data: JSON.stringify({ t: 'get', id: 'nope', req: 8 }) })
  await bob.serving
  assert.equal(bob.files.sent.at(-1).t, 'error')
  // removed only by its owner (or the presenter)
  assert.equal(clip.remove('abc', 2), false)
  assert.equal(clip.remove('abc', 1), true)
  assert.equal(clip.all().length, 0)
})

test('LightClip: too large, too much data, a bad id – refused', () => {
  const v = { id: 1 }
  const clip = new LightClip({ broadcast() {}, send() {}, viewers: () => [v] })
  clip.attach(v, channel())
  v.files.onmessage({ data: JSON.stringify({ t: 'put', id: 'big', name: 'x', mime: '', size: 200 * 1024 * 1024 }) })
  assert.equal(v.files.sent.at(-1).t, 'error')
  v.files.onmessage({ data: JSON.stringify({ t: 'put', id: '../x', name: 'x', mime: '', size: 1 }) })
  assert.equal(v.files.sent.at(-1).t, 'error')
  v.files.onmessage({ data: JSON.stringify({ t: 'put', id: 'small', name: 'x', mime: '', size: 2 }) })
  v.files.onmessage({ data: new Uint8Array(5).buffer })
  assert.deepEqual(v.files.sent.at(-1), { t: 'error', id: 'small', error: 'zu viele Daten' })
  assert.equal(clip.all().length, 0)
})
