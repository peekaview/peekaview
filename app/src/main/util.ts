import path from 'path'
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'

export function resolvePath(dir: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, dir)
    : path.join(__dirname, '../../', dir)
}

// Helper method to generate consistent colors from username
export function generateColorFromName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Convert to hex color, ensuring good contrast and saturation
  return Math.abs(hash).toString(16).substring(0, 6).padEnd(6, 'f')
}

export function windowLoad(window: BrowserWindow, entryKey?: string | undefined, params?: Record<string, string>) {
  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${entryKey ? entryKey + '/': ''}index.html${params ? '?' + (new URLSearchParams(params).toString()) : ''}`)
  else
    window.loadFile(path.join(__dirname, `../renderer/${entryKey ? entryKey + '/': ''}index.html`), { query: params })
}