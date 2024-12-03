import path from 'path'
import { ipcMain, screen, BrowserWindow } from 'electron'

export interface DialogParams {
  id?: number
  title?: string
  message?: string
  detail?: string
  type?: 'error' | 'warning' | 'info' | 'success' | 'download' | 'call' | 'question'
  windowtype?: 'tray' | 'dialog'
  soundfile?: string | null
  noLink?: boolean
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  timeout?: number
  data?: any
}

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

export function useCustomDialog() {
  const dialoglist: BrowserWindow[] = []
  const traylist: BrowserWindow[] = []
  const sharelist: BrowserWindow[] = []
  let soundfile: string | null

  function getDialogResult() {
    const promise = new Promise((resolve) => {
      ipcMain.once('replyDialog', (_event, res) => {
        resolve(res)
      })
    })
    return promise
  }

  function closeTrayDialogs() {
    traylist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  function closeShareDialogs() {
    sharelist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  function closeDialogs() {
    dialoglist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  function playSoundOnOpen(file: string) {
    soundfile = file
  }

  function openShareDialog(hostname: string, params: DialogParams) {
    _openPopup(hostname, 'share', params)
  }

  function openTrayDialog(hostname: string, params: DialogParams) {
    closeTrayDialogs()
    _openPopup(hostname, 'tray', params)
  }

  function openDialog(hostname: string, params: DialogParams) {
    _openPopup(hostname, 'dialog', params)
  }

  function _openPopup(hostname: string, type: 'share' | 'tray' | 'dialog', params: DialogParams) {
    let windowParams: {
      width: number
      height: number
      x: number
      y: number
      template: string
    }

    if (type === 'share')
      windowParams = {
        width: 500,
        height: 50,
        x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 250),
        y: screen.getPrimaryDisplay().bounds.y -8,
        template: 'dialogshare.html',
      }
    else if (type === 'tray')
      windowParams = {
        width: 600,
        height: 300,
        //x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 250)
        x: screen.getPrimaryDisplay().bounds.x + (isMac || isLinux || isWin32 ?  screen.getPrimaryDisplay().workAreaSize.width / 2 - 300 : screen.getPrimaryDisplay().workAreaSize.width - 600),
        y: screen.getPrimaryDisplay().bounds.y + (isMac || isLinux || isWin32 ? 30 : screen.getPrimaryDisplay().workAreaSize.height - 300),
        template: 'dialogtray.html',
      }
    else if (type === 'dialog')
      windowParams = {
        width: 500,
        height: 600,
        x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 250),
        y: screen.getPrimaryDisplay().bounds.y + (screen.getPrimaryDisplay().workAreaSize.height / 2 - 300),
        template: 'dialog.html',
      }
    else
      return

    const defaultParams = {
      title: 'Info',
      type: 'info',
      buttons: [],
      noLink: true,
      defaultId: 0,
      cancelId: (type !== 'dialog' ? 0 : (params.buttons ?? []).length - 1),
      message: '',
      timeout: (type === 'tray' ? 8000 : 0),
      detail: '',
      soundfile,
    }

    soundfile = null

    const dialogWindow = new BrowserWindow({
      width: windowParams.width,
      minWidth: windowParams.width,
      height: windowParams.height,
      minHeight: windowParams.height,
      minimizable: false,
      maximizable: false,
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
      icon: 'public/static/img/peekaviewlogo.png',
      webPreferences: {
        preload: path.join(__dirname, '../../public/static/js/dialog.js'),
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
    //dialogWindow.webContents.openDevTools()
    dialogWindow.webContents.once('dom-ready', () => {
      dialogWindow.webContents.send('params', {
        ...defaultParams,
        ...params,
      })
    })

    if (type === 'tray')
      traylist.push(dialogWindow)
    if (type === 'dialog')
      dialoglist.push(dialogWindow)
    if (type === 'share')
      sharelist.push(dialogWindow)
  }

  return {
    getDialogResult,
    closeShareDialogs,
    closeDialogs,
    playSoundOnOpen,
    openShareDialog,
    openTrayDialog,
    openDialog,
  }
}