import {
  mouse,
  Point,
  clipboard,
  keyboard,
  Key,
  Button,
} from '@nut-tree-fork/nut-js'
import { BrowserWindow, screen } from 'electron'
// import { fileTypeFromBlob } from 'file-type';

// import { Streamer } from "./Streamer.js";
import { WindowManager } from '../modules/WindowManager.js'
import { resolvePath } from '../util.js'
import { RemoteData, RemoteEvent } from '../../interface.d'

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
    sendRemote('mouse-control', { enabled: true })
  }

  function disableMouse() {
    console.log('Disabling mouse control')
    mouseEnabled = false
    hideOverlays()
    sendRemote('mouse-control', { enabled: false })
  }

  function enableRemoteControl() {
    console.log('Enabling remote control')
    remoteControlInputEnabled = true
    sendRemote('remote-control', { enabled: true })
  }

  function disableRemoteControl() {
    console.log('Disabling remote control')
    remoteControlInputEnabled = false
    sendRemote('remote-control', { enabled: false })
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
    if (!data.id || !remoteControlActive)
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
    overlayDrawer.webContents.send(action, JSON.stringify(data))
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
    if (!data.id)
      return

    if (!overlayCursor[data.id] && remoteControlActive) {
      console.log(data)
      console.log(`show cursor ${data.id}`)
      showoverlayCursorWindow(data.id, data.name, data.color)
    }

    overlayCursorLastAction[data.id] = Date.now()

    if (overlayCursor[data.id])
      overlayCursor[data.id].setPosition(data.x + windowBorders.left - 210, data.y + windowBorders.top - 10)

    lastTargetPoints[data.id] = new Point(data.x + windowBorders.left, data.y + windowBorders.top)
    if (mousePressed[data.id])
      mouse.setPosition(mousePosition(data))
  }

  function mouseSignal(data: any) {
    if (!data.id)
      return

    showoverlayCursorSignal(data.id, data.name, data.color)
  }

  function mouseWheel(data: any) {
    console.log(`scroll ${data.delta}`)
    if (data.delta < 0)
      keyboard.type(Key.PageUp)
    else
      keyboard.type(Key.PageDown)
  }

  function mouseLeftClick(data: any) {
    if (!data.id)
      return

    if (overlayCursorSignal[data.id]) {
      overlayCursorSignal[data.id].close()
      delete overlayCursorSignal[data.id]
    }

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[data.id]}`)

    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    setTimeout(() => { console.log('leftClick'); mouse.leftClick() ; mousePressed[data.id] = false;}, 50)
  }

  function mouseDblClick(data: any) {
    if (!data.id)
      return

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[data.id]}`)
    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    setTimeout(() => { console.log('dblclick1'); mouse.leftClick() }, 50)
    setTimeout(() => { console.log('dblclick2'); mouse.leftClick() }, 100)
    setTimeout(() => { mouse.setPosition(lastMousePos) }, 250)
  }

  function mouseClick(data: any) {
    if (!data.id)
      return

    windowManager.focus()
    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${lastTargetPoints[data.id]}`)
    mouseMove(data)
    mouse.setPosition(mousePosition(data))
    setTimeout(() => { console.log('rightClick'); mouse.rightClick() }, 50)
    setTimeout(() => { mouse.setPosition(lastMousePos) }, 200)
  }

  function mouseDown(data: any) {
    if (!data.id)
      return

    lastMousePos = windowManager.convertDipPosition(screen.getCursorScreenPoint())
    mouseMove(data)
    mouse.setPosition(mousePosition(data))

    if (!mousePressed[data.id]) {
      console.log(`setposition: ${lastTargetPoints[data.id]}`)
      mouse.setPosition(convertObjToAbsolutePosition(data))
      setTimeout(() => { console.log('mouseDown'); mouse.pressButton(Button.LEFT) }, 50)
    }
    mousePressed[data.id] = true
  }

  function mouseUp(data: any) {
    if (!data.id)
      return

    if (mousePressed[data.id]) {
      console.log(`setposition: ${lastTargetPoints[data.id]}`)
      mouseMove(data)
      mouse.setPosition(mousePosition(data))
      setTimeout(() => { console.log('mouseUp'); mouse.releaseButton(Button.LEFT) }, 50)
      mousePressed[data.id] = false

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
    clipboardWindow.webContents.send('pasteFromFile', JSON.stringify(data))
    clipboardWindow.show()

    clipboardWindow.on('closed', () => {
      clipboardWindow = undefined
    })
  }

  function pasteFromClipboard(data: any) {
    console.log("pasteFromClipboard", data)
    if (data.filecontent)
      return

    if (!remoteControlActive || !remoteControlInputEnabled) {
      const obj2 = { filecontent: `data:text/plain;base64,${btoa(data.text)}` }
      pasteFromFile(obj2)
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
    switch (event) {
      case 'copy':
        if (remoteControlInputEnabled)
          copyToClipboard(data, false)
        break
      case 'paste':
        //if (remoteControlInputEnabled)
          pasteFromClipboard(data)
        break
      case 'pastefile':
        if (mouseEnabled)
          pasteFromFile(data)
        break
      case 'cut':
        if (remoteControlInputEnabled)
          copyToClipboard(data, true)
        break
      case 'mouse-move':
        if (mouseEnabled) {
          mouseMove(data)
          showDrawCanvas('mouse-move', data)
        }
        break
      case 'paint-mouse-move':
        if (mouseEnabled) {
          mouseMove(data)
          showDrawCanvas('mouse-move', data)
        }
        break
      case 'mouse-click':
        if (remoteControlInputEnabled)
          mouseClick(data)
        break
      case 'mouse-dblclick':
        if (remoteControlInputEnabled)
          mouseDblClick(data)
        break
      case 'mouse-leftclick':
        if (remoteControlInputEnabled) {
          if (!isMac)
            mouseSignal(data)
  
          mouseLeftClick(data)
        }
        else if (mouseEnabled) {
          mouseSignal(data)
        }
        break
      case 'paint-mouse-leftclick':
        if (mouseEnabled)
          mouseSignal(data)
        break
      case 'mouse-down':
        if (remoteControlInputEnabled)
          mouseDown(data)
        else if (mouseEnabled)
          showDrawCanvas('mouse-down', data)
        break;
      case 'paint-mouse-down':
        if (mouseEnabled)
          showDrawCanvas('mouse-down', data)
        break;
      case 'mouse-wheel':
        if (remoteControlInputEnabled)
          mouseWheel(data)
        break;
      case 'mouse-up':
        if (remoteControlInputEnabled)
          mouseUp(data)
        else if (mouseEnabled)
          showDrawCanvas('mouse-up', data)
        break;
      case 'paint-mouse-up':
        if (mouseEnabled)
          showDrawCanvas('mouse-up', data)
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
    enableMouse,
    disableMouse,
    toggleMouse,
    enableRemoteControl,
    disableRemoteControl,
    toggleRemoteControl,
    hideRemoteControl,
    onRemote,
  }
}