import assert from 'node:assert/strict'
import test from 'node:test'
import { Voice } from '../web/voice.js'

function setup(capture) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: capture } })
  const sent = []
  const voice = new Voice({ send: msg => sent.push(msg) })
  voice.meter = () => {}
  return { voice, sent }
}

function microphone() {
  const track = new EventTarget()
  track.stopped = false
  track.stop = () => { track.stopped = true }
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } }
}

test('microphone starts muted; activation uses native speech processing and stopping releases capture', async () => {
  const { track, stream } = microphone()
  let captures = 0
  const { voice, sent } = setup(async constraints => {
    ++captures
    assert.deepEqual(constraints, { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    return stream
  })
  assert.equal(voice.on, false)
  assert.equal(captures, 0)
  await Promise.all([voice.start(), voice.start()])
  assert.equal(captures, 1)
  assert.equal(voice.on, true)
  voice.stop()
  assert.equal(voice.on, false)
  assert.equal(track.stopped, true)
  assert.deepEqual(sent, [{ t: 'voice', on: true }, { t: 'voice', on: false }])
})

test('leaving while permission is pending cannot activate the microphone later', async () => {
  const { track, stream } = microphone()
  let allow
  const { voice, sent } = setup(() => new Promise(resolve => { allow = resolve }))
  const starting = voice.start()
  assert.equal(voice.starting, true)
  voice.stop()
  allow(stream)
  await starting
  assert.equal(voice.on, false)
  assert.equal(voice.starting, false)
  assert.equal(track.stopped, true)
  assert.deepEqual(sent, [])
})

test('denied permission stays muted and can be retried; a revoked microphone updates the room', async () => {
  const { track, stream } = microphone()
  let attempts = 0
  const { voice, sent } = setup(async () => {
    if (++attempts === 1) throw new DOMException('Denied', 'NotAllowedError')
    return stream
  })
  await assert.rejects(voice.start(), { name: 'NotAllowedError' })
  assert.equal(voice.on, false)
  assert.equal(voice.starting, false)
  assert.deepEqual(sent, [])
  await voice.start()
  track.dispatchEvent(new Event('ended'))
  assert.equal(voice.on, false)
  assert.equal(track.stopped, true)
  assert.deepEqual(sent, [{ t: 'voice', on: true }, { t: 'voice', on: false }])
})
