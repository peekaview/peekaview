import path from 'path'
import { ipcMain, app, screen, BrowserWindow } from 'electron'
import { windowLoad } from '../util'
import { DialogOptions } from '../../interface'

import PeekaViewLogo from '../../assets/img/peekaviewlogo.png'

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

  function openTrayDialog(options: DialogOptions) {
    closeTrayDialogs()
    openDialog(options, 'tray')
  }

  function openDialog(options: DialogOptions, type: 'tray' | 'dialog' = 'dialog') {
    let windowParams: {
      width: number
      height: number
      x: number
      y: number
    }

    const primary = screen.getPrimaryDisplay()
    if (type === 'tray') {
      const width = 600
      const height = 400

      windowParams = {
        width,
        height,
        x: primary.bounds.x + (primary.workAreaSize.width - width) / 2,
        y: primary.bounds.y + 70,
      }
    } else if (type === 'dialog') {
      const width = 500
      const height = 600

      windowParams = {
        width,
        height,
        x: primary.bounds.x + (primary.workAreaSize.width - width) / 2,
        y: primary.bounds.y + (primary.workAreaSize.height - height) / 2,
      }
    } else {
      return
    }

    const defaultOptions: DialogOptions = {
      title: 'Info',
      type: 'info',
      messages: [],
      buttons: [],
      noLink: true,
      defaultId: 0,
      cancelId: (type !== 'dialog' ? 0 : (options.buttons ?? []).length - 1),
      windowType: type,
      timeout: (type === 'tray' ? 8000 : 0),
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
        nodeIntegration: true,
        contextIsolation: true,
        sandbox: false,
        webSecurity: app.isPackaged,
      },
    })

    windowLoad(dialogWindow, 'dialog')

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