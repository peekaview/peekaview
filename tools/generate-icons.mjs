// Regenerate platform assets from the same vector used by the UI.
// Requires librsvg (rsvg-convert), ImageMagick and macOS iconutil.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { owl } from '../web/icons.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const icons = join(repo, 'client/src-tauri/icons')
const temp = mkdtempSync(join(tmpdir(), 'peekaview-icons-'))
const mark = owl(24).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
const svg = (size, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size}">${content}</svg>`
const foreground = (x, y, side, color = '#fff') => `<g fill="${color}" transform="translate(${x} ${y}) scale(${side / 24})">${mark}</g>`
const tile = svg(1024, '<rect x="80" y="80" width="864" height="864" rx="194" fill="#ef4444"/>' + foreground(152, 152, 720))
const render = (source, side, output) => execFileSync('rsvg-convert', ['-w', String(side), '-h', String(side), '-o', output, source])
try {
  const source = join(icons, 'icon.svg')
  writeFileSync(source, tile)
  writeFileSync(join(icons, 'owl.svg'), svg(24, foreground(0, 0, 24, '#000')))
  for (const [name, side] of [['icon.png', 1024], ['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) render(source, side, join(icons, name))
  copyFileSync(join(icons, '128x128.png'), join(repo, 'web/desktop/app-icon.png'))
  render(join(icons, 'owl.svg'), 44, join(icons, 'tray.png'))
  execFileSync('magick', [join(icons, 'icon.png'), '-define', 'icon:auto-resize=256,128,64,48,32,16', join(icons, 'icon.ico')])
  const iconset = join(temp, 'PeekaView.iconset')
  mkdirSync(iconset)
  for (const side of [16, 32, 128, 256, 512]) {
    render(source, side, join(iconset, `icon_${side}x${side}.png`))
    render(source, side * 2, join(iconset, `icon_${side}x${side}@2x.png`))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(icons, 'icon.icns')])
  const android = join(temp, 'android.svg')
  writeFileSync(android, svg(432, foreground(90, 90, 252)))
  render(android, 432, join(repo, 'android/app/src/main/res/drawable-xxxhdpi/ic_launcher_foreground.png'))
} finally { rmSync(temp, { recursive: true, force: true }) }
