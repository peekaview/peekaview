import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MiniView, crop } from '../web/light-mini.js'

// a canvas that draws nothing
function fakeCanvas() {
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  })
  return { width: 0, height: 0, getContext: () => ctx }
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const image = { width: 1000, height: 600 }
async function frames(view, n = 25) {
  for (let i = 0; i < n; i++) {
    await wait(40)
    view.render()
  }
}
const middle = (c) => [c.x + c.w / 2, c.y + c.h / 2]
const within = (c, px, py) => c.x <= px && px <= c.x + c.w && c.y <= py && py <= c.y + c.h

test('the preview follows the viewers\' pointers calmly: one, at the same size; still in the middle 90 %; past it once to a new part, then still', async () => {
  const view = new MiniView(fakeCanvas())
  try {
    view.reveal({ from: 'anna', points: [[0.2, 0.25], [0.25, 0.3]], capture: { image }, color: '#f00', name: 'Anna' })
    const first = { ...view.spot.crop }

    // inside: nothing moves
    view.pointer('anna', (first.x + first.w * 0.08) / 1000, (first.y + first.h / 2) / 600)
    await frames(view, 6)
    view.pointer('anna', (first.x + first.w * 0.92) / 1000, (first.y + first.h * 0.1) / 600)
    await frames(view, 6)
    assert.deepEqual(view.spot.crop, first, 'still while the pointer moves inside')

    // far off to the right: once, softly, to a new part with the pointer in its middle – then still
    view.pointer('anna', 0.7, 0.4)
    await frames(view, 4)
    let c = view.spot.crop
    assert.ok(c.x > first.x && Math.abs(middle(c)[0] - 700) > 50, `on the way: ${JSON.stringify(c)}`)
    await frames(view, 25)
    c = view.spot.crop
    assert.ok(Math.abs(middle(c)[0] - 700) < 1 && within(c, 700, 240) && c.y === first.y, `there – moved sideways only, as it went out sideways: ${JSON.stringify(c)}`)
    assert.deepEqual([c.w, c.h], [first.w, first.h], 'the same size')
    const there = { ...c }
    for (let i = 0; i < 6; i++) {
      view.pointer('anna', 0.7 + (i % 2 ? 0.1 : -0.1), 0.4 + (i % 2 ? 0.01 : 0))
      await frames(view, 3)
    }
    assert.deepEqual(view.spot.crop, there, 'still while it moves about inside')

    // Ben moves, too, while Anna moves on: still Anna followed, at the same size
    for (let i = 0; i < 5; i++) {
      view.pointer('anna', 0.7 - (i + 1) * 0.012, 0.4)
      view.pointer('ben', 0.05 + i * 0.02, 0.9)
      await frames(view, 3)
    }
    assert.deepEqual(view.spot.crop, there)
    assert.equal(view.spot.follow.lead, 'anna')
    // Anna rests, Ben goes on: then Ben is followed
    for (let i = 0; i < 20; i++) {
      view.pointer('ben', 0.15 + i * 0.002, 0.9 - i * 0.01)
      await frames(view, 2)
    }
    assert.equal(view.spot.follow.lead, 'ben')
    await frames(view, 25)
    c = view.spot.crop
    assert.ok(within(c, 188, 426), `Ben inside: ${JSON.stringify(c)}`)
    assert.deepEqual([c.w, c.h], [first.w, first.h], 'not larger for two')

    // resting pointers fade and go
    await wait(2100)
    assert.equal(view.activePointers().length, 0)
    // a pointer that left the picture: gone at once
    view.pointer('anna', 0.5, 0.5)
    view.hidePointer('anna')
    assert.equal(view.activePointers().length, 0)
  } finally {
    view.destroy()
  }
})

test('the part shown: around the stroke, in the window shape, within the picture', () => {
  const c = crop(image, [[0.5, 0.5]])
  assert.ok(Math.abs(c.w / c.h - 640 / 400) < 1e-9)
  assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1000 && c.y + c.h <= 600)
})
