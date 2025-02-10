import {
  mouse,
  Point,
  clipboard,
  keyboard,
  Key,
  Button,
} from '@nut-tree-fork/nut-js'
import path from 'path'
import { ipcMain, BrowserWindow, screen } from 'electron'
// import { fileTypeFromBlob } from 'file-type';

import { SourceManager } from '../sources/SourceManager.js'
import { windowLoad } from '../util.js'
import { Dimensions, ElectronWindowDimensions, File, RemoteData, RemoteEvent, RemoteTextData, RemoteFileData, RemoteMouseData, RemoteFileChunkData, UserData } from '../../interface.d'
import { useFileChunkRegistry } from '../../composables/useFileChunking.js'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

const controlkey = isMac ? Key.LeftSuper : Key.LeftControl

export function useRemotePresenter(sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void, newUsers: UserData[] = []) {
  const mousePressed: Record<string, boolean> = {}

  let overlayWindow: BrowserWindow | undefined
  let clipboardWindow: BrowserWindow | undefined
  let toolbarWindow: BrowserWindow | undefined
  let toolbarSize: { width: number, height: number } | {} = {}
  let localClipboardTime = 0
  let lastClipboardData: File = {
    content: 'data:text/plain;base64,'
  }
  let lastKey: string
  let active = false
  let remoteControlActive = false
  let mouseEnabled = true
  let lastMouseEnabled: boolean | undefined = undefined
  let windowBorders: Dimensions = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  }
  let sourceManager: SourceManager
  let users: UserData[] = newUsers
  const fileChunkRegistry = useFileChunkRegistry(dataToClipboard)

  function deactivate() {
    active = false

    overlayWindow?.close()
    toolbarWindow?.close()
    clipboardWindow?.close()
  }

  function activate(manager: SourceManager) {
    sourceManager = manager
    active = true
    createOverlayWindow()
    createToolbarWindow()
  }

  function updateWindowBorders(newBorders: Dimensions) {
    windowBorders = newBorders
  }

  function toggleRemoteControl(toggle?: boolean) {
    if (remoteControlActive === toggle)
      return

    if (toggle === undefined)
      toggle = !remoteControlActive

    console.log('Toggling remote control', toggle)
    remoteControlActive = toggle
    if (toggle) {
      const enabled = mouseEnabled
      toggleMouse(true)
      lastMouseEnabled = enabled
    }
    else if (lastMouseEnabled !== undefined)
      toggleMouse(lastMouseEnabled)

    overlayWindow?.webContents.send('on-update-overlay-data', { remoteControlActive })
    sendRemote('remote-control', { enabled: remoteControlActive })
  }

  function toggleMouse(toggle?: boolean) {
    if (mouseEnabled === toggle)
      return

    lastMouseEnabled = undefined

    if (toggle === undefined)
      toggle = !mouseEnabled

    console.log('Toggling mouse control', toggle)
    mouseEnabled = toggle
    if (!mouseEnabled)
      hideOverlays()

    overlayWindow?.webContents.send('on-update-overlay-data', { mouseEnabled })
    sendRemote('mouse-control', { enabled: mouseEnabled })
  }

  function createOverlayWindow() {
    if (overlayWindow)
      return

    const { x, y, width, height } = sourceManager.getOverlayRectangle()

    overlayWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      roundedCorners: false,
      enableLargerThanScreen: true,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/overlay.js'),
        webSecurity: false,
        nodeIntegration: true,
        contextIsolation: true,
      },
    })

    console.log("Overlay window created:", overlayWindow.getBounds())

    overlayWindow.removeMenu()
    overlayWindow.setIgnoreMouseEvents(true)
    //overlayWindow.webContents.openDevTools()
    
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    windowLoad(overlayWindow, 'overlay')

    if (sourceManager.fixOverlayBoundsAfterCreation) {
      overlayWindow.setBounds({ x, y, width, height }, false) // false means don't animate the change
    }

    return new Promise<void>((resolve) => {
      overlayWindow!.on('ready-to-show', () => {
        toolbarWindow?.moveTop()
        overlayWindow!.webContents.send('on-update-overlay-data', { users, scale: 1 / sourceManager.getScaleFactor() })
        resolve()
      })
    })
  }

  function hideOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.hide() // First hide the window
        setTimeout(() => { // Add delay before closing
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.close()
            overlayWindow = undefined
          }
        }, 100)
      } catch (error) {
        console.warn('Error closing overlay window:', error)
        overlayWindow = undefined // Reset reference if error occurs
      }
    }
  }

  async function sendToOverlayWindow(action: string, data: RemoteMouseData) {
    if (!overlayWindow)
      await createOverlayWindow()

    if (!data.userId || !active)
      return
  
    overlayWindow!.webContents.send(action, data)
  }

  async function dataToClipboard(data: File) {
    if (!clipboardWindow)
      await createClipboardWindow()

    lastClipboardData = data

    clipboardWindow!.webContents.send('data-to-clipboard', JSON.stringify(data))
  }

  function createClipboardWindow() {
    if (clipboardWindow)
      return

    const width = 240
    const height = 320

    const primary = screen.getPrimaryDisplay()
    clipboardWindow = new BrowserWindow({
      width,
      height,
      minWidth: width,
      minHeight: 50,
      transparent: true,
      skipTaskbar: true,
      focusable: true,
      enableLargerThanScreen: true,
      useContentSize: true,
      frame: false,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      x: primary.bounds.x + (isMac || isLinux ? (primary.workAreaSize.width - width) / 2 : primary.workAreaSize.width - width + 10),
      y: primary.bounds.y + (isMac || isLinux ? 60 : primary.workAreaSize.height - height + 30),
      webPreferences: {
        preload: path.join(__dirname, '../preload/clipboard.js'),
        webSecurity: false,
        nodeIntegration: true,
        contextIsolation: true,
      },
    })

    clipboardWindow.removeMenu()
    clipboardWindow.setAlwaysOnTop(true, 'screen-saver')
    windowLoad(clipboardWindow, 'clipboard')
    //clipboardWindow.webContents.openDevTools()

    return new Promise<void>((resolve) => {
      ipcMain.handleOnce('clipboard-ready', async (_event) => {
        resolve()
      })

      clipboardWindow!.on('closed', () => {
        clipboardWindow = undefined
      })

      clipboardWindow!.show()
    })
  }

  function createToolbarWindow() {
    if (toolbarWindow)
      return

    const width = 480
    const height = 50

    const primary = screen.getPrimaryDisplay()
    toolbarWindow = new BrowserWindow({
      width,
      height,
      minHeight: height,
      minimizable: false,
      maximizable: false,
      focusable: true,
      alwaysOnTop: true,
      transparent: true,
      skipTaskbar: true,
      show: false,
      frame: false,
      x: primary.bounds.x + (primary.workAreaSize.width - width) / 2,
      y: 0,
      webPreferences: {
        preload: path.join(__dirname, '../preload/toolbar.js'),
        additionalArguments: [import.meta.env.VITE_APP_URL],
        nodeIntegration: true,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
      },
    })

    toolbarWindow.setAlwaysOnTop(true, 'screen-saver')
    windowLoad(toolbarWindow, 'toolbar')
    toolbarWindow.show()
    //toolbarWindow.webContents.openDevTools()

    toolbarWindow.on('closed', () => {
      toolbarWindow = undefined
    })

    toolbarWindow.moveTop()
  }

  function getToolbarBounds() {
    if (!toolbarWindow)
      return undefined

    return {
      ...toolbarWindow.getBounds(),
      ...toolbarSize,
    }
  }

  function setToolbarSize(width: number, height: number) {
    toolbarSize = { width, height }
  }

  function resizeWindow(windowName: string, dimensions: ElectronWindowDimensions) {
    let window: BrowserWindow | undefined
    switch (windowName) {
      case 'clipboard':
        window = clipboardWindow
        break
      case 'toolbar':
        window = toolbarWindow
        break
      default:
        return
    }

    if (!window)
      return

    let size = window?.getMinimumSize()
    window?.setMinimumSize(dimensions.minimumSize?.width ?? size[0], dimensions.minimumSize?.height ?? size[1])

    size = window?.getSize()
    window?.setSize(dimensions.size.width ?? size[0], dimensions.size.height ?? size[1])
  }

  function hideOverlays() {
    if (overlayWindow) {
      overlayWindow.close()
      overlayWindow = undefined
    }
  }

  function hideRemoteControl() {
    hideOverlays()
    active = false
  }

  function updateUsers(newUsers: UserData[]) {
    users = newUsers
    overlayWindow?.webContents.send('on-update-overlay-data', { users: newUsers })
  }

  function mouseInteract(data: RemoteMouseData) {
    sourceManager.focus()
    const mousePos = sourceManager.convertDipPosition(screen.getCursorScreenPoint())
    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    return mousePos
  }

  function mousePosition(data: RemoteMouseData) {
    const scaleFactor = sourceManager.getScaleFactor()
    const x = Math.round((data.x + windowBorders.left) / scaleFactor)
    const y = Math.round((data.y + windowBorders.top) / scaleFactor)
    const point = new Point(x, y)
    if (isWin32)
      return screen.dipToScreenPoint(point)
    
    return point
  }

  function mouseMove(data: RemoteMouseData) {
    if (!data.userId)
      return
    
    if (mousePressed[data.userId])
      mouse.setPosition(mousePosition(data))
  }

  function mouseWheel(data: RemoteMouseData) {
    console.log(`scroll ${data.delta}`)
    keyboard.type(data.delta! < 0 ? Key.PageUp : Key.PageDown)
  }

  function mouseLeftClick(data: RemoteMouseData) {
    if (!data.userId)
      return

    mouseInteract(data)
    setTimeout(() => { console.log('leftClick'); mouse.leftClick(); mousePressed[data.userId] = false; }, 50)
  }

  function mouseDblClick(data: RemoteMouseData) {
    if (!data.userId)
      return

    const mousePos = mouseInteract(data)
    setTimeout(() => { console.log('dblclick1'); mouse.leftClick() }, 50)
    setTimeout(() => { console.log('dblclick2'); mouse.leftClick() }, 100)
    setTimeout(() => { mouse.setPosition(mousePos) }, 250)
  }

  function mouseClick(data: RemoteMouseData) {
    if (!data.userId)
      return

    const mousePos = mouseInteract(data)
    setTimeout(() => { console.log('rightClick'); mouse.rightClick() }, 50)
    setTimeout(() => { mouse.setPosition(mousePos) }, 200)
  }

  function mouseDown(data: RemoteMouseData) {
    if (!data.userId)
      return

    mouseInteract(data)

    if (!mousePressed[data.userId]) {
      mouse.setPosition(convertObjToAbsolutePosition(data))
      setTimeout(() => { console.log('mouseDown'); mouse.pressButton(Button.LEFT) }, 50)
    }
    mousePressed[data.userId] = true
  }

  function mouseUp(data: RemoteMouseData) {
    if (!data.userId)
      return

    if (mousePressed[data.userId]) {
      const mousePos = mouseInteract(data)
      setTimeout(() => { console.log('mouseUp'); mouse.releaseButton(Button.LEFT) }, 50)
      mousePressed[data.userId] = false

      setTimeout(() => { mouse.setPosition(mousePos) }, 200)
    }
  }

  async function copyToClipboard(data: any, cut: boolean) {
    localClipboardTime = Date.now()

    console.log(data)

    const tmpclipboard = await clipboard.getContent()
    await keyboard.pressKey(controlkey, Key.C)
    await keyboard.releaseKey(controlkey, Key.C)
    const remoteclipboard = await clipboard.getContent()

    if (!cut) {
      console.log(`copy to clipboad: ${remoteclipboard}`)
    }
    else {
      console.log(`cut to clipboad: ${remoteclipboard}`)
      keyboard.type(Key.Delete)
    }
    
    sendRemote('text', {
      text: remoteclipboard,
      time: Date.now()
    })

    // @ts-ignore: nut-js does not support clipboard.copy
    await clipboard.copy(tmpclipboard)
  }

  function toggleClipboard(toggle?: boolean) {
    if (toggle === undefined)
      toggle = !clipboardWindow

    if (!toggle)
      clipboardWindow?.close()
    else
      dataToClipboard(lastClipboardData)
  }

  function receiveFile(data: RemoteFileData) {
    fileChunkRegistry.register(data)
  }

  function receiveFileChunk(data: RemoteFileChunkData) {
    fileChunkRegistry.receiveChunk(data)
  }

  function textToClipboard(data: RemoteTextData) {
    if (!active || !remoteControlActive) {
      dataToClipboard({ content: `data:text/plain;base64,${btoa(data.text)}` })
    }
    else {
      console.log(`localclipboard: ${localClipboardTime}, remoteclipboard: ${data.time}`)
      if (data.time > localClipboardTime) {
        (async () => {
          const tmpclipboard = await clipboard.getContent()
          await clipboard.setContent(data.text)
          await keyboard.pressKey(controlkey, Key.V)
          await keyboard.releaseKey(controlkey, Key.V)
          await clipboard.setContent(tmpclipboard)
        })()
      }
    }
  }

  function typeKey(data: any) {
    if (!data.key)
      return

    console.log(data.key)
    const key = data.key
    const specialkeys = [
      // Original characters
      '@', ';', ':', '_', '°', '^', '!', '"', '§', '$', '%', '&', '/', '=', '?', '`', '´', 
      '{', '[', ']', '}', '\\', '\'', '*', '~', '<', '>', '|',
      'ß', 'ö', 'ä', 'ü', 'Ö', 'Ä', 'Ü',
      
      // Additional European characters
      // Scandinavian
      'å', 'Å', 'ø', 'Ø', 'æ', 'Æ',
      
      // French
      'é', 'è', 'ê', 'ë', 'É', 'È', 'Ê', 'Ë',
      'à', 'â', 'À', 'Â',
      'ù', 'û', 'Ù', 'Û',
      'ï', 'î', 'Ï', 'Î',
      'ç', 'Ç',
      'œ', 'Œ',
      
      // Spanish/Portuguese
      'ñ', 'Ñ',
      'á', 'Á',
      'í', 'Í',
      'ó', 'Ó',
      'ú', 'Ú',
      'ã', 'Ã',
      'õ', 'Õ',
      
      // Italian
      'ì', 'Ì',
      
      // Polish
      'ą', 'Ą',
      'ć', 'Ć',
      'ę', 'Ę',
      'ł', 'Ł',
      'ń', 'Ń',
      'ś', 'Ś',
      'ź', 'Ź',
      'ż', 'Ż',
      
      // Czech/Slovak
      'ě', 'Ě',
      'š', 'Š',
      'č', 'Č',
      'ř', 'Ř',
      'ž', 'Ž',
      'ý', 'Ý',
      'ť', 'Ť',
      'ď', 'Ď',
      'ň', 'Ň'
    ]

    if (key == 'Space') {
      if (lastKey == 'Dead') {
        keyboard.type('^')
      }
      else {
        keyboard.type(Key.Space)
      }
    }
    else if (key == 'Escape') {
      keyboard.type(Key.Escape)
    }
    else if (key == 'Tab') {
      keyboard.type(Key.Tab)
    }
    else if (key == 'Grave') {
      keyboard.type(Key.Grave)
    }
    else if (key == 'Minus') {
      keyboard.type(Key.Minus)
    }
    else if (key == 'Equal') {
      keyboard.type(Key.Equal)
    }
    else if (key == 'Backspace') {
      keyboard.type(Key.Backspace)
    }
    else if (key == 'LeftBracket') {
      keyboard.type(Key.LeftBracket)
    }
    else if (key == 'RightBracket') {
      keyboard.type(Key.RightBracket)
    }
    else if (specialkeys.includes(key)) {
      (async () => {
        const tmpclipboard = await clipboard.getContent()
        await clipboard.setContent(key)
        await keyboard.pressKey(controlkey, Key.V)
        await keyboard.releaseKey(controlkey, Key.V)
        await clipboard.setContent(tmpclipboard)
      })()
    }
    else if (key == 'Quote') {
      keyboard.type(Key.Quote)
    }
    else if (key == 'Return') {
      keyboard.type(Key.Return)
    }
    else if (key == 'Comma') {
      keyboard.type(Key.Comma)
    }
    else if (key == 'Period') {
      keyboard.type(Key.Period)
    }
    else if (key == 'Slash') {
      keyboard.type(Key.Slash)
    }
    else if (key == 'ArrowLeft') {
      keyboard.type(Key.Left)
    }
    else if (key == 'ArrowUp') {
      keyboard.type(Key.Up)
    }
    else if (key == 'ArrowRight') {
      keyboard.type(Key.Right)
    }
    else if (key == 'ArrowDown') {
      keyboard.type(Key.Down)
    }
    else if (key == 'Print') {
      keyboard.type(Key.Print)
    }
    else if (key == 'Pause') {
      keyboard.type(Key.Pause)
    }
    else if (key == 'Insert') {
      keyboard.type(Key.Insert)
    }
    else if (key == 'Delete') {
      keyboard.type(Key.Delete)
    }
    else if (key == 'Enter') {
      keyboard.type(Key.Enter)
    }
    else if (key == 'Shift') {
      keyboard.type(Key.LeftShift)
    }
    else if (key == 'Alt') {
      keyboard.type(Key.LeftAlt)
    }
    else if (key == 'Dead') {
      lastKey = 'Dead'
    }
    else if (key == 'AltGraph') {
      keyboard.type(Key.RightAlt)
    }
    else if (key == 'NumLock' || key == 'Dead') {
      // skip
    }
    else if (key.startsWith('_____strg+')) {
      console.log(key)
      console.log(key.replace('_____strg+', ''))

      // eslint-disable-next-line no-unexpected-multiline
      {(async () => {
        // alles markieren
        if (key.replace('_____strg+', '') == 'a') {
          keyboard
            .pressKey(controlkey, Key.A)
            .then(() => keyboard.releaseKey(controlkey, Key.A))
        }
        // safe
        if (key.replace('_____strg+', '') == 's') {
          await keyboard.pressKey(controlkey, Key.S)
          await keyboard.releaseKey(controlkey, Key.S)
        }
        // search
        if (key.replace('_____strg+', '') == 'f') {
          await keyboard.pressKey(controlkey, Key.F)
          await keyboard.releaseKey(controlkey, Key.F)
        }
        // Zeilenumbruch
        if (key.replace('_____strg+', '') == 'Enter') {
          await keyboard.pressKey(controlkey, Key.Enter)
          await keyboard.releaseKey(controlkey, Key.Enter)
        }
        // rückgängig
        if (key.replace('_____strg+', '') == 'y') {
          await keyboard.pressKey(controlkey, Key.Y)
          await keyboard.releaseKey(controlkey, Key.Y)
        }
        // wiederholen
        if (key.replace('_____strg+', '') == 'z') {
          await keyboard.pressKey(controlkey, Key.Z)
          await keyboard.releaseKey(controlkey, Key.Z)
        }
        // quit
        if (key.replace('_____strg+', '') == 'q') {
          await keyboard.pressKey(controlkey, Key.Q)
          await keyboard.releaseKey(controlkey, Key.Q)
        }
      })()}
    }
    else {
      keyboard.type(key)
    }
  }

  function convertObjToAbsolutePosition(data: RemoteMouseData) {
    const display = sourceManager.getCurrentScreen()

    console.log(display)
    console.log(display.bounds)

    const scalefactor = sourceManager.getScaleFactor()
    let posx = Math.round((data.x + windowBorders.left - display.bounds.x) * scalefactor + display.bounds.x)
    let posy = Math.round((data.y + windowBorders.top - display.bounds.y) * scalefactor + display.bounds.y)

    const primary = screen.getPrimaryDisplay()
    if (display.id == primary.id) {
      posx = posx * primary.scaleFactor
      posy = posy * primary.scaleFactor
    }

    console.log(`${posx}:${posy}`)

    return new Point(posx, posy)
  }

  function onRemote<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
    keyboard.config.autoDelayMs = 5
    let mouseData
    switch (event) {
      case 'copy':
        if (remoteControlActive)
          copyToClipboard(data, false)
        break
      case 'text':
        //if (remoteControlActive)
          textToClipboard(data as RemoteTextData)
        break
      case 'file':
        if (mouseEnabled)
          receiveFile(data as RemoteFileData)
        break
      case 'file-chunk':
        if (mouseEnabled)
          receiveFileChunk(data as RemoteFileChunkData)
        break
      case 'cut':
        if (remoteControlActive)
          copyToClipboard(data, true)
        break
      case 'mouse-move':
        if (mouseEnabled) {
          mouseMove(data as RemoteMouseData)
          sendToOverlayWindow('on-mouse-move', data as RemoteMouseData)
        }
        break
      case 'mouse-click':
        if (remoteControlActive)
          mouseClick(data as RemoteMouseData)
        break
      case 'mouse-dblclick':
        if (remoteControlActive)
          mouseDblClick(data as RemoteMouseData)
        break
      case 'mouse-leftclick':
        mouseData = data as RemoteMouseData
        if (remoteControlActive && !mouseData.draw) {
          if (!isMac)
            sendToOverlayWindow('on-mouse-click', mouseData)

          mouseLeftClick(mouseData)
        }
        else if (mouseEnabled) {
          sendToOverlayWindow('on-mouse-click', mouseData)
        }
        break
      case 'mouse-down':
        mouseData = data as RemoteMouseData
        if (remoteControlActive && !mouseData.draw)
          mouseDown(mouseData)
        else if (mouseEnabled)
          sendToOverlayWindow('on-mouse-down', mouseData)
        break;
      case 'mouse-wheel':
        if (remoteControlActive)
          mouseWheel(data as RemoteMouseData)
        break;
      case 'mouse-up':
        mouseData = data as RemoteMouseData
        if (remoteControlActive && !mouseData.draw)
          mouseUp(data as RemoteMouseData)
        else if (mouseEnabled)
          sendToOverlayWindow('on-mouse-up', mouseData)
        break;
      case 'type':
        if (remoteControlActive)
          typeKey(data)
        break;
    }
  }
  
  return {
    mouseEnabled,
    remoteControlActive,

    activate,
    deactivate,
    createOverlayWindow,
    hideOverlayWindow,
    toggleClipboard,
    toggleRemoteControl,
    toggleMouse,
    getToolbarBounds,
    hideRemoteControl,
    updateUsers,
    updateWindowBorders,
    onRemote,
    resizeWindow,
    setToolbarSize,
  }
}