// Publish only the browser viewer, never desktop IPC pages or repository files.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const web = resolve(here, '../web')
const dist = resolve(here, 'dist')
const files = [
  'index.html', 'start.js', 'download.js', 'page.js', 'fixed-rooms-page.js', 'share-page.js', 'share-helper.js', 'viewer.js', 'windows.js', 'signal.js', 'annotate.js',
  'icons.js', 'home-scene.js', 'word-code.js', 'voice.js', 'clipboard.js', 'vendor/noble-schnorr.js',
  'fixed-rooms.html', 'fixed-rooms.js', 'fixed-rooms.css', 'room-sw.js', 'download.html',
  'impressum.html', 'datenschutz.html', 'sicherheit.html', 'warum.html', 'preise.html', 'legal.css', 'legal.js', 'i18n.js',
  'room-pcm-worklet.js',
  // "Bildschirmfreigabe light": sharing from the browser
  'share.html', 'share-helper.html', 'light-host.js', 'light-geometry.js', 'light-locate.js',
  'light-capture.js', 'light-windows.js', 'light-crop.js', 'light-pick.js', 'light-track.js', 'light-title.js', 'light-pip.js', 'light-mini.js', 'light-help.js', 'light-clip.js',
  'rooms.webmanifest', 'room-icon.png',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/LICENSE',
]
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const file of files) {
  const target = resolve(dist, file)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(resolve(web, file), target)
}

// peekaview.de keeps scripts and styles in the browser for hours (Cloudflare's browser cache TTL
// overrides the no-cache of _headers): every page and module asks for them with this build's
// version, so a deploy is seen at the next reload – the pages themselves are never cached.
const hash = createHash('sha256')
for (const file of files) hash.update(file).update(await readFile(resolve(web, file)))
const version = hash.digest('hex').slice(0, 10)
const local = String.raw`\.{0,2}/?[\w./-]+\.(?:js|mjs|css)`
const versioned = (code) => code
  .replace(new RegExp(String.raw`(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}/[\w./-]+\.m?js)\2`, 'g'), `$1$2$3?v=${version}$2`)
  .replace(new RegExp(String.raw`(<(?:script|link)\b[^>]*\s(?:src|href)=")(${local})"`, 'g'), `$1$2?v=${version}"`)
for (const file of files.filter((f) => /\.(html|js)$/.test(f) && !f.startsWith('vendor/'))) {
  const target = resolve(dist, file)
  await writeFile(target, versioned(await readFile(target, 'utf8')))
}
await copyFile(resolve(here, '../LICENSE'), resolve(dist, 'LICENSE.txt'))
await copyFile(resolve(here, '_headers'), resolve(dist, '_headers'))
console.log(`Built viewer: ${dist}`)
