import { ipcMain, screen, BrowserWindow } from 'electron'
import { resolvePath } from '../util'

export interface DialogOptions {
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

  function openShareDialog(hostname: string, options: DialogOptions) {
    openDialog(hostname, options, 'share')
  }

  function openTrayDialog(hostname: string, options: DialogOptions) {
    closeTrayDialogs()
    openDialog(hostname, options, 'tray')
  }

  function openDialog(hostname: string, options: DialogOptions, type: 'share' | 'tray' | 'dialog' = 'dialog') {
    let windowParams: {
      width: number
      height: number
      x: number
      y: number
      template: string
    }

    if (type === 'share')
      windowParams = {
        width: 420,
        height: 50,
        x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 210),
        y: screen.getPrimaryDisplay().bounds.y -8,
        template: 'dialogshare.html',
      }
    else if (type === 'tray')
      windowParams = {
        width: 600,
        height: 220,
        //x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width / 2 - 250)
        x: screen.getPrimaryDisplay().bounds.x + (isMac || isLinux || isWin32 ?  screen.getPrimaryDisplay().workAreaSize.width / 2 - 300 : screen.getPrimaryDisplay().workAreaSize.width - 600),
        y: screen.getPrimaryDisplay().bounds.y + (isMac || isLinux || isWin32 ? 70 : screen.getPrimaryDisplay().workAreaSize.height - 200),
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

    const defaultOptions: DialogOptions = {
      title: 'Info',
      type: 'info',
      buttons: [],
      noLink: true,
      defaultId: 0,
      cancelId: (type !== 'dialog' ? 0 : (options.buttons ?? []).length - 1),
      message: '',
      timeout: (type === 'tray' ? 800000 : 0),
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
      title: `peekaview - ${options.title}`,
      frame: false,
      x: windowParams.x,
      y: windowParams.y,
      icon: resolvePath('static/img/peekaviewlogo.png'),
      webPreferences: {
        preload: resolvePath('static/js/dialog.js'),
        additionalArguments: [hostname],
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        webSecurity: false,
      },
    })

    dialogWindow.loadFile(resolvePath(`static/${windowParams.template}`))
    if (type === 'dialog')
      dialogWindow.center()
    dialogWindow.show()
    //dialogWindow.webContents.openDevTools()
    dialogWindow.webContents.once('dom-ready', () => {
      dialogWindow.webContents.send('params', {
        ...defaultOptions,
        ...options,
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
    closeTrayDialogs,
    closeDialogs,
    playSoundOnOpen,
    openShareDialog,
    openTrayDialog,
    openDialog,
  }
}