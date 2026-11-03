// Where the helper window of "Bildschirmfreigabe light" goes on the presenter's screen.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fit, inside, matchesScreen, monitorRect, spotRect, stageInContent, visiblePart } from '../web/light-geometry.js'

test('the shared screen: exact where the browser says, below the menu bar estimated on a Mac', () => {
  // Firefox: the screen's own corner
  assert.deepEqual(monitorRect({ left: 1440, top: -200, width: 1920, height: 1080, availLeft: 1440, availTop: -175, availHeight: 1055 }), { left: 1440, top: -200, width: 1920, height: 1080 })
  // Chrome on a Mac: only the usable area, which starts below the menu bar
  assert.deepEqual(monitorRect({ width: 1512, height: 982, availLeft: 0, availTop: 25, availHeight: 900 }, { mac: true }), { left: 0, top: 0, width: 1512, height: 982 })
  // Windows: the taskbar is at the bottom, the usable area starts at the top
  assert.deepEqual(monitorRect({ width: 1920, height: 1080, availLeft: 0, availTop: 0, availHeight: 1040 }), { left: 0, top: 0, width: 1920, height: 1080 })
  // Chrome with "window management" already allowed
  assert.deepEqual(monitorRect({ width: 1, height: 1 }, { details: { left: -1920, top: 0, width: 1920, height: 1200 } }), { left: -1920, top: 0, width: 1920, height: 1200 })
})

test('a picture belongs to this screen only with the same aspect ratio (Retina pixels included)', () => {
  const monitor = { left: 0, top: 0, width: 1512, height: 982 }
  assert.equal(matchesScreen({ width: 3024, height: 1964 }, monitor), true)
  assert.equal(matchesScreen({ width: 1920, height: 1080 }, monitor), false)
  assert.equal(matchesScreen({}, monitor), false)
})

test('the helper covers the spot with the point in its middle, inside the screen', () => {
  const monitor = { left: 100, top: 0, width: 1000, height: 800 }
  const size = { width: 400, height: 300 }
  assert.deepEqual(spotRect({ x: 0.5, y: 0.5 }, monitor, size), { left: 400, top: 250, width: 400, height: 300 })
  // at a corner it moves inside the screen
  assert.deepEqual(spotRect({ x: 0, y: 1 }, monitor, size), { left: 100, top: 500, width: 400, height: 300 })
  // a small screen: never larger than it
  assert.deepEqual(spotRect({ x: 0.5, y: 0.5 }, { left: 0, top: 0, width: 300, height: 200 }, size), { left: 0, top: 0, width: 300, height: 200 })
})

test('the picture lies 1:1 under the helper, wherever the browser put it', () => {
  const monitor = { left: 100, top: 0, width: 1000, height: 800 }
  const content = { left: 420, top: 260, width: 400, height: 300 }
  assert.deepEqual(stageInContent(content, monitor), { left: -320, top: -260, width: 1000, height: 800 })
  const part = visiblePart(content, monitor)
  assert.deepEqual(part, { x: 0.32, y: 0.325, w: 0.4, h: 0.375 })
  assert.equal(inside({ x: 0.5, y: 0.5 }, part), true)
  assert.equal(inside({ x: 0.33, y: 0.5 }, part), false, 'too close to the edge: jump on')
  assert.equal(inside({ x: 0.9, y: 0.5 }, part), false)
})

test('a window or tab is shown whole, fitted and centered', () => {
  assert.deepEqual(fit({ width: 1600, height: 900 }, { width: 800, height: 600 }), { left: 0, top: 75, width: 800, height: 450 })
})
