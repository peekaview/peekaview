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
  // the picture of the start page's link preview is published with it
  const preview = (await readFile(resolve(dist, 'index.html'), 'utf8')).match(/property="og:image" content="https:\/\/peekaview\.de\/([^"]+)"/)
  assert.ok(preview && files.includes(preview[1]), 'og:image')
  assert.ok(files.includes('home-scene.js'))
  assert.ok(files.includes('word-code.js'))
  for (const page of ['impressum.html', 'datenschutz.html', 'sicherheit.html', 'warum.html', 'preise.html', 'legal.css', 'legal.js']) assert.ok(files.includes(page), page)
  assert.ok(files.includes('windows.js'))
  for (const page of ['share.html', 'share-helper.html', 'light-host.js', 'light-geometry.js', 'light-locate.js', 'light-capture.js', 'light-windows.js', 'light-crop.js', 'light-pick.js', 'light-track.js', 'light-title.js', 'light-pip.js', 'light-mini.js', 'light-help.js', 'light-clip.js']) assert.ok(files.includes(page), page)
  assert.ok(files.includes('vendor/pdfjs/pdf.worker.min.mjs'))
  assert.ok(files.includes('LICENSE.txt'))
  assert.ok(files.includes('vendor/pdfjs/LICENSE'))
  assert.equal(files.some(file => /(^|\/)(desktop|node_modules|\.git|\.env[^/]*|.*\.jsonc?|.*\.key)$/.test(file)), false)
  for (const file of files.filter(file => /\.(html|js|mjs)$/.test(file) && !file.startsWith('vendor/'))) {
    const code = await readFile(resolve(dist, file), 'utf8')
    for (const match of code.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      // every local module is asked for with the build's version (browser cache, build.mjs)
      assert.match(match[1], /\?v=[0-9a-f]{10}$/, `${file}: ${match[1]} without version`)
      const dependency = resolve(dirname(resolve(dist, file)), match[1].replace(/\?.*$/, ''))
      assert.ok(dependency.startsWith(dist + '/'), `${file}: module escapes public directory`)
      assert.ok((await stat(dependency)).isFile(), `${file}: missing ${match[1]}`)
    }
  }
  // the Content-Security-Policy allows no inline scripts: every page loads its script from a file
  for (const page of files.filter(file => file.endsWith('.html'))) {
    assert.doesNotMatch(await readFile(resolve(dist, page), 'utf8'), /<script\b(?![^>]*\ssrc=)[^>]*>/, `${page}: inline script`)
  }
  for (const page of files.filter(file => file.endsWith('.html'))) {
    const html = await readFile(resolve(dist, page), 'utf8')
    for (const [, url] of html.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)="([^"]+\.(?:js|css)[^"]*)"/g)) {
      assert.match(url, /\?v=[0-9a-f]{10}$/, `${page}: ${url} without version`)
    }
  }
  assert.match(await readFile(resolve(dist, '_headers'), 'utf8'), /Cache-Control: no-cache/)
})
