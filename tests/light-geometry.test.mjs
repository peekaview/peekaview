// Where the helper window of "Bildschirmfreigabe light" goes on the presenter's screen.
import assert from 'node:assert/strict'
import test from 'node:test'
import { bounds, fit, inside, matchesScreen, monitorRect, movesWindows, placeWindow, spotRect, stageInContent, usableArea, visiblePart, windowRect } from '../web/light-geometry.js'

test('the shared screen: exact where the browser says, below the menu bar estimated on a Mac', () => {
  // Firefox: the screen's own corner
  assert.deepEqual(monitorRect({ left: 1440, top: -200, width: 1920, height: 1080, availLeft: 1440, availTop: -175, availHeight: 1055 }), { left: 1440, top: -200, width: 1920, height: 1080 })
  // Chrome on a Mac: only the usable area, which starts below the menu bar
  assert.deepEqual(monitorRect({ width: 1512, height: 982, availLeft: 0, availTop: 25, availHeight: 900 }, { mac: true }), { left: 0, top: 0, width: 1512, height: 982 })
  // a second screen on a Mac, the Dock elsewhere: only the menu bar (30 px) is missing
  assert.deepEqual(monitorRect({ width: 2560, height: 1440, availLeft: 2560, availTop: 30, availHeight: 1410 }, { mac: true }), { left: 2560, top: 0, width: 2560, height: 1440 })
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

test('a shared window found on the screen: points map onto it, the helper stays on the screen', () => {
  const monitor = { left: 0, top: 0, width: 1000, height: 800 }
  const win = windowRect({ x: 0.5, y: 0.25, w: 0.4, h: 0.5 }, monitor)
  assert.deepEqual(win, { left: 500, top: 200, width: 400, height: 400 })
  // the middle of the window
  assert.deepEqual(spotRect({ x: 0.5, y: 0.5 }, win, { width: 300, height: 200 }, monitor), { left: 550, top: 300, width: 300, height: 200 })
  // its right edge: the helper may stick out of the window, not out of the screen
  assert.deepEqual(spotRect({ x: 1, y: 0.5 }, win, { width: 300, height: 200 }, monitor), { left: 700, top: 300, width: 300, height: 200 })
  assert.deepEqual(stageInContent({ left: 550, top: 300, width: 300, height: 200 }, win), { left: -50, top: -100, width: 400, height: 400 })
})

test('the helper grows to a whole stroke', () => {
  assert.deepEqual(bounds([[0.2, 0.5], [0.4, 0.3], [0.3, 0.6]]), { x: 0.2, y: 0.3, w: 0.2, h: 0.3 })
})

test('usableArea: the usable part of a window\'s screen – Firefox\'s second screen counted from its own corner made whole', () => {
  // Chrome, the first screen (menu bar above)
  assert.deepEqual(usableArea({ availLeft: 0, availTop: 25, availWidth: 2560, availHeight: 1415, width: 2560, height: 1440 }), { left: 0, top: 25, width: 2560, height: 1415 })
  // Firefox, a second screen on the right: left 2560, availLeft 0
  assert.deepEqual(usableArea({ left: 2560, top: 0, availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440, width: 2560, height: 1440 }), { left: 2560, top: 0, width: 2560, height: 1440 })
  // … on the left, and above
  assert.deepEqual(usableArea({ left: -1920, top: 0, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080, width: 1920, height: 1080 }).left, -1920)
  assert.deepEqual(usableArea({ left: 0, top: -1080, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080, width: 1920, height: 1080 }).top, -1080)
  // the right numbers stay as they are
  assert.deepEqual(usableArea({ left: 2560, top: 0, availLeft: 2560, availTop: 25, availWidth: 2560, availHeight: 1415, width: 2560, height: 1440 }), { left: 2560, top: 25, width: 2560, height: 1415 })
})

test('placeWindow: moved and sized – on Firefox\'s second screen only sized, within the room right of and below it', () => {
  const calls = []
  const fake = (screen, x, y) => ({ screen, screenX: x, screenY: y, resizeTo: (w, h) => calls.push(['size', w, h]), moveTo: (l, t) => calls.push(['move', l, t]) })
  const first = { left: 0, top: 0, availLeft: 0, availTop: 25, availWidth: 2560, availHeight: 1415, width: 2560, height: 1440 }
  const second = { left: 2560, top: 0, availLeft: 0, availTop: 25, availWidth: 2560, availHeight: 1415, width: 2560, height: 1440 }
  assert.equal(movesWindows(first), true)
  assert.equal(movesWindows(second), false)
  assert.equal(movesWindows({ availLeft: 2560, availTop: 25, availWidth: 2560, availHeight: 1415, width: 2560, height: 1440 }), true, 'Chrome: no screen.left')
  placeWindow(fake(first, 100, 100), { left: 2184, top: 1000, width: 360, height: 400 })
  assert.deepEqual(calls.splice(0), [['size', 360, 400], ['move', 2184, 1000]])
  placeWindow(fake(second, 4500, 600), { left: 3000, top: 200, width: 1100, height: 1200 })
  assert.deepEqual(calls.splice(0), [['size', 612, 832]])
})

test('calmFollow: one pointer, the same size; still in the middle 90 % and while it trembles; past it a new part with the pointer in its middle', async () => {
  const { calmFollow } = await import('../web/light-geometry.js')
  const opts = { width: 1000, height: 600 }
  const cur = { x: 100, y: 100, w: 400, h: 250 }
  const state = {}
  const step = (points, ms = 16) => calmFollow(state, cur, points, ms, opts)
  // inside the middle 90 % (120..480, 112.5..337.5): still
  assert.deepEqual(step([{ id: 'a', x: 125, y: 225 }]), cur)
  assert.deepEqual(step([{ id: 'a', x: 475, y: 120 }]), cur)
  // past it: a new part, the pointer in its middle on that side – the size kept
  let g = step([{ id: 'a', x: 490, y: 225 }])
  assert.deepEqual(g, { x: 290, y: 100, w: 400, h: 250 })
  // and still there again – also trembling, also resting
  for (let t = 0; t < 3000; t += 100) assert.deepEqual(step([{ id: 'a', x: 490 + (t % 200 ? 3 : -3), y: 226 }], 100), g)
  // at the picture's edge: within it
  g = step([{ id: 'a', x: 990, y: 590 }])
  assert.deepEqual(g, { x: 600, y: 350, w: 400, h: 250 })

  // a second pointer moving while the first one moves, too: still the first one followed
  const s2 = {}
  const cur2 = { x: 300, y: 175, w: 400, h: 250 }
  let h = calmFollow(s2, cur2, [{ id: 'a', x: 500, y: 300 }], 16, opts)
  for (let i = 0; i < 5; i++) h = calmFollow(s2, cur2, [{ id: 'a', x: 600 + i * 30, y: 300 }, { id: 'b', x: 50 + i * 10, y: 50 }], 100, opts)
  assert.equal(s2.lead, 'a')
  assert.ok(h.x > 300, 'on with a')
  // the first resting: the other one, moving, taken over
  for (let i = 0; i < 12; i++) h = calmFollow(s2, cur2, [{ id: 'a', x: 720, y: 300 }, { id: 'b', x: 100 + i * 10, y: 50 + i * 5 }], 100, opts)
  assert.equal(s2.lead, 'b')
  assert.ok(h.x < 300 && h.w === 400, 'b inside, never larger or smaller')
})

test('softMove: eased in and out to the new part, anew when it changes', async () => {
  const { softMove } = await import('../web/light-geometry.js')
  const anim = {}
  const a = { x: 0, y: 0, w: 100, h: 50 }
  const b = { x: 300, y: 0, w: 100, h: 50 }
  assert.deepEqual(softMove(anim, a, b, 0, 1000), a)
  assert.ok(softMove(anim, a, b, 100, 1000).x < 3, 'slow at first')
  assert.equal(softMove(anim, a, b, 500, 1000).x, 150)
  assert.ok(softMove(anim, a, b, 900, 1000).x > 297, 'slow at the end')
  assert.deepEqual(softMove(anim, a, b, 1000, 1000), b)
  assert.equal(anim.done, true)
})
