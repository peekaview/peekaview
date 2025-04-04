import path from 'path'
import { app, desktopCapturer, BrowserWindow, nativeImage, nativeTheme } from 'electron'
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
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/windows/${entryKey ? entryKey + '/': ''}index.html${params ? '?' + (new URLSearchParams(params).toString()) : ''}`)
  else
    window.loadFile(path.join(__dirname, `../renderer/windows/${entryKey ? entryKey + '/': ''}index.html`), { query: params })
}

export function isBlacklistedWindow(title: string) {
  return title.startsWith('__peekaview') || title.trim() == 'peekaview'
}

export async function getWindowList() {
  // var promise = Promise.resolve();
  const windowlist: string[] = []

  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { height: 0, width: 0 } })
  for (const s in sources) {
    if (!isBlacklistedWindow(sources[s].name)) {
      const hwnd = sources[s].id.split(':')[1]
      windowlist.push(hwnd)
    }
  }

  return windowlist
}

export async function getWindowListFormatted(options: Electron.SourcesOptions) {
  return desktopCapturer.getSources(options)
    .then((sources) => 
      sources.map((source) => {
        return {
          id: source.id,
          name: source.name,
          url: source.thumbnail.toDataURL(),
        }
      }),
    )
}

export function createMenuIcon(iconPath: string) {
  let icon = nativeImage.createFromPath(path.join(__dirname, iconPath))
  
  if (process.platform === 'darwin') {
    icon = invertIcon(icon)
    icon.setTemplateImage(true)
    return icon.resize({ width: 16, height: 16 })
  }

  if (process.platform === 'win32' && !nativeTheme.shouldUseDarkColors) {
    icon = invertIcon(icon)
  }

  return icon.resize({ 
    width: 16, 
    height: 16,
    quality: 'best'  // Use best quality to preserve transparency
  })
}

export function invertIcon(icon: Electron.NativeImage) {
  // Get bitmap data and size
  const size = icon.getSize()
  const bitmap = icon.getBitmap()
  
  // Invert colors (each pixel has 4 values: R,G,B,A)
  for (let i = 0; i < bitmap.length; i += 4) {
    // Only invert if the pixel is not fully transparent
    if (bitmap[i + 3] > 5) {
      bitmap[i] = 255 - bitmap[i]     // R
      bitmap[i + 1] = 255 - bitmap[i + 1] // G
      bitmap[i + 2] = 255 - bitmap[i + 2] // B
    }
    // Leave alpha channel (i + 3) unchanged
  }
  
  // Create new image from inverted bitmap with correct dimensions
  return nativeImage.createFromBitmap(bitmap, size)
}

const cmdCache: Record<string, {time: number, result: any}> = {}
export function executeCmdCached(cmd: string, maxCacheAge = 0) {
  const cacheKey = cmd.replace(/[^a-zA-Z0-9]/g, '')

  if (cmdCache[cacheKey] === undefined)
    cmdCache[cacheKey] = { time: 0, result: null }

  if (cmdCache[cacheKey].time < (Date.now() - maxCacheAge) || cmdCache[cacheKey].result == null) {
    //console.log(cmd)
    cmdCache[cacheKey] = { time: Date.now(), result: require('child_process').execSync(cmd) }
  }

  return cmdCache[cacheKey].result
}

export function executeCmd(cmd: string) {
  //console.log(cmd)
  return require('child_process').execSync(cmd) as string
}

export function executeCmdAsync(cmd: string) {
  return new Promise((resolve, reject) => {
    require('child_process').exec(cmd, (error, stdout, _stderr) => {
      if (error) {
        console.warn(`Error executing command: ${error}`);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}