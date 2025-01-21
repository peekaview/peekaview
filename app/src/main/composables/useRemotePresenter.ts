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

import { WindowManager } from '../modules/WindowManager.js'
import { resolvePath, windowLoad } from '../util.js'
import { ElectronWindowDimensions, File, RemoteData, RemoteEvent, RemotePasteData, RemoteFileData, RemoteMouseData, RemoteFileChunkData, UserData } from '../../interface.d'
import { useFileChunkRegistry } from '../../composables/useFileChunking.js'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

const controlkey = isMac ? Key.LeftSuper : Key.LeftControl

export function useRemotePresenter(sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void) {
  const overlayCursor: Record<string, BrowserWindow> = {}
  const overlayCursorLastAction: Record<string, number> = {}
  const overlayCursorSignal: Record<string, BrowserWindow> = {}
  const lastTargetPoints: Record<string, Point> = {}
  const mousePressed: Record<string, boolean> = {}

  let drawOverlayWindow: BrowserWindow | undefined
  let clipboardWindow: BrowserWindow | undefined
  let toolbarWindow: BrowserWindow | undefined
  let toolbarSize: { width: number, height: number } | {} = {}
  let localClipboardTime = 0
  let lastClipboardData: File | undefined
  let lastKey: string
  let remoteControlActive = false
  let remoteControlInputEnabled = false
  let mouseEnabled = true
  let lastMouseEnabled: boolean | undefined = undefined
  let windowBorders = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  }
  let windowManager
  let lastMousePos = new Point(0, 0)
  let cursorCheckInterval: NodeJS.Timeout | undefined
  let cursorcheckinterval: NodeJS.Timeout | undefined
  let users: UserData[] = []
  const fileChunkRegistry = useFileChunkRegistry(dataToClipboard)

  ipcMain.handle('on-remote', async <T extends RemoteEvent>(_event, event: T, data: RemoteData<T>) => {
    onRemote(event, data)
  })

  ipcMain.handle('set-toolbar-size', async (_event, width: number, height: number) => {
    toolbarSize = { width, height }
  })

  ipcMain.handle('toggle-clipboard', async (_event, toggle?: boolean) => {
    toggleClipboardWindow(toggle)
  })

  ipcMain.handle('toggle-mouse', async (_event, toggle?: boolean) => {
    toggleMouse(toggle)
  })
  
  ipcMain.handle('toggle-remote-control', async (_event, toggle?: boolean) => {
    toggleRemoteControl(toggle)
  })

  ipcMain.handle('resize-window', async (_event, windowName: string, dimensions: ElectronWindowDimensions) => {
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
  })

  ipcMain.handle('close-clipboard', async (_event) => {
    clipboardWindow?.close()
  })

  function deactivate() {
    if (cursorCheckInterval) {
      clearInterval(cursorCheckInterval)
      cursorCheckInterval = undefined
    }
    remoteControlActive = false

    toolbarWindow?.close()
    clipboardWindow?.close()
  }

  function activate(hwnd: string) {
    windowManager = new WindowManager()
    windowManager.selectWindow(hwnd)

    if (cursorCheckInterval) {
      clearInterval(cursorCheckInterval)
      cursorCheckInterval = undefined
    }
    cursorCheckInterval = setInterval(() => {
      windowBorders = windowManager.getWindowOuterDimensions()
    }, 1000)

    remoteControlActive = true
    createToolbarWindow()
  }

  function toggleRemoteControl(toggle?: boolean) {
    if (remoteControlInputEnabled === toggle)
      return

    if (toggle === undefined)
      toggle = !remoteControlInputEnabled

    console.log('Toggling remote control', toggle)
    remoteControlInputEnabled = toggle
    if (toggle) {
      const enabled = mouseEnabled
      toggleMouse(true)
      lastMouseEnabled = enabled
    }
    else if (lastMouseEnabled !== undefined)
      toggleMouse(lastMouseEnabled)

    sendRemote('remote-control', { enabled: remoteControlInputEnabled })
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

    sendRemote('mouse-control', { enabled: mouseEnabled })
  }

  function showOverlayCursorSignal(id: string) {
    if (!lastTargetPoints[id])
      return

    const cpoint = lastTargetPoints[id]
    const user = users.find(user => user.id === id)
    const additionalArguments = user ? [id, user.name, user.color] : [id]
    overlayCursorSignal[id] = new BrowserWindow({
      width: 480,
      height: 320,
      x: cpoint.x - 330,
      y: cpoint.y - 170,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      enableLargerThanScreen: true,
      useContentSize: true,
      frame: false,
      alwaysOnTop: true,
      // titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: true,
        preload: resolvePath('static/js/cursoroverlaysignal.js'),
        additionalArguments,
      },
    })

    overlayCursorSignal[id].removeMenu()
    overlayCursorSignal[id].setIgnoreMouseEvents(true)
    // overlayCursorSignal[id].setAlwaysOnTop(true, 'screen-saver');
    overlayCursorSignal[id].loadFile(resolvePath('static/cursoroverlaysignal.html'))
    console.log(`show signal${cpoint}`)

    setTimeout(() => {
      try {
        if (overlayCursorSignal[id]) {
          overlayCursorSignal[id].close()
          delete overlayCursorSignal[id]
        }
      }
      catch (e) {}
    }, 1000)
  }

  async function createDrawOverlayWindow() {
    if (drawOverlayWindow)
      return

    const activeWindowDimensions = windowManager.getWindowOuterDimensions()
    drawOverlayWindow = new BrowserWindow({
      x: activeWindowDimensions.left,
      y: activeWindowDimensions.top,
      width: activeWindowDimensions.right - activeWindowDimensions.left,
      height: activeWindowDimensions.bottom - activeWindowDimensions.top,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      enableLargerThanScreen: true,
      // useContentSize: true,
      frame: false,
      alwaysOnTop: true,
      // titleBarStyle: 'hidden',
      webPreferences: {
        preload: path.join(__dirname, '../preload/drawOverlay.js'),
        webSecurity: false,
        nodeIntegration: true,
        contextIsolation: true,
      },
    })

    //drawOverlayWindow.webContents.openDevTools()
    drawOverlayWindow.removeMenu()
    drawOverlayWindow.setIgnoreMouseEvents(true)
    
    drawOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    drawOverlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    windowLoad(drawOverlayWindow, 'drawOverlay')

    return new Promise<void>((resolve) => {
      drawOverlayWindow!.on('ready-to-show', () => {
        drawOverlayWindow!.webContents.send('on-update-users', users)
        resolve()
      })
    })
  }

  async function showDrawOverlayWindow(action: string, data: RemoteMouseData) {
    if (!drawOverlayWindow)
      await createDrawOverlayWindow()

    if (!data.userId || !remoteControlActive)
      return
  
    drawOverlayWindow!.webContents.send(action, data)
  }

  function showOverlayCursorWindow(id: string) {
    if (overlayCursor[id])
      return

    const activeWindowDimensions = windowManager.getWindowOuterDimensions()
    windowBorders.left = activeWindowDimensions.left
    windowBorders.top = activeWindowDimensions.top

    if (!overlayCursor[id]) {
      const user = users.find(user => user.id === id)
      const additionalArguments = user ? [id, user.name, user.color] : [id]
      console.log(additionalArguments, user, users)

      overlayCursor[id] = new BrowserWindow({
        width: 400,
        height: 80,
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        enableLargerThanScreen: true,
        useContentSize: true,
        frame: false,
        alwaysOnTop: true,
        // titleBarStyle: 'hidden',
        webPreferences: {
          nodeIntegration: true,
          preload: resolvePath('static/js/cursoroverlay.js'),
          additionalArguments,
        },
      })

      overlayCursor[id].removeMenu()
      overlayCursor[id].setAlwaysOnTop(true, 'screen-saver')
      overlayCursor[id].loadFile(resolvePath('static/cursoroverlay.html'))
      overlayCursor[id].setIgnoreMouseEvents(true)

      if (!cursorcheckinterval) {
        cursorcheckinterval = setInterval(() => {
          for (const id in overlayCursor) {
            if (
              overlayCursorLastAction[id]
              && overlayCursorLastAction[id] < Date.now() - 10000
            ) {
              if (overlayCursor[id]) {
                console.log(`remove cursor ${id}`)
                overlayCursor[id].close()
                delete overlayCursor[id]
              }
            }
          }
        }, 1000)
      }
    }

    if (!lastTargetPoints[id])
      lastTargetPoints[id] = new Point(0, 0)

    mousePressed[id] = false
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
      title: '__peekaview - Clipboard',
      titleBarStyle: 'hidden',
      x: screen.getPrimaryDisplay().bounds.x + (isMac || isLinux ? (screen.getPrimaryDisplay().workAreaSize.width - width) / 2 : screen.getPrimaryDisplay().workAreaSize.width - width + 10),
      y: screen.getPrimaryDisplay().bounds.y + (isMac || isLinux ? 60 : screen.getPrimaryDisplay().workAreaSize.height - height + 30),
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
      x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width - width) / 2,
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
  }

  function getToolbarBounds() {
    if (!toolbarWindow)
      return undefined

    return {
      ...toolbarWindow.getBounds(),
      ...toolbarSize,
    }
  }

  function hideOverlays() {
    for (const id in overlayCursor) {
      if (overlayCursor[id]) {
        overlayCursor[id].close()
        delete overlayCursor[id]
      }
    }

    if (drawOverlayWindow) {
      drawOverlayWindow.close()
      drawOverlayWindow = undefined
    }
  }

  function hideRemoteControl() {
    hideOverlays()
    remoteControlActive = false
  }

  function mousePosition(obj) {
    if (isWin32)
      return screen.dipToScreenPoint(new Point(overlayCursor[obj.id].getPosition()[0] + 210, overlayCursor[obj.id].getPosition()[1] + 10))
    else
      return new Point(overlayCursor[obj.id].getPosition()[0] + 210, overlayCursor[obj.id].getPosition()[1] + 10)
  }

  function updateUsers(newUsers: UserData[]) {
    users = newUsers
    drawOverlayWindow?.webContents.send('on-update-users', newUsers)
  }

  function mouseMove(data: RemoteMouseData) {
    if (!data.userId)
      return

    if (!overlayCursor[data.userId] && remoteControlActive) {
      console.log(data)
      console.log(`show cursor ${data.userId}`)
      showOverlayCursorWindow(data.userId)
    }

    overlayCursorLastAction[data.userId] = Date.now()

    if (overlayCursor[data.userId])
      overlayCursor[data.userId].setPosition(data.x + windowBorders.left - 210, data.y + windowBorders.top - 10)

    lastTargetPoints[data.userId] = new Point(data.x + windowBorders.left, data.y + windowBorders.top)
    if (mousePressed[data.userId])
      mouse.setPosition(mousePosition(data))
  }

  function mouseSignal(data: RemoteMouseData) {
    if (!data.userId)
      return

    showOverlayCursorSignal(data.userId)
  }

  function mouseWheel(data: RemoteMouseData) {
    console.log(`scroll ${data.delta}`)
    if (data.delta! < 0)
      keyboard.type(Key.PageUp)
    else
      keyboard.type(Key.PageDown)
  }

  function mouseLeftClick(data: RemoteMouseData) {
    if (!data.userId)
      return

    if (overlayCursorSignal[data.userId]) {
      overlayCursorSignal[data.userId].close()
      delete overlayCursorSignal[data.userId]
    }

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[data.userId]}`)

    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    setTimeout(() => { console.log('leftClick'); mouse.leftClick() ; mousePressed[data.userId] = false;}, 50)
  }

  function mouseDblClick(data: RemoteMouseData) {
    if (!data.userId)
      return

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[data.userId]}`)
    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    setTimeout(() => { console.log('dblclick1'); mouse.leftClick() }, 50)
    setTimeout(() => { console.log('dblclick2'); mouse.leftClick() }, 100)
    setTimeout(() => { mouse.setPosition(lastMousePos) }, 250)
  }

  function mouseClick(data: RemoteMouseData) {
    if (!data.userId)
      return

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[data.userId]}`)
    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    setTimeout(() => { console.log('rightClick'); mouse.rightClick() }, 50)
    setTimeout(() => { mouse.setPosition(lastMousePos) }, 200)
  }

  function mouseDown(data: RemoteMouseData) {
    if (!data.userId)
      return

    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    mouseMove(data)
    mouse.setPosition(mousePosition(data))

    if (!mousePressed[data.userId]) {
      console.log(`setposition: ${lastTargetPoints[data.userId]}`)
      mouse.setPosition(convertObjToAbsolutePosition(data))
      setTimeout(() => { console.log('mouseDown'); mouse.pressButton(Button.LEFT) }, 50)
    }
    mousePressed[data.userId] = true
  }

  function mouseUp(data: RemoteMouseData) {
    if (!data.userId)
      return

    if (mousePressed[data.userId]) {
      console.log(`setposition: ${lastTargetPoints[data.userId]}`)
      mouseMove(data)
      mouse.setPosition(mousePosition(data))
      setTimeout(() => { console.log('mouseUp'); mouse.releaseButton(Button.LEFT) }, 50)
      mousePressed[data.userId] = false

      setTimeout(() => { mouse.setPosition(lastMousePos) }, 200)
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

    const sendobj = {
      room: data.room,
      text: remoteclipboard,
    }
    sendRemote('getclipboard', sendobj)

    // @ts-ignore: nut-js does not support clipboard.copy
    await clipboard.copy(tmpclipboard)
  }

  function toggleClipboardWindow(toggle?: boolean) {
    if (toggle === undefined)
      toggle = !clipboardWindow

    if (!toggle)
      clipboardWindow?.close()
    else if (lastClipboardData !== undefined)
      dataToClipboard(lastClipboardData)
  }

  function receiveFile(data: RemoteFileData) {
    fileChunkRegistry.register(data)
  }

  function receiveFileChunk(data: RemoteFileChunkData) {
    fileChunkRegistry.receiveChunk(data)
  }

  function textToClipboard(data: RemotePasteData) {
    if (data.text)
      return

    if (!remoteControlActive || !remoteControlInputEnabled) {
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

  function convertObjToAbsolutePosition(obj) {
    const screeninfo = windowManager.getScreenInfo({
      x: windowBorders.left + (windowBorders.right - windowBorders.left) / 2,
      y: windowBorders.top + (windowBorders.bottom - windowBorders.top) / 2,
    })

    console.log(windowBorders.left + (windowBorders.right - windowBorders.left) / 2)
    console.log(windowBorders)
    console.log(screeninfo.bounds.x)
    console.log(screeninfo.bounds.y)
    console.log(screeninfo)

    let posx = 0
    let posy = 0
    if (windowManager.windowhwnd < 10) {
      posx = Math.round(obj.x * windowManager.getScaleFactor() + (windowBorders.left - screeninfo.bounds.x) * windowManager.getScaleFactor() + screeninfo.bounds.x)
      posy = Math.round(obj.y * windowManager.getScaleFactor() + (windowBorders.top - screeninfo.bounds.y) * windowManager.getScaleFactor() + screeninfo.bounds.y)
    }
    else {
      posx = Math.round(obj.x * windowManager.getScaleFactor() + (windowBorders.left - screeninfo.bounds.x) * windowManager.getScaleFactor() + screeninfo.bounds.x)
      posy = Math.round(obj.y * windowManager.getScaleFactor() + (windowBorders.top - screeninfo.bounds.y) * windowManager.getScaleFactor() + screeninfo.bounds.y)
    }

    if (screeninfo.id == screen.getPrimaryDisplay().id) {
      posx = posx * screen.getPrimaryDisplay().scaleFactor
      posy = posy * screen.getPrimaryDisplay().scaleFactor
    }

    console.log(`${posx}:${posy}`)

    return new Point(posx, posy)
  }

  function onRemote<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
    keyboard.config.autoDelayMs = 5
    let mouseData
    switch (event) {
      case 'copy':
        if (remoteControlInputEnabled)
          copyToClipboard(data, false)
        break
      case 'paste':
        //if (remoteControlInputEnabled)
          textToClipboard(data as RemotePasteData)
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
        if (remoteControlInputEnabled)
          copyToClipboard(data, true)
        break
      case 'mouse-move':
        if (mouseEnabled) {
          mouseMove(data as RemoteMouseData)
          showDrawOverlayWindow('on-mouse-move', data as RemoteMouseData)
        }
        break
      case 'mouse-click':
        if (remoteControlInputEnabled)
          mouseClick(data as RemoteMouseData)
        break
      case 'mouse-dblclick':
        if (remoteControlInputEnabled)
          mouseDblClick(data as RemoteMouseData)
        break
      case 'mouse-leftclick':
        mouseData = data as RemoteMouseData
        if (remoteControlInputEnabled && !mouseData.draw) {
          if (!isMac)
            mouseSignal(mouseData)
  
          mouseLeftClick(mouseData)
        }
        else if (mouseEnabled) {
          mouseSignal(mouseData)
        }
        break
      case 'mouse-down':
        mouseData = data as RemoteMouseData
        if (remoteControlInputEnabled && !mouseData.draw)
          mouseDown(mouseData)
        else if (mouseEnabled)
          showDrawOverlayWindow('on-mouse-down', mouseData)
        break;
      case 'mouse-wheel':
        if (remoteControlInputEnabled)
          mouseWheel(data as RemoteMouseData)
        break;
      case 'mouse-up':
        mouseData = data as RemoteMouseData
        if (remoteControlInputEnabled && !mouseData.draw)
          mouseUp(data as RemoteMouseData)
        else if (mouseEnabled)
          showDrawOverlayWindow('on-mouse-up', mouseData)
        break;
      case 'type':
        if (remoteControlInputEnabled)
          typeKey(data)
        break;
    }
  }

  /*
  function moveoverlayCursorWindowsToTop() {
    const self = this
    setTimeout(() => {
      Object.entries(self.overlayCursor).forEach((entry) => {
        const [key, value] = entry
        try {
          self.overlayCursor[key].setAlwaysOnTop(true, 'screen-saver')
        }
        catch (e) {}
      })
    }, 100)
    setTimeout(() => {
      Object.entries(self.overlayCursor).forEach((entry) => {
        const [key, value] = entry
        try {
          self.overlayCursor[key].setAlwaysOnTop(true, 'screen-saver')
        }
        catch (e) {}
      })
    }, 500)
  } */

  return {
    mouseEnabled,
    remoteControlInputEnabled,

    activate,
    deactivate,
    toggleClipboardWindow,
    toggleRemoteControl,
    toggleMouse,
    getToolbarBounds,
    hideRemoteControl,
    updateUsers,
    onRemote,
  }
}