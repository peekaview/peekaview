import {
  mouse,
  Point,
  clipboard,
  keyboard,
  Key,
  Button,
} from '@nut-tree-fork/nut-js'
import path from 'path'
import { ipcMain, dialog, BrowserWindow, screen } from 'electron'
// import { fileTypeFromBlob } from 'file-type';

import { SourceManager } from '../sources/SourceManager.js'
import { createSourceManager } from '../sources/createSourceManager.js'
import { windowLoad } from '../util.js'
import { Dimensions, ElectronWindowDimensions, File, RemoteData, RemoteEvent, RemoteTextData, RemoteFileData, RemoteMouseData, RemoteFileChunkData, UserData, RemoteKeyData, RemoteCopyData, RemotePasteData } from '../../interface.d'
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

const KeyMap: Record<string, Key> = {
  'Escape': Key.Escape,
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

export type RemotePresenter = ReturnType<typeof useRemotePresenter>

export function useRemotePresenter(sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void, newUsers: UserData[] = [], onHidden: (hidden: boolean) => void) {
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
  let toggles = {
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
  let streamingState: 'hidden' | 'paused' | 'active' | 'stopped' = 'stopped'
  
  // Intervals
  let checkWindowInterval: NodeJS.Timeout | undefined
  let resetInterval: NodeJS.Timeout | undefined
  
  // Last state for pause/resume
  let pausedToggleState: {
    pointer: boolean;
    remoteControl: boolean;
  } | undefined

  let hwnd: string | undefined

  async function startSharing(sourceId: string) {
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

    if (!sourceManager.isVisible() && streamingState !== 'hidden') {
      console.log('window is not visible')
      //stopSharing()
      pauseStreaming(true)
    }
  }

  function stopSharing() {
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

    streamingState = 'stopped'
  }

  function pauseStreaming(fromHidden = false) {
    if (streamingState === 'paused' || (streamingState === 'hidden' && fromHidden))
      return

    console.log('pauseStreaming', streamingState, fromHidden, streamingState === 'hidden' && !fromHidden)
    if (fromHidden)
      onHidden(true)

    streamingState = fromHidden ? 'hidden' : 'paused'

    if (pausedToggleState === undefined) {
      pausedToggleState = { ...toggles }
      toggles.pointer = false
      toggles.remoteControl = false
      sendReset()
    }

    console.log('pause')
    hideOverlayWindow()
    hideRemoteControl()
  }

  async function resumeStreamingIfPaused(fromHidden = false) {
    if (streamingState !== 'hidden' && (streamingState !== 'paused' || fromHidden))
      return

    if (fromHidden)
      onHidden(false)

    if (pausedToggleState !== undefined) {
      toggles = { ...pausedToggleState }
      pausedToggleState = undefined
    }
    
    streamingState = 'stopped'
    console.log('resume')
    await startStreaming()
  }

  async function startStreaming() {
    if (hwnd !== undefined && streamingState === 'stopped') {
      console.log("startStreaming")

      streamingState = 'active'

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
      dimensions: sourceManager.getOuterDimensions(),
      coverBounds: toolbarBounds ? [toolbarBounds] : [],
      pointerEnabled: toggles.pointer,
      remoteControlEnabled: toggles.remoteControl,
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
    if (toggles.remoteControl === toggle)
      return

    if (toggle === undefined)
      toggle = !toggles.remoteControl

    toggles.remoteControl = toggle

    overlayWindow?.webContents.send('on-update-overlay-data', { remoteControlEnabled: toggles.remoteControl })
  }

  function togglePointer(toggle?: boolean) {
    if (toggles.pointer === toggle)
      return

    if (toggle === undefined)
      toggle = !toggles.pointer

    toggles.pointer = toggle

    overlayWindow?.webContents.send('on-update-overlay-data', { pointerEnabled: toggles.pointer })
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
        webSecurity: false,
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
        webSecurity: false,
        nodeIntegration: true,
        contextIsolation: true,
      },
    })

    clipboardWindow.removeMenu()
    clipboardWindow.webContents.openDevTools()

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

    const width = 500
    const height = 50

    const display = sourceManager.getCurrentScreen()
    const x = Math.round(display.bounds.x + (display.workAreaSize.width - width) / 2)
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
        additionalArguments: [import.meta.env.VITE_APP_URL],
        nodeIntegration: true,
        contextIsolation: true,
        webSecurity: false,
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

    size = window?.getSize()
    window?.setSize(dimensions.size.width ?? size[0], dimensions.size.height ?? size[1])
  }

  function hideRemoteControl() {
    hideOverlays()
    active = false
  }

  function updateUsers(newUsers: UserData[]) {
    users = newUsers
    overlayWindow?.webContents.send('on-update-overlay-data', { users: newUsers })
    sendReset()
    setTimeout(() => sendReset(), 2000) // for synchronization, TODO: find better solution
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

    const tmp = await clipboard.getContent()
    await keyboard.pressKey(controlkey, Key.C)
    await keyboard.releaseKey(controlkey, Key.C)
    const content = await clipboard.getContent()

    if (data.cut)
      keyboard.type(Key.Delete)
    
    sendRemote('text', {
      text: content,
      time: Date.now()
    })

    // @ts-ignore: nut-js does not support clipboard.copy
    await clipboard.copy(tmp)
  }

  async function pasteFromClipboard(data: RemotePasteData) {
    const tmp = await clipboard.getContent()
    await clipboard.setContent(data.text)
    await keyboard.pressKey(controlkey, Key.V)
    await keyboard.releaseKey(controlkey, Key.V)
    await clipboard.setContent(tmp)
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
    if (!active || !toggles.remoteControl) {
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

    console.log(data.key)
    const key = data.key

    if (KeyMap[key]) {
      keyboard.type(KeyMap[key])
    } else if (key == 'Space') {
      if (lastKey == 'Dead') {
        keyboard.type('^')
      }
      else {
        keyboard.type(Key.Space)
      }
    } else if (SpecialKeys.includes(key)) {
      (async () => {
        const tmpclipboard = await clipboard.getContent()
        await clipboard.setContent(key)
        await keyboard.pressKey(controlkey, Key.V)
        await keyboard.releaseKey(controlkey, Key.V)
        await clipboard.setContent(tmpclipboard)
      })()
    } else if (key == 'Dead') {
      lastKey = 'Dead'
    } else if (key == 'NumLock') {
      // skip
    } else if (key.startsWith('_____strg+')) {
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
        if (toggles.remoteControl && copyData.tool == 'remoteControl')
          copyToClipboard(copyData)
        break
      case 'paste':
        const pasteData = data as RemotePasteData
        if (toggles.remoteControl && pasteData.tool == 'remoteControl')
          pasteFromClipboard(pasteData)
        break
      case 'mouse-move':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseMove(mouseData)
        
        sendToOverlayWindow('on-mouse-move', mouseData)
        break
      case 'mouse-click':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseClick(mouseData)
        break
      case 'mouse-dblclick':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseDblClick(mouseData)
        break
      case 'mouse-leftclick':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseLeftClick(mouseData)
        
        sendToOverlayWindow('on-mouse-click', mouseData)
        break
      case 'mouse-down':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseDown(mouseData)
        
        sendToOverlayWindow('on-mouse-down', mouseData)
        break;
      case 'mouse-wheel':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseWheel(mouseData)
        break;
      case 'mouse-up':
        mouseData = data as RemoteMouseData
        if (toggles.remoteControl && mouseData.tool == 'remoteControl')
          mouseUp(mouseData)
        
        sendToOverlayWindow('on-mouse-up', mouseData)
        break;
      case 'key-down':
        const keyData = data as RemoteKeyData
        if (toggles.remoteControl && keyData.tool == 'remoteControl')
          keyDown(keyData)
        break;
    }
  }
  
  return {
    toggles,

    startSharing,
    stopSharing,
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