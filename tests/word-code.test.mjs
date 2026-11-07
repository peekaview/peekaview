// Two words instead of a link: the right code gets the link, a wrong one gets nothing it could
// read – and the code never travels in the clear.
import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.WebSocket ??= class { static OPEN = 1 }
const { WORDS, RATE, newCode, parseCode, displayCode, looksLikeCode, offerCode, findByCode } = await import('../web/word-code.js')

/** An in-memory lobby: what one sends, every other one hears (and a log of all of it). */
function bus() {
  const members = new Set()
  const log = []
  const lobby = async (onMessage) => {
    const me = {
      onMessage,
      send(msg) {
        log.push(JSON.stringify(msg))
        for (const m of members) if (m !== me) queueMicrotask(() => m.onMessage(structuredClone(msg)))
      },
      close: () => members.delete(me),
    }
    members.add(me)
    return me
  }
  return { lobby, log, members }
}

test('1024 different words, letters only', () => {
  assert.equal(WORDS.length, 1024)
  assert.equal(new Set(WORDS).size, 1024)
  for (const w of WORDS) assert.match(w, /^[a-z]{2,9}$/)
})

test('a code is read however it is typed', () => {
  assert.deepEqual(parseCode('Tiger Apfel'), ['tiger apfel'])
  assert.deepEqual(parseCode('  tiger-APFEL '), ['tiger apfel'])
  assert.deepEqual(parseCode('TigerApfel'), ['tiger apfel'])
  assert.deepEqual(parseCode('Tiger'), [])
  assert.deepEqual(parseCode('Tiger Quatsch'), [])
  assert.deepEqual(parseCode('https://peekaview.de/#abc'), [])
  assert.equal(displayCode('tiger apfel'), 'Tiger Apfel')
  assert.ok(looksLikeCode('Tiger Apfel'))
  assert.ok(!looksLikeCode('https://peekaview.de/#x'))
  for (let i = 0; i < 50; i++) assert.deepEqual(parseCode(displayCode(newCode())).length >= 1, true)
})

test('the right code finds the link, and the code is nowhere in what travels', async () => {
  const { lobby, log } = bus()
  const link = 'https://peekaview.de/#AAAAAAAAAAAAAAAAAAAAAA'
  const offer = await offerCode({ link, name: 'Anna', code: 'tiger apfel', lobby })
  const found = await findByCode('Tiger Apfel', { lobby, timeout: 5000 })
  assert.deepEqual(found, { link, name: 'Anna' })
  for (const line of log) {
    assert.ok(!/tiger|apfel/i.test(line))
    assert.ok(!line.includes('AAAAAAAA'))
  }
  offer.close()
})

test('among several sharers, each code finds its own', async () => {
  const { lobby } = bus()
  const a = await offerCode({ link: 'A', code: 'tiger apfel', lobby })
  const b = await offerCode({ link: 'B', code: 'eule birne', lobby })
  assert.equal((await findByCode('eule birne', { lobby, timeout: 5000 })).link, 'B')
  assert.equal((await findByCode('tiger apfel', { lobby, timeout: 5000 })).link, 'A')
  a.close()
  b.close()
})

test('a wrong code finds nothing', async () => {
  const { lobby } = bus()
  const offer = await offerCode({ link: 'A', code: 'tiger apfel', lobby })
  await assert.rejects(findByCode('tiger birne', { lobby, timeout: 600 }), /timeout/)
  await assert.rejects(findByCode('kein code hier', { lobby, timeout: 600 }), /code/)
  offer.close()
})

test('a sharer answers at most RATE questions a minute', async () => {
  const { lobby } = bus()
  let answers = 0
  const offer = await offerCode({ link: 'A', code: 'tiger apfel', lobby, onAnswer: () => answers++ })
  const guesses = []
  for (let i = 0; i < RATE + 5; i++) guesses.push(findByCode(WORDS[i] + ' ' + WORDS[i + 1], { lobby, timeout: 800 }).catch(() => {}))
  await Promise.all(guesses)
  assert.equal(answers, RATE)
  await assert.rejects(findByCode('tiger apfel', { lobby, timeout: 600 }), /timeout/)
  offer.close()
})
