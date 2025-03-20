import {
  mouse,
  Point,
  keyboard,
  Key,
  Button,
} from '@nut-tree-fork/nut-js'
import path from 'path'
import { ipcMain, app, dialog, BrowserWindow, screen, clipboard as electronClipboard } from 'electron'
// import { fileTypeFromBlob } from 'file-type';

import { SourceManager } from '../sources/SourceManager.js'
import { createSourceManager } from '../sources/createSourceManager.js'
import { windowLoad } from '../util.js'
import { Dimensions, ElectronWindowDimensions, File, RemoteData, RemoteEvent, RemoteTextData, RemoteFileData, RemoteMouseData, RemoteFileChunkData, UserData, RemoteKeyData, RemoteCopyData, RemotePasteData, Size, StreamState, SendRemote } from '../../interface.d'
import { useFileChunkRegistry } from '../../composables/useFileChunking.js'

import { i18n } from '../i18n'

import { getWindowList } from '../util.js'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// Intervals
const checkWindowIntervalTime = (isMac || isLinux) ? 1000 : 1000

const controlkey = isMac ? Key.LeftSuper : Key.LeftControl
const SpecialKeys = [
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

const KeyTypeMap: Record<string, Key> = {
  'Tab': Key.Tab,
  'Grave': Key.Grave,
  'Minus': Key.Minus,
  'Equal': Key.Equal,
  'Backspace': Key.Backspace,
  'LeftBracket': Key.LeftBracket,
  'RightBracket': Key.RightBracket,
  'Quote': Key.Quote,
  'Return': Key.Return,
  'Comma': Key.Comma,
  'Period': Key.Period,
  'Slash': Key.Slash,
  'ArrowLeft': Key.Left,
  'ArrowUp': Key.Up,
  'ArrowRight': Key.Right,
  'ArrowDown': Key.Down,
  'Print': Key.Print,
  'Pause': Key.Pause,
  'Insert': Key.Insert,
  'Delete': Key.Delete,
  'Enter': Key.Enter,
  'Shift': Key.LeftShift,
  'Alt': Key.LeftAlt,
  'AltGraph': Key.RightAlt,
  'NumLock': Key.NumLock,
}

const KeyPressMap: Record<string, Key> = {
  'Escape': Key.Escape,
  'F1': Key.F1,
  'F2': Key.F2,
  'F3': Key.F3,
  'F4': Key.F4,
  'F5': Key.F5,
  'F6': Key.F6,
  'F7': Key.F7,
  'F8': Key.F8,
  'F9': Key.F9,
  'F10': Key.F10,
  'F11': Key.F11,
  'F12': Key.F12,
  'Home': Key.Home,
  'End': Key.End,
  'PageUp': Key.PageUp,
  'PageDown': Key.PageDown,
  'Insert': Key.Insert,
  'Delete': Key.Delete,
  'Backspace': Key.Backspace,
  'Enter': Key.Enter,
}

export type RemotePresenter = ReturnType<typeof useRemotePresenter>

export function useRemotePresenter(sendRemote: SendRemote, newUsers: UserData[] = [], onHidden: (hidden: boolean) => void) {
  const mousePressed: Record<string, boolean> = {}

  let overlayWindow: BrowserWindow | undefined
  let clipboardWindow: BrowserWindow | undefined
  let toolbarWindow: BrowserWindow | undefined
  let toolbarSize: Size | {} = {}
  let localClipboardTime = 0
  let lastClipboardData: File = {
    content: 'data:text/plain;base64,'
  }
  let lastKey: string
  let active = false
  let toolsEnabled = {
    pointer: true,
    remoteControl: false,
  }
  let windowBorders: Dimensions = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  }
  let users: UserData[] = newUsers
  const fileChunkRegistry = useFileChunkRegistry(dataToClipboard)

  // Dependencies
  let sourceManager: SourceManager
  
  // Streaming control flags
  let streamState: StreamState = 'stopped'
  
  // Intervals
  let checkWindowInterval: NodeJS.Timeout | undefined
  let resetInterval: NodeJS.Timeout | undefined

  let hwnd: string | undefined

  async function start(sourceId: string) {
    if (sourceId.includes(':'))
      hwnd = sourceId.split(':')[1]

    console.log(`hwndstreamer:${hwnd}`)

    const windowList = await getWindowList()
    if (!hwnd || (!windowList.includes(hwnd) && hwnd != '0')) {
      dialog.showErrorBox(i18n.t('windowNotFound.title'), i18n.t('windowNotFound.content', { hwnd }))
      return
    }
    
    console.log(`${hwnd} in windowList`)

    await startStreaming()

    sourceManager.checkIfRectangleUpdated()
    checkWindow()
    if (!checkWindowInterval)
      checkWindowInterval = setInterval(() => checkWindow(), checkWindowIntervalTime)
  }

  function checkWindow() {
    // pause streaming, if window is minimized
    updateWindowBorders(sourceManager.getOuterDimensions())
    if (sourceManager.isMinimized()) {
      console.log('window is minimized')
      pauseStreaming(true)
    }
    else if (sourceManager.checkIfRectangleUpdated()) {
      console.log('window was resized')
      pauseStreaming(true)
      // resume streaming, if window is back to normal state
    }
    else if (sourceManager.isVisible()) {
      resumeStreamingIfPaused(true)
    }

    if (!sourceManager.isVisible() && streamState !== 'hidden') {
      console.log('window is not visible')
      //stop()
      pauseStreaming(true)
    }
  }

  function stop() {
    if (resetInterval != undefined) {
      clearInterval(resetInterval)
      resetInterval = undefined
    }

    if (checkWindowInterval != undefined) {
      clearInterval(checkWindowInterval)
      checkWindowInterval = undefined
    }

    hideOverlayWindow()
    hideRemoteControl()
    deactivate()

    streamState = 'stopped'
  }

  function pauseStreaming(fromHidden = false) {
    if (streamState === 'paused' || (streamState === 'hidden' && fromHidden))
      return

    console.log('pauseStreaming', streamState, fromHidden, streamState === 'hidden' && !fromHidden)
    if (fromHidden)
      onHidden(true)

    streamState = fromHidden ? 'hidden' : 'paused'

    console.log('pause')
    hideOverlayWindow()
    hideRemoteControl()
    sendReset()
  }

  async function resumeStreamingIfPaused(fromHidden = false) {
    if (streamState !== 'hidden' && (streamState !== 'paused' || fromHidden))
      return

    if (fromHidden)
      onHidden(false)
    
    streamState = 'stopped'
    console.log('resume')
    await startStreaming()
  }

  async function startStreaming() {
    if (hwnd !== undefined && streamState === 'stopped') {
      console.log("startStreaming")

      streamState = 'active'

      sourceManager = createSourceManager(hwnd)
      await sourceManager.onInit()
      sourceManager.bringToFront()
      await activate(sourceManager)

      sendReset()
    }
  }

  let resetTimeout: NodeJS.Timeout | undefined
  let resetJson: string
  function sendReset(interval = false) {
    clearTimeout(resetTimeout)
    
    const toolbarBounds = getToolbarBounds()
    const data = {
      isScreen: sourceManager.isScreen(),
      inBrowser: false,
      dimensions: sourceManager.getOuterDimensions(),
      coverBounds: toolbarBounds ? [toolbarBounds] : [],
      toolsEnabled,
      streamState,
    }
    
    const json = JSON.stringify(data)
    if (!interval || resetJson !== json) {
      resetJson = json
      console.log('sendReset', data)
      sendRemote('reset', data)
    }

    resetTimeout = setTimeout(() => sendReset(true), 2000)
  }

  function deactivate() {
    active = false

    overlayWindow?.close()
    toolbarWindow?.close()
    clipboardWindow?.close()
  }

  async function activate(manager: SourceManager) {
    sourceManager = manager
    active = true
    await createOverlayWindow()
    await createToolbarWindow()
  }

  function updateWindowBorders(newBorders: Dimensions) {
    windowBorders = newBorders
  }

  function toggleRemoteControl(toggle?: boolean) {
    if (toolsEnabled.remoteControl === toggle)
      return

    if (toggle === undefined)
      toggle = !toolsEnabled.remoteControl

    toolsEnabled.remoteControl = toggle

    overlayWindow?.webContents.send('on-update-overlay-data', { toolsEnabled })
  }

  function togglePointer(toggle?: boolean) {
    if (toolsEnabled.pointer === toggle)
      return

    if (toggle === undefined)
      toggle = !toolsEnabled.pointer

    toolsEnabled.pointer = toggle

    overlayWindow?.webContents.send('on-update-overlay-data', { toolsEnabled })
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
      focusable: false,
      alwaysOnTop: true,
      roundedCorners: false,
      enableLargerThanScreen: true,
      transparent: true,
      skipTaskbar: true,
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/overlay.js'),
        nodeIntegration: true,
        contextIsolation: true,
        webSecurity: app.isPackaged,
      },
    })

    overlayWindow.removeMenu()
    overlayWindow.setIgnoreMouseEvents(true)
    //overlayWindow.webContents.openDevTools()
    
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlayWindow.setAlwaysOnTop(true)
    windowLoad(overlayWindow, 'overlay')

    /*if (sourceManager.fixOverlayBoundsAfterCreation) {
      overlayWindow.setBounds({ x, y, width, height }, false) // false means don't animate the change
    }*/

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

  function hideOverlays() {
    if (overlayWindow) {
      overlayWindow.close()
      overlayWindow = undefined
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

    toolbarWindow!.webContents.send('on-clipboard-enabled')
    clipboardWindow!.webContents.send('data-to-clipboard', JSON.stringify(data))
  }

  function createClipboardWindow() {
    if (clipboardWindow)
      return

    const width = 240
    const height = 320

    const primary = screen.getPrimaryDisplay()
    clipboardWindow = new BrowserWindow({
      x: primary.bounds.x + (isMac || isLinux ? (primary.workAreaSize.width - width) / 2 : primary.workAreaSize.width - width + 10),
      y: primary.bounds.y + (isMac || isLinux ? 60 : primary.workAreaSize.height - height),
      width,
      height,
      minWidth: width,
      minHeight: 50,
      minimizable: false,
      maximizable: false,
      focusable: true,
      transparent: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/clipboard.js'),
        webSecurity: app.isPackaged,
        nodeIntegration: true,
        contextIsolation: true,
      },
    })

    clipboardWindow.removeMenu()
    //clipboardWindow.webContents.openDevTools()

    clipboardWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    clipboardWindow.setAlwaysOnTop(true)
    windowLoad(clipboardWindow, 'clipboard')

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

    const width = 600
    const height = 60

    const display = sourceManager.getCurrentScreen()
    const x = Math.round(display.bounds.x + (display.workAreaSize.width - width))
    const y = display.bounds.y
    toolbarWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      minHeight: height,
      minimizable: false,
      maximizable: false,
      focusable: true,
      alwaysOnTop: true,
      transparent: true,
      skipTaskbar: true,
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/toolbar.js'),
        nodeIntegration: true,
        contextIsolation: true,
        webSecurity: app.isPackaged,
      },
    })

    //toolbarWindow.webContents.openDevTools()

    toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    toolbarWindow.setAlwaysOnTop(true)
    windowLoad(toolbarWindow, 'toolbar')

    toolbarWindow.on('closed', () => {
      toolbarWindow = undefined
    })

    return new Promise<void>((resolve) => {
      toolbarWindow!.on('ready-to-show', () => {
        toolbarWindow!.moveTop()
        toolbarWindow!.webContents.send('on-update-overlay-data', { users, toolsEnabled })
        resolve()
      })
    })
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

    // For toolbar window, keep the right border in the same place
    if (windowName === 'toolbar' && dimensions.size.width) {
      window?.setMinimumSize(160, 60)

      // on the window needs to be 20px wider to avoid cutting off the borders or shadows
      // on mac the window needs to be at least 160px wide
      const currentBounds = window.getBounds()
      let newWidth = dimensions.size.width + 20
      if (newWidth < 160) {
        newWidth = 160
      }
      let newHeight = dimensions.size.height ?? currentBounds.height
      if (newHeight < 60) {
        newHeight = 60
      }
      const newX = currentBounds.x + currentBounds.width - newWidth
      
      window.setPosition(newX, currentBounds.y)
      
      window.setSize(newWidth, newHeight)
    } else {
      size = window?.getSize()
      window?.setSize(dimensions.size.width ?? size[0], dimensions.size.height ?? size[1])
    }
  }

  function hideRemoteControl() {
    hideOverlays()
    active = false
  }

  function updateUsers(newUsers: UserData[]) {
    users = newUsers
    overlayWindow?.webContents.send('on-update-overlay-data', { users: newUsers })
    toolbarWindow?.webContents.send('on-update-overlay-data', { users: newUsers })
    sendReset()
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

  async function copyToClipboard(data: RemoteCopyData) {
    localClipboardTime = Date.now()

    const tmp = await electronClipboard.readText()
    await keyboard.pressKey(controlkey, Key.C)
    await keyboard.releaseKey(controlkey, Key.C)
    const content = await electronClipboard.readText()

    if (data.cut)
      keyboard.type(Key.Delete)
    
    sendRemote('text', {
      text: content,
      time: Date.now()
    })

    await electronClipboard.writeText(tmp)
  }

  async function pasteFromClipboard(data: RemotePasteData) {
    const tmp = await electronClipboard.readText()
    await electronClipboard.writeText(data.text)
    await keyboard.pressKey(controlkey, Key.V)
    await keyboard.releaseKey(controlkey, Key.V)
    await electronClipboard.writeText(tmp)
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
    if (!active || !toolsEnabled.remoteControl) {
      dataToClipboard({ content: `data:text/plain;base64,${btoa(data.text)}` })
    }
    else {
      console.log(`localclipboard: ${localClipboardTime}, remoteclipboard: ${data.time}`)
      if (data.time > localClipboardTime) {
        pasteFromClipboard(data)
      }
    }
  }

  function keyDown(data: RemoteKeyData) {
    if (!data.key)
      return

    const key = data.key
    console.log('key', key)

    if (KeyTypeMap.hasOwnProperty(key)) {
      console.log('type map', KeyTypeMap[key])
      keyboard.type(KeyTypeMap[key])
    } else if (KeyPressMap.hasOwnProperty(key)) {
      (async () => {
        console.log('press map', KeyPressMap[key])
        await keyboard.pressKey(KeyPressMap[key])
        await keyboard.releaseKey(KeyPressMap[key])
      })()
    } else if (key == 'Space') {
      if (lastKey == 'Dead')
        keyboard.type('^')
      else
        keyboard.type(Key.Space)
    } else if (SpecialKeys.includes(key)) {
      (async () => {
        console.log('special', key)
        const tmpclipboard = await electronClipboard.readText()
        await electronClipboard.writeText(key)
        await keyboard.pressKey(controlkey, Key.V)
        await keyboard.releaseKey(controlkey, Key.V)
        await electronClipboard.writeText(tmpclipboard)
      })()
    } else if (key == 'Dead') {
      lastKey = 'Dead'
    } else if (key == 'NumLock') {
      // skip
    } else if (key.startsWith('_____strg+')) {
      const strgKey = key.replace('_____strg+', '')
      console.log(strgKey)

      // eslint-disable-next-line no-unexpected-multiline
      {(async () => {
        // alles markieren
        if (strgKey == 'a') {
          keyboard
            .pressKey(controlkey, Key.A)
            .then(() => keyboard.releaseKey(controlkey, Key.A))
        }
        // safe
        if (strgKey == 's') {
          await keyboard.pressKey(controlkey, Key.S)
          await keyboard.releaseKey(controlkey, Key.S)
        }
        // search
        if (strgKey == 'f') {
          await keyboard.pressKey(controlkey, Key.F)
          await keyboard.releaseKey(controlkey, Key.F)
        }
        // Zeilenumbruch
        if (strgKey == 'Enter') {
          await keyboard.pressKey(controlkey, Key.Enter)
          await keyboard.releaseKey(controlkey, Key.Enter)
        }
        // rückgängig
        if (strgKey == 'y') {
          await keyboard.pressKey(controlkey, Key.Y)
          await keyboard.releaseKey(controlkey, Key.Y)
        }
        // wiederholen
        if (strgKey == 'z') {
          await keyboard.pressKey(controlkey, Key.Z)
          await keyboard.releaseKey(controlkey, Key.Z)
        }
        // quit
        if (strgKey == 'q') {
          await keyboard.pressKey(controlkey, Key.Q)
          await keyboard.releaseKey(controlkey, Key.Q)
        }
      })()}
    }
    else {
      console.log('type', key)
      keyboard.type(key)
    }
  }

  function convertObjToAbsolutePosition(data: RemoteMouseData) {
    const display = sourceManager.getCurrentScreen()

    const scalefactor = sourceManager.getScaleFactor()
    let x = Math.round((data.x + windowBorders.left - display.bounds.x) * scalefactor + display.bounds.x)
    let y = Math.round((data.y + windowBorders.top - display.bounds.y) * scalefactor + display.bounds.y)

    const primary = screen.getPrimaryDisplay()
    if (display.id == primary.id) {
      x *= primary.scaleFactor
      y *= primary.scaleFactor
    }

    console.log(`${x}:${y}`)

    return new Point(x, y)
  }

  function onRemote<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
    keyboard.config.autoDelayMs = 5
    let mouseData: RemoteMouseData
    switch (event) {
      case 'text':
        textToClipboard(data as RemoteTextData)
        break
      case 'file':
        receiveFile(data as RemoteFileData)
        break
      case 'file-chunk':
        receiveFileChunk(data as RemoteFileChunkData)
        break
      case 'copy':
        const copyData = data as RemoteCopyData
        if (toolsEnabled.remoteControl && copyData.tool == 'remoteControl')
          copyToClipboard(copyData)
        break
      case 'paste':
        const pasteData = data as RemotePasteData
        if (toolsEnabled.remoteControl && pasteData.tool == 'remoteControl')
          pasteFromClipboard(pasteData)
        break
      case 'mouse-move':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseMove(mouseData)
        
        sendToOverlayWindow('on-mouse-move', mouseData)
        break
      case 'mouse-click':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseClick(mouseData)
        break
      case 'mouse-dblclick':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseDblClick(mouseData)
        break
      case 'mouse-leftclick':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseLeftClick(mouseData)
        
        sendToOverlayWindow('on-mouse-click', mouseData)
        break
      case 'mouse-down':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseDown(mouseData)
        
        sendToOverlayWindow('on-mouse-down', mouseData)
        break;
      case 'mouse-wheel':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseWheel(mouseData)
        break;
      case 'mouse-up':
        mouseData = data as RemoteMouseData
        if (toolsEnabled.remoteControl && mouseData.tool == 'remoteControl')
          mouseUp(mouseData)
        
        sendToOverlayWindow('on-mouse-up', mouseData)
        break;
      case 'key-down':
        const keyData = data as RemoteKeyData
        if (toolsEnabled.remoteControl && keyData.tool == 'remoteControl')
          keyDown(keyData)
        break;
    }
  }
  
  return {
    start,
    stop,
    pauseStreaming,
    resumeStreamingIfPaused,
    sendReset,

    activate,
    deactivate,
    createOverlayWindow,
    hideOverlayWindow,
    toggleClipboard,
    toggleRemoteControl,
    togglePointer,
    getToolbarBounds,
    hideRemoteControl,
    updateUsers,
    updateWindowBorders,
    onRemote,
    resizeWindow,
    setToolbarSize,
  }
}