// Publish only the browser viewer, never desktop IPC pages or repository files.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const web = resolve(here, '../web')
const dist = resolve(here, 'dist')
const files = [
  'index.html', 'viewer.js', 'windows.js', 'signal.js', 'annotate.js',
  'icons.js', 'voice.js', 'clipboard.js', 'vendor/noble-schnorr.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/LICENSE',
]
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const file of files) {
  const target = resolve(dist, file)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(resolve(web, file), target)
}
await copyFile(resolve(here, '../LICENSE'), resolve(dist, 'LICENSE.txt'))
await copyFile(resolve(here, '_headers'), resolve(dist, '_headers'))
console.log(`Built viewer: ${dist}`)
