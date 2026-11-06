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

// Hand-over to PeekaView Desktop: the app presents with the browser's key. The browser hears it as
// a "twin" (signed with its own key, not sent by itself) – never its own events coming back.
test('another holder of the presenter key is heard as a twin, our own echo is not', async () => {
  const key = schnorr.utils.randomSecretKey()
  const twins = []
  const browser = await Signaling.open({ secret: 'handover-test-room-1', relays: [], secretKey: key, onMessage() {}, onTwin: (m) => twins.push(m) })
  const desktop = await Signaling.open({ secret: 'handover-test-room-1', relays: [], secretKey: key, onMessage() {} })
  const event = async (signaling, msg) => {
    await signaling.send(msg)
    return JSON.parse(signaling.recent.at(-1).frame)[1]
  }
  // our own beacon, back from a relay: nothing
  await browser.receive(await event(browser, { type: 'host', from: 'host' }))
  assert.deepEqual(twins, [])
  // the app's beacon: a twin
  await browser.receive(await event(desktop, { type: 'host' }))
  assert.deepEqual(twins, [{ type: 'host' }])
  // with our key but not signed by it: nothing
  const forged = await event(desktop, { type: 'host', forged: true })
  await browser.receive({ ...forged, sig: '00'.repeat(64) })
  assert.equal(twins.length, 1)
  // without onTwin (viewers, older pages) the own key is simply ignored
  const viewer = await Signaling.open({ secret: 'handover-test-room-1', relays: [], secretKey: key, onMessage: () => assert.fail('own key') })
  await viewer.receive(await event(desktop, { type: 'host' }))
  for (const s of [browser, desktop, viewer]) s.close()
})
