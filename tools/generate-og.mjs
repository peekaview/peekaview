// The picture messengers show for a sent link (og:image of the start page): web/og.png.
// Requires librsvg (rsvg-convert).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { owl } from '../web/icons.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mark = owl(24).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
const font = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"'
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="glow" cx="50%" cy="100%" r="75%"><stop offset="0" stop-color="#ef4444" stop-opacity=".28"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></radialGradient></defs>
  <rect width="1200" height="630" fill="#09090b"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g fill="#fafafa" transform="translate(90 84) scale(3)">${mark}</g>
  <text x="178" y="138" ${font} font-size="48" font-weight="700" fill="#fafafa">PeekaView</text>
  <text x="90" y="330" ${font} font-size="104" font-weight="700" letter-spacing="-3" fill="#fafafa">Bildschirm teilen</text>
  <text x="90" y="446" ${font} font-size="104" font-weight="700" letter-spacing="-3" fill="#ef4444">im Browser.</text>
  <text x="92" y="540" ${font} font-size="34" font-weight="500" fill="#a1a1aa">Link öffnen, Bildschirm ansehen · Ende-zu-Ende verschlüsselt</text>
</svg>`
const temp = mkdtempSync(join(tmpdir(), 'peekaview-og-'))
try {
  writeFileSync(join(temp, 'og.svg'), svg)
  execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', join(repo, 'web/og.png'), join(temp, 'og.svg')])
} finally { rmSync(temp, { recursive: true, force: true }) }
