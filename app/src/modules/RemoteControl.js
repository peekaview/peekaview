import path from 'path';
import {
  mouse,
  Point,
  clipboard,
  keyboard,
  Key,
  Button,
} from '@nut-tree-fork/nut-js';
import { BrowserWindow, screen } from 'electron';
import { app } from 'electron';
// import SocketIO from 'socket.io-client';
// import { fileTypeFromBlob } from 'file-type';
// import { Streamer } from "./Streamer.js";
import { WindowManager } from './WindowManager.js';

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

const defaulturl = 'wss://c1.peekaview.de'
let lastmousepos = new Point({ x: 0, y: 0 })
let windowcheckinterval = null
let cursorcheckinterval = null
const rectanglecheckinterval = null
const controlkey = isMac ? Key.LeftSuper : Key.LeftControl

export class RemoteControl {
  constructor(url) {
    this.overlaycursor = {}
    this.overlaydrawer = null
    this.overlaycursorlastaction = {}
    this.overlaycursorsignal = {}
    this.clipboardwindow = null
    // this.streamer = null;
    this.hwnd = 0
    this.localclipboardtime = 0
    this.lasttargetpoint = []
    this.mouseenabled = true
    this.remotecontrolactive = false
    this.remotecontrolinputenabled = false
    this.lastposx = 0
    this.lastposy = 0
    this.lastrectwidth = 0
    this.lastrectheight = 0
    this.mousePressed = []
    this.lastmouseposx = 0
    this.lastmouseposy = 0
    this.windowleftborder = 0
    this.windowtopborder = 0
    this.windowrightborder = 0
    this.windowbottomborder = 0
    this.remotecontrolinputenabled = false
    if (url == undefined || url == '')
      url = defaulturl

    const self = this
  }

  attachStreamer(streamer) {
    // this.streamer = streamer;
  }

  deactivate() {
    if (windowcheckinterval != null) {
      clearInterval(windowcheckinterval)
      windowcheckinterval = null
    }
    this.remotecontrolactive = false
  }

  activate(hwnd) {
    this.hwnd = hwnd
    this.windowManager = new WindowManager()
    this.windowManager.selectWindow(this.hwnd)

    if (windowcheckinterval != null) {
      clearInterval(windowcheckinterval)
      windowcheckinterval = null
    }
    windowcheckinterval = setInterval((self) => {
      const activeWindowDimensions = self.windowManager.getWindowOuterDimensions()
      self.windowleftborder = activeWindowDimensions.left
      self.windowtopborder = activeWindowDimensions.top
      self.windowrightborder = activeWindowDimensions.right
      self.windowbottomborder = activeWindowDimensions.bottom
    }, 1000, this)

    this.remotecontrolactive = true
  }

  toggleRemoteControl() {
    this.remotecontrolinputenabled = !this.remotecontrolinputenabled
  }

  toggleMouse() {
    this.mouseenabled = !this.mouseenabled
    if (!this.mouseenabled)
      this.hideOverlays()
  }

  showOverlayCursorSignal(id, name, color) {
    if (this.lasttargetpoint[id] == undefined || this.lasttargetpoint[id] == null)
      return

    const cpoint = this.lasttargetpoint[id]
    this.overlaycursorsignal[id] = new BrowserWindow({
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
      title: `__meetzi - Cursorsignal ${name}`,
      // titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: true,
        preload: path.join(app.getAppPath(), 'public/static/cursoroverlaysignal.js'),
        additionalArguments: [id, name, color],
      },
    })

    this.overlaycursorsignal[id].removeMenu()
    this.overlaycursorsignal[id].setIgnoreMouseEvents(true)
    // this.overlaycursorsignal[id].setAlwaysOnTop(true, 'screen-saver');
    this.overlaycursorsignal[id].loadFile('public/static/cursoroverlaysignal.html')
    console.log(`show signal${cpoint}`)

    let currentoverlaysignal = this.overlaycursorsignal[id]
    setTimeout(() => {
      try {
        if (currentoverlaysignal != undefined && currentoverlaysignal != null) {
          currentoverlaysignal.close()
          currentoverlaysignal = null
        }
      }
      catch (e) {}
    }, 1000)
  }

  showDrawCanvas(action, data) {
    const obj = JSON.parse(data)
    if (obj.id == undefined || !this.remotecontrolactive)
      return

    if (this.overlaydrawer == null) {
      const activeWindowDimensions = this.windowManager.getWindowOuterDimensions()
      this.overlaydrawer = new BrowserWindow({
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
        title: '__meetzi - Drawer ',
        // titleBarStyle: 'hidden',
        webPreferences: {
          webSecurity: false,
          nodeIntegration: true,
          contextIsolation: false,
          preload: path.join(app.getAppPath(), 'public/static/drawer.js'),
        },
      })

      // this.overlaydrawer.openDevTools();
      this.overlaydrawer.removeMenu()
      this.overlaydrawer.setIgnoreMouseEvents(true)
      // this.overlaydrawer.setAlwaysOnTop(true, 'screen-saver');
      this.overlaydrawer.loadFile('public/static/drawer.html')
    }
    this.overlaydrawer.webContents.send(action, data)
  }

  showOverlayCursorWindow(id, name, color) {
    if (this.overlaycursor[id] != undefined && this.overlaycursor[id] != null)
      return

    const activeWindowDimensions = this.windowManager.getWindowOuterDimensions()
    this.windowleftborder = activeWindowDimensions.left
    this.windowtopborder = activeWindowDimensions.top

    if (this.overlaycursor[id] == undefined || this.overlaycursor[id] == null) {
      this.overlaycursor[id] = new BrowserWindow({
        width: 400,
        height: 80,
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        enableLargerThanScreen: true,
        useContentSize: true,
        frame: false,
        alwaysOnTop: true,
        title: `__meetzi - Cursor ${name}`,
        // titleBarStyle: 'hidden',
        webPreferences: {
          nodeIntegration: true,
          preload: path.join(app.getAppPath(), 'public/static/cursoroverlay.js'),
          additionalArguments: [id, name, color],
        },
      })

      this.overlaycursor[id].removeMenu()
      this.overlaycursor[id].setAlwaysOnTop(true, 'screen-saver')
      this.overlaycursor[id].loadFile('public/static/cursoroverlay.html')
      this.overlaycursor[id].setIgnoreMouseEvents(true)

      // const self = this
      if (cursorcheckinterval == null) {
        cursorcheckinterval = setInterval(() => {
          Object.entries(this.overlaycursor).forEach((entry) => {
            const [key, value] = entry
            if (
              this.overlaycursorlastaction[key] != undefined
              && this.overlaycursorlastaction[key] < Date.now() - 10000
            ) {
              if (this.overlaycursor[key] != null) {
                console.log(`remove cursor ${key}`)
                this.overlaycursor[key].close()
                this.overlaycursor[key] = null
              }
            }
          })
        }, 1000)
      }
    }

    if (this.lasttargetpoint[id] == undefined || this.lasttargetpoint[id] == null)
      this.lasttargetpoint[id] = new Point(0, 0)

    this.mousePressed[id] = false
  }

  hideOverlays() {
    Object.entries(this.overlaycursor).forEach((entry) => {
      const [key, value] = entry

      if (this.overlaycursor != null && this.overlaycursor[key] != null) {
        this.overlaycursor[key].close()
        this.overlaycursor[key] = null
      }
    })

    if (this.overlaydrawer != null) {
      this.overlaydrawer.close()
      this.overlaydrawer = null
    }
  }

  hideRemoteControl() {
    this.hideOverlays()
    this.remotecontrolactive = false
  }

  mousePosition(obj) {
    if (isWin32)
      return screen.dipToScreenPoint(new Point(this.overlaycursor[obj.id].getPosition()[0] + 210, this.overlaycursor[obj.id].getPosition()[1] + 10))
    else
      return new Point(this.overlaycursor[obj.id].getPosition()[0] + 210, this.overlaycursor[obj.id].getPosition()[1] + 10)
  }

  mouseMove(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    if (this.overlaycursor[obj.id] === undefined || this.overlaycursor[obj.id] === null) {
      console.log(obj)
      console.log(`show cursor ${obj.id}`)
      this.showOverlayCursorWindow(obj.id, obj.name, obj.color)
    }

    this.overlaycursorlastaction[obj.id] = Date.now()

    if (this.overlaycursor != null && this.overlaycursor[obj.id] != null)
      this.overlaycursor[obj.id].setPosition(obj.x + this.windowleftborder - 210, obj.y + this.windowtopborder - 10)

    this.lasttargetpoint[obj.id] = new Point(obj.x + this.windowleftborder, obj.y + this.windowtopborder)
    if (this.mousePressed[obj.id])
      mouse.setPosition(this.mousePosition(obj))
  }

  mouseSignal(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    this.showOverlayCursorSignal(obj.id, obj.name, obj.color)
  }

  mouseWheel(data) {
    const obj = JSON.parse(data)

    console.log(`scroll ${obj.delta}`)
    if (obj.delta < 0)
      keyboard.type(Key.PageUp)
    else
      keyboard.type(Key.PageDown)
  }

  mouseLeftClick(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    if (this.overlaycursorsignal[obj.id] != undefined && this.overlaycursorsignal[obj.id] != null) {
      this.overlaycursorsignal[obj.id].close()
      this.overlaycursorsignal[obj.id] = null
    }

    this.windowManager.focus()
    lastmousepos = this.windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${this.lasttargetpoint[obj.id]}`)

    this.mouseMove(data)
    mouse.setPosition(this.mousePosition(obj))
    setTimeout(() => { console.log('leftClick'); mouse.leftClick() }, 50)
  }

  mouseDblClick(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    this.windowManager.focus()
    lastmousepos = this.windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${this.lasttargetpoint[obj.id]}`)
    this.mouseMove(data)
    mouse.setPosition(this.mousePosition(obj))
    setTimeout(() => { console.log('dblclick1'); mouse.leftClick() }, 50)
    setTimeout(() => { console.log('dblclick2'); mouse.leftClick() }, 100)
    setTimeout(() => { mouse.setPosition(lastmousepos) }, 250)
  }

  mouseClick(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    this.windowManager.focus()
    lastmousepos = this.windowManager.convertDipPosition(screen.getCursorScreenPoint())
    console.log(`setposition: ${this.lasttargetpoint[obj.id]}`)
    this.mouseMove(data)
    mouse.setPosition(this.mousePosition(obj))
    setTimeout(() => { console.log('rightClick'); mouse.rightClick() }, 50)
    setTimeout(() => { mouse.setPosition(lastmousepos) }, 200)
  }

  mouseDown(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    lastmousepos = this.windowManager.convertDipPosition(screen.getCursorScreenPoint())
    this.mouseMove(data)
    mouse.setPosition(this.mousePosition(obj))

    if (!this.mousePressed[obj.id]) {
      console.log(`setposition: ${this.lasttargetpoint[obj.id]}`)
      mouse.setPosition(this.convertObjToAbsolutePosition(obj))
      setTimeout(() => { console.log('mouseDown'); mouse.pressButton(Button.LEFT) }, 50)
    }
    this.mousePressed[obj.id] = true
  }

  mouseUp(data) {
    const obj = JSON.parse(data)
    if (obj.id === undefined)
      return

    if (this.mousePressed[obj.id]) {
      console.log(`setposition: ${this.lasttargetpoint[obj.id]}`)
      this.mouseMove(data)
      mouse.setPosition(this.mousePosition(obj))
      setTimeout(() => { console.log('mouseUp'); mouse.releaseButton(Button.LEFT) }, 50)
      this.mousePressed[obj.id] = false

      setTimeout(() => { mouse.setPosition(lastmousepos) }, 200)
    }
  }

  copyToClipboard(socket, data, cut) {
    this.localclipboardtime = Date.now()

    console.log(data)

    const obj = JSON.parse(data);
    (async () => {
      const tmpclipboard = await clipboard.paste()
      await keyboard.pressKey(controlkey, Key.C)
      await keyboard.releaseKey(controlkey, Key.C)
      const remoteclipboard = await clipboard.paste()

      if (!cut) {
        console.log(`copy to clipboad: ${remoteclipboard}`)
      }
      else {
        console.log(`cut to clipboad: ${remoteclipboard}`)
        keyboard.type(Key.Delete)
      }

      const sendobj = {}
      sendobj.socketid = obj.socketid
      sendobj.room = obj.room
      sendobj.text = remoteclipboard
      socket.volatile.emit('getclipboard', JSON.stringify(sendobj))

      await clipboard.copy(tmpclipboard)
    }) ()
  }

  pasteFromFile(socket, data) {
    if (this.clipboardwindow != null) {
      this.clipboardwindow.close()
      this.clipboardwindow = null
    }

    this.clipboardwindow = new BrowserWindow({
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
      title: '__meetzi - Clipboard',
      titleBarStyle: 'hidden',
      skipTaskbar: true,
      x: screen.getPrimaryDisplay().workAreaSize.width - 170,
      y: screen.getPrimaryDisplay().workAreaSize.height - 250,
      webPreferences: {
        webSecurity: false,
        nodeIntegration: true,
        contextIsolation: false,
        preload: path.join(app.getAppPath(), 'public/static/clipboard.js'),
      },
    })

    this.clipboardwindow.removeMenu()
    this.clipboardwindow.setAlwaysOnTop(true, 'screen-saver')
    this.clipboardwindow.loadFile('public/static/clipboard.html')
    // this.clipboardwindow.webContents.openDevTools();
    this.clipboardwindow.webContents.send('pasteFromFile', data)
    this.clipboardwindow.show()

    this.clipboardwindow.on('closed', () => {
      this.clipboardwindow = null
    })
  }

  pasteFromClipboard(socket, data) {
    const obj = JSON.parse(data)
    if (obj.filecontent != null)
      return

    if (!this.remotecontrolactive) {
      const obj2 = { filecontent: `data:text/plain;base64,${btoa(obj.text)}` }
      this.pasteFromFile(socket, JSON.stringify(obj2))
    }
    else {
      console.log(`localclipboard: ${this.localclipboardtime}, remoteclipboard: ${obj.time}`)
      if (obj.time > this.localclipboardtime) {
        (async () => {
          const tmpclipboard = await clipboard.paste()
          await clipboard.copy(obj.text)
          await keyboard.pressKey(controlkey, Key.V)
          await keyboard.releaseKey(controlkey, Key.V)
          await clipboard.copy(tmpclipboard)
        })()
      }
    }
  }

  typeKey(socket, data) {
    const obj = JSON.parse(data)
    if (obj.key === undefined)
      return

    const key = obj.key
    const specialkeys = ['@', ';', ':', '_', '°', '^', '!', '"', '§', '$', '%', '&', '/', '=', '?', '`', '´', '{', '[', ']', '}', '\\', '\'', '*', '~', '<', '>', '|']

    if (key == 'Space') {
      keyboard.type(Key.Space)
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
        const tmpclipboard = await clipboard.paste()
        await clipboard.copy(key)
        await keyboard.pressKey(controlkey, Key.V)
        await keyboard.releaseKey(controlkey, Key.V)
        await clipboard.copy(tmpclipboard)
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
      (async () => {
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
      })()
    }
    else {
      keyboard.type(key)
    }
  }

  convertObjToAbsolutePosition(obj) {
    const screeninfo = this.windowManager.getScreenInfo({
      x: this.windowleftborder + (this.windowrightborder - this.windowleftborder) / 2,
      y: this.windowtopborder + (this.windowbottomborder - this.windowtopborder) / 2,
    })

    console.log(this.windowleftborder + (this.windowrightborder - this.windowleftborder) / 2)
    console.log(this.windowleftborder)
    console.log(this.windowtopborder)
    console.log(screeninfo.bounds.x)
    console.log(screeninfo.bounds.y)
    console.log(screeninfo)

    let posx = 0
    let posy = 0
    if (this.windowManager.windowhwnd < 10) {
      posx = Math.round(obj.x * this.windowManager.getScaleFactor() + (this.windowleftborder - screeninfo.bounds.x) * this.windowManager.getScaleFactor() + screeninfo.bounds.x)
      posy = Math.round(obj.y * this.windowManager.getScaleFactor() + (this.windowtopborder - screeninfo.bounds.y) * this.windowManager.getScaleFactor() + screeninfo.bounds.y)
    }
    else {
      posx = Math.round(obj.x * this.windowManager.getScaleFactor() + (this.windowleftborder - screeninfo.bounds.x) * this.windowManager.getScaleFactor() + screeninfo.bounds.x)
      posy = Math.round(obj.y * this.windowManager.getScaleFactor() + (this.windowtopborder - screeninfo.bounds.y) * this.windowManager.getScaleFactor() + screeninfo.bounds.y)
    }

    if (screeninfo.id == screen.getPrimaryDisplay().id) {
      posx = posx * screen.getPrimaryDisplay().scaleFactor
      posy = posy * screen.getPrimaryDisplay().scaleFactor
    }

    console.log(`${posx}:${posy}`)

    return new Point(posx, posy)
  }

  registerEventListener(socket) {
    console.log('register eventlistener')
    this.socket = socket

    socket.on('copy', (data) => {
      if (this.remotecontrolinputenabled)
        this.copyToClipboard(socket, data, false)
    })

    socket.on('paste', (data) => {
      if (this.remotecontrolinputenabled)
        this.pasteFromClipboard(socket, data)
    })

    socket.on('pastefile', (data) => {
      if (this.mouseenabled)
        this.pasteFromFile(socket, data)
    })

    socket.on('cut', (data) => {
      if (this.remotecontrolinputenabled)
        this.copyToClipboard(socket, data, true)
    })

    socket.on('mouse-move', (data) => {
      if (this.mouseenabled) {
        this.mouseMove(data)
        this.showDrawCanvas('mouse-move', data)
      }
    })

    socket.on('mouse-click', (data) => {
      console.log('mouse-click')
      if (this.remotecontrolinputenabled)
        this.mouseClick(data)
    })

    socket.on('mouse-dblclick', (data) => {
      console.log('mouse-dblclick')
      if (this.remotecontrolinputenabled)
        this.mouseDblClick(data)
    })

    socket.on('mouse-leftclick', (data) => {
      console.log('mouse-leftclick')
      if (this.remotecontrolinputenabled) {
        if (!isMac)
          this.mouseSignal(data)

        this.mouseLeftClick(data)
      }
      else if (this.mouseenabled) {
        this.mouseSignal(data)
      }
    })

    socket.on('mouse-down', (data) => {
      console.log('mouse-down')
      if (this.remotecontrolinputenabled)
        this.mouseDown(data)
      else if (this.mouseenabled)
        this.showDrawCanvas('mouse-down', data)
    })

    socket.on('mouse-wheel', (data) => {
      console.log('mouse-wheel')
      if (this.remotecontrolinputenabled)
        this.mouseWheel(data)
    })

    socket.on('mouse-up', (data) => {
      console.log('mouse-up')
      if (this.remotecontrolinputenabled)
        this.mouseUp(data)
      else if (this.mouseenabled)
        this.showDrawCanvas('mouse-up', data)
    })

    keyboard.config.autoDelayMs = 5
    this.socket.on('type', (data) => {
      if (this.remotecontrolinputenabled)
        this.typeKey(socket, data)
    })
  }

  /*
  moveOverlayCursorWindowsToTop() {
    const self = this
    setTimeout(() => {
      Object.entries(self.overlaycursor).forEach((entry) => {
        const [key, value] = entry
        try {
          self.overlaycursor[key].setAlwaysOnTop(true, 'screen-saver')
        }
        catch (e) {}
      })
    }, 100)
    setTimeout(() => {
      Object.entries(self.overlaycursor).forEach((entry) => {
        const [key, value] = entry
        try {
          self.overlaycursor[key].setAlwaysOnTop(true, 'screen-saver')
        }
        catch (e) {}
      })
    }, 500)
  } */
}