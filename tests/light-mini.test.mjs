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

test('the preview follows the pointer of the one shown, softly, the pointer in its middle – within the picture', async () => {
  const view = new MiniView(fakeCanvas())
  const image = { width: 1000, height: 600 }
  const capture = { image }
  try {
    view.reveal({ from: 'anna', points: [[0.2, 0.25], [0.25, 0.3]], capture, color: '#f00', name: 'Anna' })
    const first = { ...view.spot.crop }
    const middle = (c) => [(c.x + c.w / 2) / image.width, (c.y + c.h / 2) / image.height]
    assert.ok(Math.abs(middle(first)[0] - 0.225) < 0.01, 'around the stroke first')

    // somebody else's pointer: not followed
    view.pointer('ben', 0.6, 0.5)
    view.render()
    assert.equal(view.spot.pointer, undefined)

    // Anna's: a step each frame (not at once), there in the end
    view.pointer('anna', 0.6, 0.5)
    await wait(40)
    view.render()
    const step = middle(view.spot.crop)[0]
    assert.ok(step > middle(first)[0] && step < 0.59, `on its way: ${step}`)
    for (let i = 0; i < 20; i++) {
      await wait(40)
      view.render()
    }
    const [x, y] = middle(view.spot.crop)
    assert.ok(Math.abs(x - 0.6) < 0.01 && Math.abs(y - 0.5) < 0.01, `the pointer in the middle: ${x}, ${y}`)
    assert.equal(view.showing, true, 'still shown while it moves')

    // at the picture's edge: the part stays within the picture
    view.pointer('anna', 0.99, 0.99)
    for (let i = 0; i < 20; i++) {
      await wait(40)
      view.render()
    }
    const c = view.spot.crop
    assert.ok(Math.abs(c.x + c.w - image.width) < 1 && Math.abs(c.y + c.h - image.height) < 1, JSON.stringify(c))
    assert.deepEqual([c.w, c.h], [first.w, first.h], 'the same size')
  } finally {
    view.destroy()
  }
})

test('the part shown: around the stroke, in the window shape, within the picture', () => {
  const c = crop({ width: 1000, height: 600 }, [[0.5, 0.5]])
  assert.ok(Math.abs(c.w / c.h - 640 / 400) < 1e-9)
  assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1000 && c.y + c.h <= 600)
})
