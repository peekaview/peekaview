import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, 'dist')

test('public build includes all viewer modules and excludes private and desktop files', async () => {
  execFileSync(process.execPath, [resolve(here, 'build.mjs')])
  const files = await readdir(dist, { recursive: true })
  assert.ok(files.includes('index.html'))
  assert.ok(files.includes('download.html'))
  for (const page of ['impressum.html', 'datenschutz.html', 'sicherheit.html', 'legal.css', 'legal.js']) assert.ok(files.includes(page), page)
  assert.ok(files.includes('windows.js'))
  assert.ok(files.includes('vendor/pdfjs/pdf.worker.min.mjs'))
  assert.ok(files.includes('LICENSE.txt'))
  assert.ok(files.includes('vendor/pdfjs/LICENSE'))
  assert.equal(files.some(file => /(^|\/)(desktop|node_modules|\.git|\.env[^/]*|.*\.jsonc?|.*\.key)$/.test(file)), false)
  for (const file of files.filter(file => /\.(html|js|mjs)$/.test(file) && !file.startsWith('vendor/'))) {
    const code = await readFile(resolve(dist, file), 'utf8')
    for (const match of code.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const dependency = resolve(dirname(resolve(dist, file)), match[1])
      assert.ok(dependency.startsWith(dist + '/'), `${file}: module escapes public directory`)
      assert.ok((await stat(dependency)).isFile(), `${file}: missing ${match[1]}`)
    }
  }
  assert.match(await readFile(resolve(dist, '_headers'), 'utf8'), /Cache-Control: no-cache/)
})
