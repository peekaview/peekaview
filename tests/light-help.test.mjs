// The card beside the browser's dialog (light-help.js): which browser's dialog, Mac or Windows.
import assert from 'node:assert/strict'
import test from 'node:test'
import { dialogKind, platformKind } from '../web/light-help.js'

test('dialogKind: Firefox, Edge, Chrome – Safari gets no card', () => {
  assert.equal(dialogKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0'), 'firefox')
  assert.equal(dialogKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'edge')
  assert.equal(dialogKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'), 'chrome')
  assert.equal(dialogKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), null)
})

test('platformKind: a Mac, else Windows (Linux looks alike: the buttons on the right)', () => {
  assert.equal(platformKind('MacIntel', ''), 'mac')
  assert.equal(platformKind('Win32', ''), 'windows')
  assert.equal(platformKind('Linux x86_64', 'X11; Linux x86_64'), 'windows')
})
