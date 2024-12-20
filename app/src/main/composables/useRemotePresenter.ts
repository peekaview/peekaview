import {
  mouse,
  Point,
  clipboard,
  keyboard,
  Key,
  Button,
} from '@nut-tree-fork/nut-js'
import { BrowserWindow, screen } from 'electron'
// import SocketIO from 'socket.io-client';
// import { fileTypeFromBlob } from 'file-type';
// import { Streamer } from "./Streamer.js";
import { WindowManager } from '../modules/WindowManager.js'
import { resolvePath } from '../util.js'
import { Socket } from 'socket.io-client'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

const controlkey = isMac ? Key.LeftSuper : Key.LeftControl

export function useRemotePresenter() {
  const overlayCursor: Record<string, BrowserWindow> = {}
  const overlayCursorLastAction: Record<string, number> = {}
  const overlayCursorSignal: Record<string, BrowserWindow> = {}
  const lastTargetPoints: Record<string, Point> = {}
  const mousePressed: Record<string, boolean> = {}

  let overlayDrawer: BrowserWindow | undefined
  let clipboardWindow: BrowserWindow | undefined
  let hwnd = 0
  let localClipboardTime = 0
  let mouseEnabled = true
  let lastKey: string
  let remoteControlActive = false
  let remoteControlInputEnabled = false
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
  let socket

  function deactivate() {
    if (cursorCheckInterval) {
      clearInterval(cursorCheckInterval)
      cursorCheckInterval = undefined
    }
    remoteControlActive = false
  }

  function activate(newHwnd) {
    hwnd = newHwnd
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
  }

  function toggleRemoteControl() {
    remoteControlInputEnabled = !remoteControlInputEnabled
  }

  function toggleMouse() {
    mouseEnabled = !mouseEnabled
    if (!mouseEnabled)
      hideOverlays()
  }

  function enableMouse() {
    console.log('Enabling mouse control')
    mouseEnabled = true
    socket.emit('mouse-control', { enabled: true })
  }

  function disableMouse() {
    console.log('Disabling mouse control')
    mouseEnabled = false
    hideOverlays()
    socket.emit('mouse-control', { enabled: false })
  }

  function enableRemoteControl() {
    console.log('Enabling remote control')
    remoteControlInputEnabled = true
    socket.emit('remote-control', { enabled: true })
  }

  function disableRemoteControl() {
    console.log('Disabling remote control')
    remoteControlInputEnabled = false
    socket.emit('remote-control', { enabled: false })
  }

  function showoverlayCursorSignal(id: string, name: string, color: string) {
    if (!lastTargetPoints[id])
      return

    const cpoint = lastTargetPoints[id]
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
      title: `__peekaview - Cursorsignal ${name}`,
      // titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: true,
        preload: resolvePath('static/js/cursoroverlaysignal.js'),
        additionalArguments: [id, name, color],
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

  function showDrawCanvas(action: string, data: any) {
    const obj = JSON.parse(data)
    if (!obj.id || !remoteControlActive)
      return

    if (!overlayDrawer) {
      const activeWindowDimensions = windowManager.getWindowOuterDimensions()
      overlayDrawer = new BrowserWindow({
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
        title: '__peekaview - Drawer ',
        // titleBarStyle: 'hidden',
        webPreferences: {
          webSecurity: false,
          nodeIntegration: true,
          contextIsolation: false,
          preload: resolvePath('static/js/drawer.js'),
        },
      })

      // overlayDrawer.openDevTools();
      overlayDrawer.removeMenu()
      overlayDrawer.setIgnoreMouseEvents(true)
      // overlayDrawer.setAlwaysOnTop(true, 'screen-saver');
      overlayDrawer.loadFile(resolvePath('static/drawer.html'))
    }
    overlayDrawer.webContents.send(action, data)
  }

  function showoverlayCursorWindow(id: string, name: string, color: string) {
    if (overlayCursor[id])
      return

    const activeWindowDimensions = windowManager.getWindowOuterDimensions()
    windowBorders.left = activeWindowDimensions.left
    windowBorders.top = activeWindowDimensions.top

    if (!overlayCursor[id]) {
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
        title: `__peekaview - Cursor ${name}`,
        // titleBarStyle: 'hidden',
        webPreferences: {
          nodeIntegration: true,
          preload: resolvePath('static/js/cursoroverlay.js'),
          additionalArguments: [id, name, color],
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

  function hideOverlays() {
    for (const id in overlayCursor) {
      if (overlayCursor[id]) {
        overlayCursor[id].close()
        delete overlayCursor[id]
      }
    }

    if (overlayDrawer) {
      overlayDrawer.close()
      overlayDrawer = undefined
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

  function mouseMove(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    if (!overlayCursor[obj.id]) {
      console.log(obj)
      console.log(`show cursor ${obj.id}`)
      showoverlayCursorWindow(obj.id, obj.name, obj.color)
    }

    overlayCursorLastAction[obj.id] = Date.now()

    if (overlayCursor[obj.id])
      overlayCursor[obj.id].setPosition(obj.x + windowBorders.left - 210, obj.y + windowBorders.top - 10)

    lastTargetPoints[obj.id] = new Point(obj.x + windowBorders.left, obj.y + windowBorders.top)
    if (mousePressed[obj.id])
      mouse.setPosition(mousePosition(obj))
  }

  function mouseSignal(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    showoverlayCursorSignal(obj.id, obj.name, obj.color)
  }

  function mouseWheel(data: any) {
    const obj = JSON.parse(data)

    console.log(`scroll ${obj.delta}`)
    if (obj.delta < 0)
      keyboard.type(Key.PageUp)
    else
      keyboard.type(Key.PageDown)
  }

  function mouseLeftClick(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    if (overlayCursorSignal[obj.id]) {
      overlayCursorSignal[obj.id].close()
      delete overlayCursorSignal[obj.id]
    }

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[obj.id]}`)

    mouseMove(data)
    mouse.setPosition(mousePosition(obj))
    setTimeout(() => { console.log('leftClick'); mouse.leftClick() }, 50)
  }

  function mouseDblClick(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[obj.id]}`)
    mouseMove(data)
    mouse.setPosition(mousePosition(obj))
    setTimeout(() => { console.log('dblclick1'); mouse.leftClick() }, 50)
    setTimeout(() => { console.log('dblclick2'); mouse.leftClick() }, 100)
    setTimeout(() => { mouse.setPosition(lastMousePos) }, 250)
  }

  function mouseClick(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[obj.id]}`)
    mouseMove(data)
    mouse.setPosition(mousePosition(obj))
    setTimeout(() => { console.log('rightClick'); mouse.rightClick() }, 50)
    setTimeout(() => { mouse.setPosition(lastMousePos) }, 200)
  }

  function mouseDown(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    mouseMove(data)
    mouse.setPosition(mousePosition(obj))

    if (!mousePressed[obj.id]) {
      console.log(`setposition: ${lastTargetPoints[obj.id]}`)
      mouse.setPosition(convertObjToAbsolutePosition(obj))
      setTimeout(() => { console.log('mouseDown'); mouse.pressButton(Button.LEFT) }, 50)
    }
    mousePressed[obj.id] = true
  }

  function mouseUp(data: any) {
    const obj = JSON.parse(data)
    if (!obj.id)
      return

    if (mousePressed[obj.id]) {
      console.log(`setposition: ${lastTargetPoints[obj.id]}`)
      mouseMove(data)
      mouse.setPosition(mousePosition(obj))
      setTimeout(() => { console.log('mouseUp'); mouse.releaseButton(Button.LEFT) }, 50)
      mousePressed[obj.id] = false

      setTimeout(() => { mouse.setPosition(lastMousePos) }, 200)
    }
  }

  async function copyToClipboard(data: any, cut: boolean) {
    localClipboardTime = Date.now()

    console.log(data)

    const obj = JSON.parse(data);
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
      socketid: obj.socketid,
      room: obj.room,
      text: remoteclipboard,
    }
    socket.volatile.emit('getclipboard', sendobj)

    // @ts-ignore: nut-js does not support clipboard.copy
    await clipboard.copy(tmpclipboard)
  }

  function pasteFromFile(data: any) {
    if (clipboardWindow) {
      clipboardWindow.close()
      clipboardWindow = undefined
    }

    clipboardWindow = new BrowserWindow({
      width: 170,
      height: 200,
      // transparent: true,
      // skipTaskbar: true,
      focusable: true,
      enableLargerThanScreen: true,
      useContentSize: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      title: '__peekaview - Clipboard',
      titleBarStyle: 'hidden',
      skipTaskbar: true,
      //x: screen.getPrimaryDisplay().workAreaSize.width - 170,
      //y: screen.getPrimaryDisplay().workAreaSize.height - 250,
      x: screen.getPrimaryDisplay().bounds.x + (isMac || isLinux ?  screen.getPrimaryDisplay().workAreaSize.width / 2 - 85 : screen.getPrimaryDisplay().workAreaSize.width - 180),
      y: screen.getPrimaryDisplay().bounds.y + (isMac || isLinux ? 60 : screen.getPrimaryDisplay().workAreaSize.height - 210),
      webPreferences: {
        webSecurity: false,
        nodeIntegration: true,
        contextIsolation: false,
        preload: resolvePath('static/js/clipboard.js'),
      },
    })

    clipboardWindow.removeMenu()
    clipboardWindow.setAlwaysOnTop(true, 'screen-saver')
    clipboardWindow.loadFile(resolvePath('static/clipboard.html'))
    //clipboardWindow.webContents.openDevTools();
    clipboardWindow.webContents.send('pasteFromFile', data)
    clipboardWindow.show()

    clipboardWindow.on('closed', () => {
      clipboardWindow = undefined
    })
  }

  function pasteFromClipboard(data: any) {
    const obj = JSON.parse(data)
    if (obj.filecontent)
      return

    if (!remoteControlActive || !remoteControlInputEnabled) {
      const obj2 = { filecontent: `data:text/plain;base64,${btoa(obj.text)}` }
      pasteFromFile(JSON.stringify(obj2))
    }
    else {
      console.log(`localclipboard: ${localClipboardTime}, remoteclipboard: ${obj.time}`)
      if (obj.time > localClipboardTime) {
        (async () => {
          const tmpclipboard = await clipboard.getContent()
          await clipboard.setContent(obj.text)
          await keyboard.pressKey(controlkey, Key.V)
          await keyboard.releaseKey(controlkey, Key.V)
          await clipboard.setContent(tmpclipboard)
        })()
      }
    }
  }

  function typeKey(data: any) {
    const obj = JSON.parse(data)
    if (!obj.key)
      return


    console.log(obj.key)
    const key = obj.key
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

  function registerEventListener(newSocket: Socket) {
    console.log('register eventlistener')
    socket = newSocket

    socket.on('copy', (data) => {
      if (remoteControlInputEnabled)
        copyToClipboard(data, false)
    })

    socket.on('paste', (data) => {
      //if (remoteControlInputEnabled)
      pasteFromClipboard(data)
    })

    socket.on('pastefile', (data) => {
      if (mouseEnabled)
        pasteFromFile(data)
    })

    socket.on('cut', (data) => {
      if (remoteControlInputEnabled)
        copyToClipboard(data, true)
    })

    socket.on('mouse-move', (data) => {
      if (mouseEnabled) {
        mouseMove(data)
        showDrawCanvas('mouse-move', data)
      }
    })

    socket.on('paint-mouse-move', (data) => {
      if (mouseEnabled)
        mouseMove(data)
        showDrawCanvas('mouse-move', data)
    })

    socket.on('mouse-click', (data) => {
      console.log('mouse-click')
      if (remoteControlInputEnabled)
        mouseClick(data)
    })

    socket.on('mouse-dblclick', (data) => {
      console.log('mouse-dblclick')
      if (remoteControlInputEnabled)
        mouseDblClick(data)
    })

    socket.on('mouse-leftclick', (data) => {
      console.log('mouse-leftclick')
      if (remoteControlInputEnabled) {
        if (!isMac)
          mouseSignal(data)

        mouseLeftClick(data)
      }
      else if (mouseEnabled) {
        mouseSignal(data)
      }
    })

    socket.on('paint-mouse-leftclick', (data) => {
      console.log('paint-mouse-leftclick')
      if (mouseEnabled)
        mouseSignal(data)
    })

    socket.on('mouse-down', (data) => {
      console.log('mouse-down')
      if (remoteControlInputEnabled)
        mouseDown(data)
      else if (mouseEnabled)
        showDrawCanvas('mouse-down', data)
    })

    socket.on('paint-mouse-down', (data) => {
      console.log('paint-mouse-down')
      if (mouseEnabled)
        showDrawCanvas('mouse-down', data)
    })

    socket.on('mouse-wheel', (data) => {
      console.log('mouse-wheel')
      if (remoteControlInputEnabled)
        mouseWheel(data)
    })

    socket.on('mouse-up', (data) => {
      console.log('mouse-up')
      if (remoteControlInputEnabled)
        mouseUp(data)
      else if (mouseEnabled)
        showDrawCanvas('mouse-up', data)
    })

    socket.on('paint-mouse-up', (data) => {
      console.log('paint-mouse-up')
      if (mouseEnabled)
        showDrawCanvas('mouse-up', data)
    })

    keyboard.config.autoDelayMs = 5
    socket.on('type', (data) => {
      if (remoteControlInputEnabled)
        typeKey(data)
    })
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
    enableMouse,
    disableMouse,
    toggleMouse,
    enableRemoteControl,
    disableRemoteControl,
    toggleRemoteControl,
    hideRemoteControl,
    registerEventListener,
  }
}