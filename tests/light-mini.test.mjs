import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MiniView, crop, span } from '../web/light-mini.js'

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
const middle = (c) => [(c.x + c.w / 2) / image.width, (c.y + c.h / 2) / image.height]
async function frames(view, n = 8) {
  for (let i = 0; i < n; i++) {
    await wait(30)
    view.render()
  }
}

test('the preview follows the viewers\' pointers right away: one in its middle, several within it; one at rest goes', async () => {
  const view = new MiniView(fakeCanvas())
  try {
    view.reveal({ from: 'anna', points: [[0.2, 0.25], [0.25, 0.3]], capture: { image }, color: '#f00', name: 'Anna' })
    const first = { ...view.spot.crop }
    assert.ok(Math.abs(middle(first)[0] - 0.225) < 0.01, 'around the stroke first')

    // Anna's pointer: there within a few frames, in the middle
    view.pointer('anna', 0.6, 0.5)
    await frames(view)
    let [x, y] = middle(view.spot.crop)
    assert.ok(Math.abs(x - 0.6) < 0.01 && Math.abs(y - 0.5) < 0.01, `the pointer in the middle: ${x}, ${y}`)
    assert.deepEqual([view.spot.crop.w, view.spot.crop.h].map(Math.round), [first.w, first.h].map(Math.round), 'the same size')

    // Ben's, too, far away: the part grows to hold both
    view.pointer('anna', 0.3, 0.3)
    view.pointer('ben', 0.8, 0.7)
    await frames(view)
    const c = view.spot.crop
    for (const [px, py] of [[300, 180], [800, 420]]) assert.ok(c.x < px && px < c.x + c.w && c.y < py && py < c.y + c.h, `${px},${py} within ${JSON.stringify(c)}`)
    assert.ok(c.w > first.w + 50, 'larger')

    // Ben rests (Anna goes on moving): his pointer fades and goes, the part follows Anna alone again
    for (let i = 0; i < 9; i++) {
      view.pointer('anna', 0.4, 0.4)
      await wait(250)
      view.render()
    }
    assert.deepEqual(view.activePointers().map((p) => p.x), [0.4], 'Ben no longer followed')
    await frames(view)
    ;[x, y] = middle(view.spot.crop)
    assert.ok(Math.abs(x - 0.4) < 0.02 && Math.abs(y - 0.4) < 0.02 && Math.abs(view.spot.crop.w - first.w) < 3, JSON.stringify(view.spot.crop))

    // a pointer that left the picture: gone at once
    view.hidePointer('anna')
    assert.equal(view.activePointers().length, 0)
  } finally {
    view.destroy()
  }
})

test('the part holding the pointers: in the window shape, at the picture\'s edge within it, never smaller than at first', () => {
  const base = { w: 400, h: 250 }
  const one = span(image, [{ x: 0.99, y: 0.99 }], base)
  assert.deepEqual([one.w, one.h], [400, 250])
  assert.ok(Math.abs(one.x + one.w - 1000) < 1e-9 && Math.abs(one.y + one.h - 600) < 1e-9)
  const all = span(image, [{ x: 0, y: 0 }, { x: 1, y: 1 }], base)
  assert.ok(all.w <= 1000 && all.h <= 600 && Math.abs(all.w / all.h - 640 / 400) < 1e-9)
})

test('the part shown: around the stroke, in the window shape, within the picture', () => {
  const c = crop(image, [[0.5, 0.5]])
  assert.ok(Math.abs(c.w / c.h - 640 / 400) < 1e-9)
  assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1000 && c.y + c.h <= 600)
})
