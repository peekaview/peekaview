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
  shell,
  nativeTheme
} from 'electron'
import { autoUpdater } from "electron-updater"
import { is } from '@electron-toolkit/utils'
import { displayNameMail, uuidv4 } from '../util'
import log from 'electron-log/main'
import { exec } from 'child_process'

// Hide dock icon on macOS
if (process.platform === 'darwin') {
  app.dock.hide()
}

import { useCustomDialog } from './composables/useCustomDialog'
import { useRemotePresenter, type RemotePresenter } from './composables/useRemotePresenter'

import { DialogOptions, ElectronWindowDimensions, RemoteData, RemoteEvent, ScreenSource, StorageSchema, StreamerData, UserData, ContactData } from '../interface.js'
import { resolvePath, windowLoad } from './util'
import { i18n, i18nReady, languages } from './i18n'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'
import PeekaViewIcon from '../assets/img/peekaviewicon_mono3.png'

import AccountGroupIcon from '../assets/img/account-group.png'
import HelpIcon from '../assets/img/help.png'
import InfoIcon from '../assets/img/info.png'
import LanguageIcon from '../assets/img/language.png'
import LogoutIcon from '../assets/img/logout.png'
import PresentIcon from '../assets/img/present.png'
import RequestIcon from '../assets/img/request.png'
import QuitIcon from '../assets/img/quit.png'
import TrashCanIcon from '../assets/img/trash-can.png'
import { getStore } from './store'

import { setup as setupPushReceiver } from 'firebase-electron';

declare const APP_VERSION: string
declare const CSP_POLICY: string

(async () => {
  let isQuitting = false
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    const protocolUrl = process.argv.find(arg => arg.startsWith('peekaview://'))
    if (protocolUrl) {
      log.info('Protocol URL found in command line arguments, emitting second-instance event')
      app.emit('second-instance', null, [protocolUrl], null)
    }
    log.info('Another instance is running, quitting...')
    isQuitting = true
    app.quit()
    return
  }

  log.info('Starting app update check')
  
  // Create notification icon once
  const updateNotificationIcon = nativeImage.createFromPath(path.join(__dirname, PeekaViewLogo)).resize({ width: 64, height: 64 })

  // Configure auto updater events
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info)
    dialog.showMessageBox({
      title: 'PeekaView Update',
      message: i18n.t('update.available', { version: info.version }),
      type: 'info',
      buttons: ['OK']
    })
  })

  autoUpdater.on('update-not-available', () => {
    log.info('No updates available')
  })

  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err)
    dialog.showMessageBox({
      title: 'PeekaView Update Error',
      message: i18n.t('update.error'),
      type: 'error',
      buttons: ['OK']
    })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    log.info('Download progress:', progressObj)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info)
    log.info('Attempting to show update notification for version:', info.version)
    
    dialog.showMessageBox({
      title: 'PeekaView Update Ready',
      message: i18n.t('update.ready', { version: info.version }),
      type: 'info',
      buttons: [i18n.t('update.restart')],
      defaultId: 0,
      noLink: true
    }).then(({ response }) => {
      if (response === 0) {
        log.info('Update dialog action clicked, preparing to quit and install')
        isQuitting = true
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.checkForUpdates()
  
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

  let notifierWindow: BrowserWindow | undefined
  let loginWindow: BrowserWindow | undefined
  let viewerWindow: BrowserWindow | undefined
  let presenterWindow: BrowserWindow | undefined

  let tray: Tray

  let currentViewCode: string | undefined

  let remotePresenter: RemotePresenter | undefined
  const customDialog = useCustomDialog()

  const store = await getStore()
  let users: UserData[] = []

  if (!store.get('uuid')) {
    store.set('uuid', uuidv4())
  }

  if (process.platform === 'win32')
    app.setAppUserModelId(app.name)

  app.whenReady().then(() => {
    log.info('App is ready, initializing...')
    
    // Add notification permission check
    /*if (process.platform === 'darwin') {
      log.info('Checking notification permissions...')
      if (!Notification.isSupported()) {
        log.warn('Notifications are not supported on this system')
      } else {
        log.info('Notifications are supported')
      }
    }*/
    
    if (process.platform === 'linux') {
      exec(`xdg-mime default peekaview.desktop x-scheme-handler/peekaview`)
      log.info('Set xdg-mime defaults for Linux')
    }

    const trayIconPath = path.join(__dirname, PeekaViewIcon)
    const trayIcon: Electron.NativeImage = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
    
    if (process.platform === 'darwin') {
      trayIcon.setTemplateImage(true)
    }

    // Create tray first
    tray = new Tray(trayIcon)

    if (process.platform === 'win32') {
      // For Windows, listen to system theme changes
      nativeTheme.on('updated', () => {
        const isDark = nativeTheme.shouldUseDarkColors
        tray.setImage(isDark ? invertIcon(trayIcon) : trayIcon)
      })
      // Set initial icon based on current theme
      if (nativeTheme.shouldUseDarkColors) {
        tray.setImage(invertIcon(trayIcon))
      }
    }

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
        notifierWindow?.webContents.send('change-language', i18n.resolvedLanguage)
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

    app.on('will-quit', e => {
      if (!isQuitting)
        e.preventDefault()
    })

    log.info("App initialization complete")
    new Notification({ title: 'PeekaView', body: i18n.t('trayMenu.running'), icon: updateNotificationIcon }).show()

    createNotifierWindow()
  })

  const focusApp = () => {
    let currentWindow = loginWindow ?? viewerWindow
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
      )

      const recentContacts = JSON.parse(store.get('recentContacts') ?? '{}') as Record<string, ContactData>
      if (recentContacts && Object.keys(recentContacts).length > 0) {
        const submenu: Array<(Electron.MenuItemConstructorOptions)> = []
        for (const id in recentContacts) {
          submenu.push({ label: displayNameMail(recentContacts[id]), type: 'submenu', submenu: [
            { icon: createMenuIcon(PresentIcon), label: i18n.t('trayMenu.shareMyScreen'), type: 'normal', click: () => tryPresenting(recentContacts[id]) },
            { icon: createMenuIcon(RequestIcon), label: i18n.t('trayMenu.requestScreenShare'), type: 'normal', click: () => createViewerWindow(recentContacts[id]) },
            { icon: createMenuIcon(TrashCanIcon), label: i18n.t('trayMenu.deleteContact'), type: 'normal', click: () => {
              delete recentContacts[id]
              store.set('recentContacts', JSON.stringify(recentContacts))
              updateContextMenu()
            } },
          ] })
        }
        menuItems.push({ icon: createMenuIcon(AccountGroupIcon), label: i18n.t('trayMenu.recentContacts'), type: 'submenu', submenu })
        menuItems.push({ type: 'separator' })
      }

      menuItems.push(
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

  const createNotifierWindow = () => {
    notifierWindow = new BrowserWindow({
      title: 'PeekaView',
      icon: path.join(__dirname, PeekaViewLogo),
      show: true,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      minimizable: false,
      maximizable: false,
      resizable: false,
      focusable: false,
      alwaysOnTop: false,
      transparent: true,
      skipTaskbar: true,
      frame: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        webSecurity: app.isPackaged,
        //allowRunningInsecureContent: true,
        preload: path.join(__dirname, '../preload/notifier.js'),
      }
    })
    
    setupPushReceiver(notifierWindow.webContents);

    windowLoad(notifierWindow, 'notifier')

    notifierWindow.removeMenu()
    notifierWindow.setIgnoreMouseEvents(true)
    //notifierWindow.webContents.openDevTools()

    return new Promise((resolve) => {
      notifierWindow!.on('ready-to-show', () => {
        notifierWindow!.webContents.send('change-language', i18n.resolvedLanguage)
        resolve(true)
      })
    })
  }

  const createPresenterWindow = (code: string) => {
    presenterWindow = new BrowserWindow({
      title: 'PeekaView',
      icon: path.join(__dirname, PeekaViewLogo),
      show: true,
      maxWidth: 1280,
      maxHeight: 720,
      minimizable: false,
      maximizable: false,
      resizable: false,
      focusable: true,
      transparent: true,
      skipTaskbar: true,
      frame: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        webSecurity: app.isPackaged,
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
    //presenterWindow.webContents.openDevTools()

    return new Promise((resolve) => {
      presenterWindow!.on('ready-to-show', () => {
        presenterWindow!.webContents.send('change-language', i18n.resolvedLanguage)
        resolve(true)
      })
    })
  }

  const createViewerWindow = (contactToNotify?: ContactData) => {
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
        webSecurity: app.isPackaged,
        //allowRunningInsecureContent: true,
        preload: path.join(__dirname, '../preload/viewer.js'),
      }
    })

    windowLoad(viewerWindow, 'viewer')
    viewerWindow.webContents.openDevTools()

    return new Promise((resolve) => {
      viewerWindow!.on('ready-to-show', () => {
        viewerWindow!.webContents.send('change-language', i18n.resolvedLanguage)
        if (contactToNotify)
          viewerWindow!.webContents.send('on-notify-contact', contactToNotify)
        resolve(true)
      })
    })
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

    windowLoad(loginWindow, 'login', { discardSession: discardSession ? 'true' : 'false' })
    //loginWindow.webContents.openDevTools()

    loginWindow.on('ready-to-show', () => {
      loginWindow!.webContents.send('change-language', i18n.resolvedLanguage)
    })

    loginWindow.on('close', () => {
      loginWindow = undefined
    })
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

  async function tryPresenting(contactToNotify?: ContactData) {
    const code = store.get('code')
    if (!code) {
      createLoginWindow()
      return
    }

    if (!presenterWindow)
      await createPresenterWindow(code)
    
    presenterWindow?.show()
    presenterWindow?.focus()
    presenterWindow?.webContents.send('open-screen-source-selection')
    if (contactToNotify)
      presenterWindow!.webContents.send('on-notify-contact', contactToNotify)
  }

  function logout(discardSession = false) {
    log.info('Logging out, discarding session:', discardSession)
    presenterWindow?.close()
    presenterWindow = undefined
    store.delete('code')
    createLoginWindow(discardSession)
  }

  async function startPresenting(data: StreamerData) {
    if (!data.source) {
      log.error('Invalid sourceId or name for presenting')
      return
    }
    let sourceId = data.source.id
    
    remotePresenter?.stop()

    if (remotePresenter === undefined)
      remotePresenter = useRemotePresenter((event, data) => presenterWindow?.webContents.send('send-remote', event, data), users, (hidden) => {
        presenterWindow?.webContents.send('on-hidden', hidden)
      })
  
    remotePresenter.start(sourceId)
  }

  function stopSharing() {
    log.info('Stopping sharing, clearing currentViewCode')
    currentViewCode = undefined
    remotePresenter?.stop()
    customDialog.closeTrayDialogs()
  }

  function getAppUrl() {
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      return process.env.ELECTRON_RENDERER_URL

    return import.meta.env.VITE_APP_URL
  }

  function quit() {
    log.info('Initiating app quit')
    isQuitting = true
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
    customDialog.openDialog(options)
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

  ipcMain.handle('get-resources-path', () => {
    return resolvePath('')
  })

  let currentSource: ScreenSource | undefined
  ipcMain.handle('source-selected', async (_event, source: string | undefined) => {
    const data = source ? JSON.parse(source) as ScreenSource : undefined
    if (!data && !currentSource) {
      presenterWindow?.close()
      presenterWindow = undefined
    } else {
      if (data)
        log.info('Source selected:', data.id, data.name)
  
      presenterWindow?.hide()
    }

    currentSource = data
  })

  const openShareMessage = async () => {
    log.info('Opening share message, currentViewCode:', currentViewCode)
    if (!currentViewCode) {
      log.warn('No currentViewCode available')
      return
    }

    customDialog.openTrayDialog({
      title: i18n.t('sharingActive.title'),
      message: i18n.t('sharingActive.message'),
      copyText: `${import.meta.env.VITE_APP_URL}?view=${currentViewCode}`,
      timeout: 30000
    })
  }

  ipcMain.handle('sharing-active', async (_event, viewCode: string, data: string) => {
    const streamerData = JSON.parse(data) as StreamerData
    log.info('sharing-active handler called with source: ', streamerData.source.id, viewCode)
    
    if (viewCode !== null) {
      currentViewCode = viewCode
      startPresenting(streamerData)
    
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
    remotePresenter?.pauseStreaming()
    presenterWindow?.webContents.send('on-pause-sharing')
  })

  ipcMain.handle('resume-sharing', async (_event) => {
    remotePresenter?.resumeStreamingIfPaused()
    presenterWindow?.webContents.send('on-resume-sharing')
  })

  ipcMain.handle('update-users', async (_event, newUsers: string) => {
    users = JSON.parse(newUsers) as UserData[]
    remotePresenter?.updateUsers(users)
  })

  ipcMain.handle('on-remote', async <T extends RemoteEvent>(_event, event: T, data: RemoteData<T>) => {
    remotePresenter?.onRemote(event, data)
  })

  ipcMain.handle('set-toolbar-size', async (_event, width: number, height: number) => {
    remotePresenter?.setToolbarSize(width, height)
  })

  ipcMain.handle('toggle-clipboard', async (_event, toggle?: boolean) => {
    remotePresenter?.toggleClipboard(toggle)
  })

  ipcMain.handle('toggle-pointer', async (_event, toggle?: boolean) => {
    presenterWindow?.webContents.send('on-toggle-pointer', toggle)
    remotePresenter?.togglePointer(toggle)
    remotePresenter?.sendReset()
  })
  
  ipcMain.handle('toggle-remote-control', async (_event, toggle?: boolean) => {
    presenterWindow?.webContents.send('on-toggle-remote-control', toggle)
    remotePresenter?.toggleRemoteControl(toggle)
    remotePresenter?.sendReset()
  })

  ipcMain.handle('resize-window', async (_event, windowName: string, dimensions: ElectronWindowDimensions) => {
    remotePresenter?.resizeWindow(windowName, dimensions)
  })

  ipcMain.handle('get-stored-item', async <K extends keyof StorageSchema>(_event, key: K) => {
    return store.get(key)
  })

  ipcMain.handle('set-stored-item', async <K extends keyof StorageSchema>(_event, key: K, value: StorageSchema[K]) => {
    store.set(key, value)
  })

  ipcMain.handle('remove-stored-item', async <K extends keyof StorageSchema>(_event, key: K) => {
    store.delete(key)
  })

  ipcMain.handle('notify', async (_event, title: string, body: string) => {
    new Notification({ title, body, icon: updateNotificationIcon }).show()
  })

  // Create a helper function to create resized template menu icons
  const createMenuIcon = (iconPath: string): Electron.NativeImage => {
    const icon = nativeImage.createFromPath(path.join(__dirname, iconPath))
    
    if (process.platform === 'darwin') {
      const newIcon = invertIcon(icon)
      newIcon.setTemplateImage(true)
      return newIcon.resize({ width: 16, height: 16 })
    }

    // On Windows, invert for dark theme
    if (process.platform === 'win32' && ! nativeTheme.shouldUseDarkColors) {
      return invertIcon(icon).resize({ 
        width: 16, 
        height: 16,
        quality: 'best'  // Use best quality to preserve transparency
      })
    }

    return icon.resize({ 
      width: 16, 
      height: 16,
      quality: 'best'  // Use best quality to preserve transparency
    })
  }

  function invertIcon(icon: Electron.NativeImage): Electron.NativeImage {
    // Get bitmap data and size
    const size = icon.getSize()
    const bitmap = icon.getBitmap()
    
    // Invert colors (each pixel has 4 values: R,G,B,A)
    for (let i = 0; i < bitmap.length; i += 4) {
      // Only invert if the pixel is not fully transparent
      if (bitmap[i + 3] > 5) {
        bitmap[i] = 255 - bitmap[i]     // R
        bitmap[i + 1] = 255 - bitmap[i + 1] // G
        bitmap[i + 2] = 255 - bitmap[i + 2] // B
      }
      // Leave alpha channel (i + 3) unchanged
    }
    
    // Create new image from inverted bitmap with correct dimensions
    return nativeImage.createFromBitmap(bitmap, size)
  }
})()