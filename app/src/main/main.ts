import path from 'path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  desktopCapturer,
  Menu,
  Notification,
  nativeImage,
  protocol,
  Tray,
  session,
  shell
} from 'electron'
import { autoUpdater } from "electron-updater"
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { exec } from 'child_process'
import fs from 'fs'

import { useCustomDialog } from './composables/useCustomDialog'
import { useStreamer, type Streamer } from './composables/useStreamer'

import { DialogOptions, ElectronWindowDimensions, RemoteData, RemoteEvent, ScreenSource, StreamerData, UserData } from '../interface.js'
import { resolvePath, windowLoad } from './util'
import { i18n, i18nReady, languages } from './i18n'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'
import PeekaViewIcon from '../assets/img/peekaviewicon_mono3.png'

import HelpIcon from '../assets/img/help.png'
import InfoIcon from '../assets/img/info.png'
import LanguageIcon from '../assets/img/language.png'
import LogoutIcon from '../assets/img/logout.png'
import PresentIcon from '../assets/img/present.png'
import RequestIcon from '../assets/img/request.png'
import QuitIcon from '../assets/img/quit.png'
import { getStore } from './store'

declare const APP_VERSION: string
declare const CSP_POLICY: string

(async () => {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    const protocolUrl = process.argv.find(arg => arg.startsWith('peekaview://'))
    if (protocolUrl) {
      log.info('Protocol URL found in command line arguments, emitting second-instance event')
      app.emit('second-instance', null, [protocolUrl], null)
    }
    log.info('Another instance is running, quitting...')
    app.quit()
    return
  }

  log.info('Starting app update check')
  autoUpdater.checkForUpdatesAndNotify()
  
  if (!app.isDefaultProtocolClient('peekaview')) {
    const success = app.setAsDefaultProtocolClient('peekaview')
    if (!success) {
      log.error('Failed to set peekaview protocol')
    } else {
      log.info('Successfully set peekaview protocol')
    }
  }
  // allow superhigh cpu usage for faster video-encoding
  app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '1000')

  let loginWindow: BrowserWindow | undefined
  let viewerWindow: BrowserWindow | undefined
  let presenterWindow: BrowserWindow | undefined

  let tray: Tray

  let currentViewCode: string | undefined

  let streamer: Streamer | undefined
  const customDialog = useCustomDialog()

  const store = await getStore()
  let users: UserData[] = []

  if (process.platform === 'win32')
    app.setAppUserModelId(app.name)

  app.whenReady().then(() => {
    log.info('App is ready, initializing...')
    
    if (process.platform === 'linux') {
      exec(`xdg-mime default peekaview.desktop x-scheme-handler/peekaview`)
      log.info('Set xdg-mime defaults for Linux')
    }

    const trayIconPath = path.join(__dirname, PeekaViewIcon)
    const trayIcon: Electron.NativeImage = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
    trayIcon.setTemplateImage(true)

    tray = new Tray(trayIcon)

    tray.setToolTip('PeekaView')

    tray.on('click', () => {
      if (process.platform === 'linux')
        onTrayClick()
    })

    tray.on('double-click', () => {
      onTrayClick()
    })

    updateContextMenu()

    store.onDidChange('code', () => {
      updateContextMenu()
    })

    protocol.handle('peekaview', request => {
      log.info('Protocol handler called with URL:', request.url)
      handleProtocol(request.url)
      return new Response()
    })

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            CSP_POLICY
          ]
        }
      })
    })

    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        log.info('No windows found, creating new window on activate')
        loginWindow?.webContents.send('change-language', i18n.resolvedLanguage)
        viewerWindow?.webContents.send('change-language', i18n.resolvedLanguage)
        presenterWindow?.webContents.send('change-language', i18n.resolvedLanguage)
        tryPresenting()
      }
    })

    app.on('second-instance', (_event, commandLine) => {
      log.info('Second instance detected, focusing existing window')

      // Find protocol URL in command line arguments
      const protocolUrl = commandLine.find(arg => arg.startsWith('peekaview://'))
      if (protocolUrl) {
        log.info('Protocol URL found in command line arguments, handling')
        handleProtocol(protocolUrl)
      }

      focusApp()
    })

    log.info("App initialization complete")
    const notificationIcon = nativeImage.createFromPath(path.join(__dirname, PeekaViewLogo)).resize({ width: 64, height: 64 })
    new Notification({ title: 'PeekaView', body: i18n.t('trayMenu.running'), icon: notificationIcon }).show()
  })

  const focusApp = () => {
    let currentWindow = loginWindow ?? viewerWindow ?? presenterWindow
    if (currentWindow) {
      if (currentWindow.isMinimized())
        currentWindow.restore()
      currentWindow.show()
      currentWindow.focus()

      return true
    }

    return false
  }

  const onTrayClick = () => {
    if (!focusApp())
      tryPresenting()
  }

  const updateContextMenu = () => {
    i18nReady.then(() => {
      const menuItems: Array<(Electron.MenuItemConstructorOptions) | (Electron.MenuItem)> = []
      if (!app.isPackaged)
        menuItems.push({
          label: '[Dev] Open PeekaView URL', type: 'normal', click: () => {
            try {
              const text = clipboard.readText()
              new URL(text) // test if it's a valid URL
              handleProtocol(text)
            } catch (e) {
              console.error('Clipboard content does not seem to be a valid PeekaView URL')
            }
          },
        },
          { type: 'separator' }
      )
      
      menuItems.push(
        { icon: createMenuIcon(PresentIcon), label: i18n.t('trayMenu.shareMyScreen'), type: 'normal', click: () => tryPresenting() },
        { icon: createMenuIcon(RequestIcon), label: i18n.t('trayMenu.requestScreenShare'), type: 'normal', click: () => createViewerWindow() },
        { type: 'separator' },
        { icon: createMenuIcon(LogoutIcon), label: i18n.t('trayMenu.logout'), type: 'normal', click: () => logout(), enabled: !!store.get('code') },
        { icon: createMenuIcon(HelpIcon), label: i18n.t('trayMenu.help'), type: 'submenu', submenu: [
          { icon: createMenuIcon(InfoIcon), label: i18n.t('trayMenu.about'), type: 'normal', click: () => showAbout() },
          { icon: createMenuIcon(LanguageIcon), label: i18n.t('trayMenu.changeLanguage'), type: 'submenu', submenu: Object.entries(languages).map(([locale, label]) => (
            { label, type: 'normal', click: () => i18n.changeLanguage(locale).then(() => {
              viewerWindow?.webContents.send('change-language', locale)
              presenterWindow?.webContents.send('change-language', locale)
              loginWindow?.webContents.send('change-language', locale)
              updateContextMenu()
            })}
          ))},
        ] },
        { icon: createMenuIcon(QuitIcon), label: i18n.t('trayMenu.quit'), type: 'normal', click: () => quit() },
      )
      
      const contextMenu = Menu.buildFromTemplate(menuItems)
      tray.setContextMenu(contextMenu)
    })
  }

  const showAbout = () => {
    dialog.showMessageBox({
      message: `PeekaView v${APP_VERSION}\n\n© Limtec GmbH 2025 - info@limtec.de`,
      title: i18n.t('trayMenu.about'),
    })
  }

  const createPresenterWindow = (code: string) => {
    presenterWindow = new BrowserWindow({
      title: 'PeekaView',
      icon: path.join(__dirname, PeekaViewLogo),
      show: true,
      width: 1280,
      height: 720,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        //webSecurity: false, // Make sure this is off only for development, adjust for production.
        //allowRunningInsecureContent: true,
        preload: path.join(__dirname, '../preload/presenter.js'),
      }
    })

    presenterWindow.webContents.setWindowOpenHandler(({ url }) => {
      log.info('External URL requested:', url)
      shell.openExternal(url)
      return { action: 'deny' }
    })

    windowLoad(presenterWindow, 'presenter', { data: code })

    presenterWindow?.webContents.send('change-language', i18n.resolvedLanguage)

    !app.isPackaged && presenterWindow.webContents.openDevTools()
  }

  const createViewerWindow = () => {
    viewerWindow = new BrowserWindow({
      title: 'PeekaView',
      icon: path.join(__dirname, PeekaViewLogo),
      show: true,
      width: 1280,
      height: 720,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        //webSecurity: false, // Make sure this is off only for development, adjust for production.
        //allowRunningInsecureContent: true,
      }
    })

    windowLoad(viewerWindow, 'viewer')

    viewerWindow?.webContents.send('change-language', i18n.resolvedLanguage)

    !app.isPackaged && viewerWindow.webContents.openDevTools()
  }

  const createLoginWindow = (discardSession = false) => {
    log.info('Opening login window')
    if (loginWindow) {
      log.info('Reusing existing login window')
      if (loginWindow.isMinimized()) loginWindow.restore()
      loginWindow.focus()
      return
    }

    log.info('Creating new login window')
    loginWindow = new BrowserWindow({
      icon: path.join(__dirname, PeekaViewLogo),
      width: 360,
      height: 540,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/login.js'),
      }
    })

    loginWindow.on('close', () => {
      loginWindow = undefined
    })
    windowLoad(loginWindow, 'login', { discardSession: discardSession ? 'true' : 'false' })
    loginWindow?.webContents.send('change-language', i18n.resolvedLanguage)
  }

  function handleProtocol(url: string) {
    log.info("Processing protocol URL", url)
    const params = new URL(url).searchParams

    const code = params.get('code') ?? undefined
    store.set('code', code)
    log.info('Auth code stored from protocol')
    loginWindow?.close()
    loginWindow = undefined
    tryPresenting()
  }

  function tryPresenting() {
    const code = store.get('code')
    if (!code) {
      createLoginWindow()
      return
    }

    createPresenterWindow(code)
  }

  function logout(discardSession = false) {
    log.info('Logging out, discarding session:', discardSession)
    presenterWindow?.close()
    presenterWindow = undefined
    store.delete('code')
    createLoginWindow(discardSession)
  }

  async function startRemoteControl(data: StreamerData) {
    if (!data.source) {
      log.error('Invalid sourceId or name for remote control')
      return
    }
    let sourceId = data.source.id
    log.info('Starting remote control with sourceId:', sourceId, 'and window name:', data.source.name)
    
    streamer?.stopSharing()

    //if (streamer === undefined) {
      streamer = useStreamer((event, data) => presenterWindow?.webContents.send('send-remote', event, data), users, (hidden) => {
        presenterWindow?.webContents.send('on-hidden', hidden)
      })
    //}
    streamer.startSharing(sourceId, data.roomId)
  }

  function stopSharing() {
    log.info('Stopping sharing, clearing currentViewCode')
    currentViewCode = undefined
    streamer?.stopSharing()
    customDialog.closeTrayDialogs()
  }

  function getAppUrl() {
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      return process.env.ELECTRON_RENDERER_URL

    return import.meta.env.VITE_APP_URL
  }

  function quit() {
    log.info('Initiating app quit')
    app.quit()
  }

  // Error handling
  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error)
  })

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Rejection:', reason)
  })

  ipcMain.handle('dialog', async (_event, options: DialogOptions) => {
    customDialog.openDialog('dialog', options)
  })

  ipcMain.handle('reply-dialog', async (_event, id: number, result: string) => {
    presenterWindow?.webContents.send('reply-dialog', id, result)
  })

  ipcMain.handle('open-screen-source-selection', async () => {
    presenterWindow?.show()
    presenterWindow?.focus()
    presenterWindow?.webContents.send('open-screen-source-selection')
  })

  ipcMain.handle('log', async (_event, messages: any[]) => {
    log.info(...messages)
  })

  ipcMain.handle('logout', async (_event, discardSession: boolean) => {
    logout(discardSession)
  })

  ipcMain.handle('login-via-browser', async (_event, discardSession: boolean) => {
    const url = `${getAppUrl()}?login=${btoa(`target=app&discardSession=${discardSession ? 'true' : 'false'}`)}`
    log.info('Opening browser login:', url)
    log.info('Discarding session:', discardSession)
    shell.openExternal(url)
  })

  ipcMain.handle('login-with-code', async (_event, code: string) => {
    log.info('Logging in with code:', code)
    loginWindow?.close()
    loginWindow = undefined
    store.set('code', code)
    tryPresenting()
  })

  ipcMain.handle('get-screen-sources', async () => {
    log.info('Fetching screen sources')
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] })
    return sources
      .map(({ id, name, thumbnail }) => ({ id, name, thumbnail: thumbnail.toDataURL() }))
      .filter(({ id }) => id !== presenterWindow?.getMediaSourceId())
  })

  ipcMain.handle('source-selected', async (_event, source: string | undefined) => {
    const data = source ? JSON.parse(source) as ScreenSource : undefined
    if (!data) {
      presenterWindow?.close()
      presenterWindow = undefined
      return
    }

    log.info('Source selected:', data)
    presenterWindow?.hide()
  })

  const openShareMessage = async () => {
    log.info('Opening share message, currentViewCode:', currentViewCode)
    if (!currentViewCode) {
      log.warn('No currentViewCode available')
      return
    }

    const url = `${import.meta.env.VITE_APP_URL}?view=${currentViewCode}`
    
    // Load and process template
    const templatePath = resolvePath('/static/templates/sharing-active.html')

    let htmlContent = (await fs.promises.readFile(templatePath, 'utf8'))
      .replace('{{message}}', i18n.t('sharingActive.message'))
      .replaceAll('{{url}}', url)

    
    customDialog.openTrayDialog(import.meta.env.VITE_APP_URL, {
      title: i18n.t('sharingActive.title'),
      detail: htmlContent,
      timeout: 30000
    })
  }

  ipcMain.handle('sharing-active', async (_event, viewCode: string, data: string) => {
    const streamerData = JSON.parse(data) as StreamerData
    log.info('sharing-active handler called with source: ', streamerData.source.id, viewCode)
    
    if (viewCode !== null) {
      currentViewCode = viewCode
      startRemoteControl(streamerData)
    
      customDialog.playSoundOnOpen('ping')
      await openShareMessage()
    }
  })

  ipcMain.handle('show-sharing-active', async (_event) => {
    log.info('show-sharing-active handler called with currentViewCode:', currentViewCode)
    await openShareMessage()
  })

  ipcMain.handle('stop-sharing', async (_event) => {
    stopSharing()
    console.log('stop-sharing handler called')
    presenterWindow?.close()
    presenterWindow = undefined
  })

  ipcMain.handle('pause-sharing', async (_event) => {
    streamer?.pauseStreaming()
    presenterWindow?.webContents.send('on-pause-sharing')
  })

  ipcMain.handle('resume-sharing', async (_event) => {
    streamer?.resumeStreamingIfPaused()
    presenterWindow?.webContents.send('on-resume-sharing')
  })

  ipcMain.handle('update-users', async (_event, newUsers: string) => {
    users = JSON.parse(newUsers) as UserData[]
    streamer?.remotePresenter?.updateUsers(users)
  })

  ipcMain.handle('on-remote', async <T extends RemoteEvent>(_event, event: T, data: RemoteData<T>) => {
    streamer?.remotePresenter?.onRemote(event, data)
  })

  ipcMain.handle('set-toolbar-size', async (_event, width: number, height: number) => {
    streamer?.remotePresenter?.setToolbarSize(width, height)
  })

  ipcMain.handle('toggle-clipboard', async (_event, toggle?: boolean) => {
    streamer?.remotePresenter?.toggleClipboard(toggle)
  })

  ipcMain.handle('toggle-mouse', async (_event, toggle?: boolean) => {
    streamer?.remotePresenter?.toggleMouse(toggle)
  })
  
  ipcMain.handle('toggle-remote-control', async (_event, toggle?: boolean) => {
    streamer?.remotePresenter?.toggleRemoteControl(toggle)
  })

  ipcMain.handle('resize-window', async (_event, windowName: string, dimensions: ElectronWindowDimensions) => {
    streamer?.remotePresenter?.resizeWindow(windowName, dimensions)
  })

  // Create a helper function to create resized template menu icons
  const createMenuIcon = (iconPath: string): Electron.NativeImage => {
    const icon = nativeImage.createFromPath(path.join(__dirname, iconPath))
      .resize({ width: 16, height: 16 })
    
    // Get bitmap data
    const bitmap = icon.getBitmap()
    
    // Invert colors (each pixel has 4 values: R,G,B,A)
    for (let i = 0; i < bitmap.length; i += 4) {
      bitmap[i] = 255 - bitmap[i]     // R
      bitmap[i + 1] = 255 - bitmap[i + 1] // G
      bitmap[i + 2] = 255 - bitmap[i + 2] // B
      // Leave alpha channel (i + 3) unchanged
    }
    
    // Create new image from inverted bitmap
    const invertedIcon = nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 })
    invertedIcon.setTemplateImage(true)
    return invertedIcon
  }
})()
