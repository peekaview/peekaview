// A viewer is its signing key: the id it sends as "from" is the key its events are signed with,
// and stays the same for a tab (a reload need not be let in again).
import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.WebSocket ??= class { static OPEN = 1 }
const store = new Map()
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
const { Signaling, hex, viewerKey } = await import('../web/signal.js')
const { schnorr } = await import('../web/vendor/noble-schnorr.js')

test('the viewer id is the key that signs its events and survives a reload', async () => {
  const key = viewerKey('pv-key-test')
  assert.deepEqual(viewerKey('pv-key-test'), key)
  assert.notDeepEqual(viewerKey('pv-key-other-room'), key)
  const signaling = await Signaling.open({ secret: 'identity-test', relays: [], secretKey: key, onMessage() {} })
  assert.equal(signaling.pubkey, hex(schnorr.getPublicKey(key)))
  await signaling.send({ type: 'hello', from: signaling.pubkey })
  const [, event] = JSON.parse(signaling.recent[0].frame)
  assert.equal(event.pubkey, signaling.pubkey)
  signaling.close()
})
