// The picked window's titles, compared as read ("Bildschirmfreigabe light", light-title.js).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readable, sameTitle, words } from '../web/light-title.js'

const editor = '/Users/pno/workspace/LimTec/workspaces/w19289_dev_kundeneinstellungen_de.code-workspace'

test('a title read again is the same – also with a word misread or missing', () => {
  assert.equal(sameTitle(editor, editor), 1)
  assert.ok(sameTitle(editor, '/Users/pno/workspace/LimTec/workspaces/w19289_dev_kundeneinstelIungen_de.code-workspace') >= 0.8)
  assert.ok(sameTitle('Bildschirmfreigabe – Konzept.docx', 'Bildschirmfreigabe Konzept docx Word') >= 0.6)
})

test('another window, another document, or nothing read: not the same', () => {
  assert.ok(sameTitle(editor, 'samples.json — Nextpad++') < 0.6)
  assert.equal(sameTitle(editor, ''), 0)
  assert.equal(sameTitle('ab', 'ab'), 0, 'too little to tell')
  assert.equal(sameTitle('Mail', 'Mail'), 0, 'one short word says little')
  assert.deepEqual(words('Neuer Tab – Google Chrome'), ['neuer', 'tab', 'google', 'chrome'])
})

test('letter salad is not a title', () => {
  assert.equal(readable('Projektplan.txt — Editor', 92), true)
  assert.equal(readable('w19289_dev_kundeneinstellungen_de.code-workspace', 88), true)
  assert.equal(readable('Neuer Tab – Google Chrome', 80), true)
  assert.equal(readable('Projektplan.txt — Editor', 30), false, 'Tesseract not sure')
  assert.equal(readable('= ~ | ;: ,. // ++ ==', 70), false)
  assert.equal(readable('rrr Ts Ff Gk Wx Qp', 70), false)
  assert.equal(readable('', 90), false)
})
