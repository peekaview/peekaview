import path from 'path'
import { ipcMain, screen, BrowserWindow } from 'electron'
import { windowLoad } from '../util'
import { DialogOptions } from '../../interface'

import PeekaViewLogo from '../../assets/img/peekaviewlogo.png'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

export function useCustomDialog() {
  const dialoglist: BrowserWindow[] = []
  const traylist: BrowserWindow[] = []
  let sound: string | null

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

  function closeDialogs() {
    dialoglist.forEach((popupwin) => {
      try { popupwin.close() }
      catch (error) { }
    })
  }

  function playSoundOnOpen(s: string) {
    sound = s
  }

  function openTrayDialog(hostname: string, options: DialogOptions) {
    closeTrayDialogs()
    openDialog(hostname, options, 'tray')
  }

  function openDialog(hostname: string, options: DialogOptions, type: 'tray' | 'dialog' = 'dialog') {
    let windowParams: {
      width: number
      height: number
      x: number
      y: number
      entryKey: string
    }

    if (type === 'tray') {
      const width = 600
      const height = 240

      windowParams = {
        width,
        height,
        x: screen.getPrimaryDisplay().bounds.x + (isMac || isLinux || isWin32 ? (screen.getPrimaryDisplay().workAreaSize.width - width) / 2 : screen.getPrimaryDisplay().workAreaSize.width - width),
        y: screen.getPrimaryDisplay().bounds.y + (isMac || isLinux || isWin32 ? 70 : screen.getPrimaryDisplay().workAreaSize.height - 200),
        entryKey: 'dialog',
      }
    } else if (type === 'dialog') {
      const width = 500
      const height = 600

      windowParams = {
        width,
        height,
        x: screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().workAreaSize.width - width) / 2,
        y: screen.getPrimaryDisplay().bounds.y + (screen.getPrimaryDisplay().workAreaSize.height - height) / 2,
        entryKey: 'dialog',
      }
    } else {
      return
    }

    const defaultOptions: DialogOptions = {
      title: 'Info',
      type: 'info',
      buttons: [],
      noLink: true,
      defaultId: 0,
      cancelId: (type !== 'dialog' ? 0 : (options.buttons ?? []).length - 1),
      windowType: type,
      message: '',
      timeout: (type === 'tray' ? 8000 : 0),
      detail: '',
      sound,
    }

    sound = null

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
      skipTaskbar: (type !== 'dialog'),
      show: false,
      title: `peekaview - ${options.title}`,
      frame: false,
      x: windowParams.x,
      y: windowParams.y,
      icon: path.join(__dirname, PeekaViewLogo),
      webPreferences: {
        preload: path.join(__dirname, '../preload/dialog.js'),
        additionalArguments: [hostname],
        nodeIntegration: true,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
      },
    })

    windowLoad(dialogWindow, windowParams.entryKey)

    if (type === 'dialog')
      dialogWindow.center()

    dialogWindow.show()
    //dialogWindow.webContents.openDevTools()
    dialogWindow.webContents.once('dom-ready', () => {
      dialogWindow.webContents.send('dialog', {
        ...defaultOptions,
        ...options,
      })
    })

    if (type === 'tray')
      traylist.push(dialogWindow)
    if (type === 'dialog')
      dialoglist.push(dialogWindow)
  }

  return {
    getDialogResult,
    closeTrayDialogs,
    closeDialogs,
    playSoundOnOpen,
    openTrayDialog,
    openDialog,
  }
}