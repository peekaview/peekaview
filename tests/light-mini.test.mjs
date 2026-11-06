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
// in the part's inner 65 %
const inner = (c, px, py) => px >= c.x + c.w * 0.175 - 1 && px <= c.x + c.w * 0.825 + 1 && py >= c.y + c.h * 0.175 - 1 && py <= c.y + c.h * 0.825 + 1

test('the preview follows the viewers\' pointers calmly: still while they move inside, on when one nears the edge; several held; one at rest goes', async () => {
  const view = new MiniView(fakeCanvas())
  try {
    view.reveal({ from: 'anna', points: [[0.2, 0.25], [0.25, 0.3]], capture: { image }, color: '#f00', name: 'Anna' })
    const first = { ...view.spot.crop }

    // inside: nothing moves
    view.pointer('anna', (first.x + first.w / 2) / 1000, (first.y + first.h / 2) / 600)
    await frames(view, 6)
    assert.deepEqual(view.spot.crop, first, 'still while the pointer moves inside')

    // far off to the right: the part moves on, just so far that the pointer is inside again (not to the middle)
    view.pointer('anna', 0.7, 0.4)
    await frames(view, 12)
    let c = view.spot.crop
    assert.ok(inner(c, 700, 240), `the pointer inside: ${JSON.stringify(c)}`)
    assert.ok(c.x + c.w / 2 < 640, 'not centered on it at once')
    assert.deepEqual([c.w, c.h].map(Math.round), [first.w, first.h].map(Math.round), 'the same size')
    // … then it glides slowly on until the pointer is in the middle (the pointer resting)
    await frames(view, 100)
    c = view.spot.crop
    assert.ok(Math.abs(c.x + c.w / 2 - 700) < 6 && Math.abs(c.y + c.h / 2 - 240) < 6, `centered in the end: ${JSON.stringify(c)}`)

    // (Anna's pointer rested meanwhile and went: it moves again) Ben, too, far away: the part grows to hold both
    view.pointer('anna', 0.7, 0.4)
    view.pointer('ben', 0.2, 0.75)
    await frames(view)
    c = view.spot.crop
    for (const [px, py] of [[700, 240], [200, 450]]) assert.ok(c.x <= px && px <= c.x + c.w && c.y <= py && py <= c.y + c.h, `${px},${py} within ${JSON.stringify(c)}`)
    assert.ok(c.w > first.w + 50, 'larger')

    // Ben rests (Anna goes on moving): his pointer fades and goes, the part shrinks back
    for (let i = 0; i < 9; i++) {
      view.pointer('anna', 0.7, 0.4)
      await wait(250)
      view.render()
    }
    assert.deepEqual(view.activePointers().map((p) => p.x), [0.7], 'Ben no longer followed')
    await frames(view)
    assert.ok(Math.abs(view.spot.crop.w - first.w) < 3, JSON.stringify(view.spot.crop))

    // a pointer that left the picture: gone at once
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
