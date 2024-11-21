import path from 'path'
import { dialog, ipcMain, screen, BrowserWindow } from 'electron'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

export class CustomDialog {
  constructor() {
    this.dialoglist = []
    this.traylist = []
    this.sharelist = []
    this.soundfile = null
  }

  getDialogResult() {
    const promise = new Promise((resolve, reject) => {
      ipcMain.once('replyDialog', (event, res) => {
        resolve(res)
      })
    })
    return promise
  }

  closeTrayDialogs() {
    this.traylist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  closeShareDialogs() {
    this.sharelist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  closeDialogs() {
    this.dialoglist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  playSoundOnOpen(soundfile) {
    this.soundfile = soundfile
  }

  openShareDialog(hostname, params) {
    this._openPopup(hostname, 'share', params)
  }

  openTrayDialog(hostname, params) {
    this.closeTrayDialogs()
    this._openPopup(hostname, 'tray', params)
  }

  openDialog(hostname, params) {
    this._openPopup(hostname, 'dialog', params)
  }

  _openPopup(hostname, type, params) {
    const windowParams = {}
    if (type === 'share') {
      windowParams.width = 400
      windowParams.height = 50
      windowParams.x = screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 250)
      windowParams.y = screen.getPrimaryDisplay().bounds.y -8
      windowParams.template = 'dialogshare.html'
    }
    else if (type === 'tray') {
      windowParams.width = 500
      windowParams.height = 200
      windowParams.x = screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width - 500)
      windowParams.y = screen.getPrimaryDisplay().bounds.y + (isMac || isLinux ? 0 : screen.getPrimaryDisplay().workAreaSize.height - 175)
      windowParams.template = 'dialogtray.html'
    }
    else if (type === 'dialog') {
      windowParams.width = 500
      windowParams.height = 600
      windowParams.x = screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 250)
      windowParams.y = screen.getPrimaryDisplay().bounds.y + (screen.getPrimaryDisplay().workAreaSize.height / 2 - 300)
      windowParams.template = 'dialog.html'
    }

    const defaultParams = {
      title: 'Info',
      type: 'info',
      buttons: [],
      noLink: true,
      defaultId: 0,
      cancelId: (type !== 'dialog' ? 0 : params.buttons.length - 1),
      message: '',
      timeout: (type === 'tray' ? 3000 : 0),
      detail: '',
      soundfile: (this.soundfile != null) ? this.soundfile : null,
    }

    this.soundfile = null

    const dialogWindow = new BrowserWindow({
      width: windowParams.width,
      minWidth: windowParams.width,
      height: windowParams.height,
      minHeight: windowParams.height,
      minimizeable: false,
      maximizeable: false,
      focusable: true,
      alwaysOnTop: true,
      transparent: true,
      //skipTaskbar: true,
      skipTaskbar: (type !== 'dialog'),
      show: false,
      title: `peekaview - ${params.title}`,
      frame: false,
      x: windowParams.x,
      y: windowParams.y,
      icon: 'public/static/peekaviewlogo.png',
      webPreferences: {
        preload: 'public/static/dialog.js',
        additionalArguments: [hostname],
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        webSecurity: false,
      },
    })

    dialogWindow.loadFile(`public/static/${windowParams.template}`)
    if (type === 'dialog')
      dialogWindow.center()
    dialogWindow.show()
    dialogWindow.webContents.openDevTools()
    dialogWindow.webContents.once('dom-ready', () => {
      dialogWindow.webContents.send('params', {
        ...defaultParams,
        ...params,
      })
    })

    if (type === 'tray')
      this.traylist.push(dialogWindow)
    if (type === 'dialog')
      this.dialoglist.push(dialogWindow)
    if (type === 'share')
      this.sharelist.push(dialogWindow)
  }
}