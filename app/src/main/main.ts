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
  nativeTheme,
  MenuItemConstructorOptions
} from 'electron'
import { autoUpdater } from "electron-updater"
import { is } from '@electron-toolkit/utils'
import { createMenuIcon, invertIcon } from './util'
import { displayNameMail, uuidv4 } from '../util'
import log from 'electron-log/main'
import { exec } from 'child_process'

// Hide dock icon on macOS
if (process.platform === 'darwin') {
  app.dock.hide()
}

const windowDevtools = {
  notifier: false,
  login: false,
  viewer: false,
  presenter: false,
}

import { useCustomDialog } from './composables/useCustomDialog'
import { useRemotePresenter, type RemotePresenter } from './composables/useRemotePresenter'

import { DialogOptions, ElectronWindowDimensions, RemoteData, RemoteEvent, ScreenSource, StreamerData, UserData, ContactData, NotificationPayload } from '../interface.js'
import { StorageSchema } from '../store'
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
  const notificationIcon = nativeImage.createFromPath(path.join(__dirname, PeekaViewLogo)).resize({ width: 64, height: 64 })

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

  app.setLoginItemSettings({
    openAtLogin: true, // auto-start on login
  })

  let notifierWindow: BrowserWindow | undefined
  let loginWindow: BrowserWindow | undefined
  let viewerWindow: BrowserWindow | undefined
  let presenterWindow: BrowserWindow | undefined

  let tray: Tray

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
      if (nativeTheme.shouldUseDarkColors) {
        tray.setImage(invertIcon(trayIcon))
      }
      nativeTheme.on('updated', () => {
        tray.setImage(nativeTheme.shouldUseDarkColors ? invertIcon(trayIcon) : trayIcon)
      })
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

    store.onDidChange('recentContacts', () => {
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
    new Notification({ title: 'PeekaView', body: i18n.t('trayMenu.running'), icon: notificationIcon }).show()

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
              handleProtocol(text)
            } catch (e) {
              console.error('Clipboard content does not seem to be a valid PeekaView URL')
            }
          },
        },
        {
          label: '[Dev] Clear store', type: 'normal', click: () => store.clear(),
        },
        {
          label: '[Dev] ID: ' + store.get('uuid'), type: 'normal', enabled: false
        },
        { type: 'separator' }
      )

      const code = store.get('code')
      const recentContacts = store.get('recentContacts')

      if (recentContacts && Object.keys(recentContacts).length > 0) {
        menuItems.push({ icon: createMenuIcon(AccountGroupIcon), label: i18n.t('trayMenu.recentContacts') + ':', type: 'normal', enabled: false })
        
        for (const id in recentContacts) {
          const submenu: Array<MenuItemConstructorOptions> = [
            { icon: createMenuIcon(PresentIcon), label: i18n.t('trayMenu.shareMyScreen'), type: 'normal', click: () => tryPresenting(recentContacts[id]) },
            { icon: createMenuIcon(RequestIcon), label: i18n.t('trayMenu.requestScreenShare'), type: 'normal', click: () => createViewerWindow(undefined, recentContacts[id]) },
            { icon: createMenuIcon(TrashCanIcon), label: i18n.t('trayMenu.deleteContact'), type: 'normal', click: () => {
              delete recentContacts[id]
              store.set('recentContacts', recentContacts)
            } },
          ]

          if (!app.isPackaged) {
            submenu.push(
              { type: 'separator' },
              { label: '[Dev] ID: ' + id, type: 'normal', enabled: false }
            )
          }
          menuItems.push({ label: displayNameMail(recentContacts[id]), type: 'submenu', submenu })
        }
        menuItems.push({ type: 'separator' })
      }
      
      menuItems.push(
        { icon: createMenuIcon(PresentIcon), label: i18n.t('trayMenu.shareMyScreen'), type: 'normal', click: () => tryPresenting() },
        { icon: createMenuIcon(RequestIcon), label: i18n.t('trayMenu.requestScreenShare'), type: 'normal', click: () => createViewerWindow() },
        { type: 'separator' },
        { icon: createMenuIcon(LogoutIcon), label: i18n.t('trayMenu.logout'), type: 'normal', click: () => logout(), enabled: !!code },
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
    if (windowDevtools.notifier && !app.isPackaged)
      notifierWindow.webContents.openDevTools()

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
    if (windowDevtools.presenter && !app.isPackaged)
      presenterWindow.webContents.openDevTools()

    return new Promise((resolve) => {
      presenterWindow!.on('ready-to-show', () => {
        presenterWindow!.webContents.send('change-language', i18n.resolvedLanguage)
        resolve(true)
      })
    })
  }

  const createViewerWindow = (viewEmail?: string, contactToNotify?: ContactData) => {
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

    const params: Record<string, string> = {}
    const code = store.get('code')
    if (code)
      params.data = code
    if (viewEmail)
      params.viewEmail = viewEmail

    windowLoad(viewerWindow, 'viewer', params)
    if (windowDevtools.viewer && !app.isPackaged)
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
    if (windowDevtools.login && !app.isPackaged)
      loginWindow.webContents.openDevTools()

    loginWindow.on('ready-to-show', () => {
      loginWindow!.webContents.send('change-language', i18n.resolvedLanguage)
    })

    loginWindow.on('close', () => {
      loginWindow = undefined
    })
  }

  function handleProtocol(urlString: string) {
    log.info("Processing protocol URL", urlString)
    
    const url = new URL(urlString)
    const code = url.searchParams.get('code') ?? undefined
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
    store.delete('name')
    store.set('recentContacts', {})
    store.set('inviteCodeCache', {})

    createLoginWindow(discardSession)
  }

  function openInviteMessage(inviteCode: string | undefined) {
    if (!inviteCode) {
      log.warn('Cannot open invite message, no inviteCode available')
      return
    }

    log.info('Opening invite message, inviteCode:', inviteCode)
    customDialog.openTrayDialog({
      title: i18n.t('sharingActive.title'),
      messages: [{
        content: i18n.t('sharingActive.linkMessage'),
        copyText: new URL(`${import.meta.env.VITE_APP_URL}/${inviteCode}`).toString(),
      }, {
        content: i18n.t('sharingActive.codeMessage'),
        copyText: inviteCode,
      }],
      timeout: 15000
    })
  }

  async function startPresenting(data: StreamerData) {
    if (!data.source) {
      log.error('Invalid sourceId or name for presenting')
      return
    }
    let sourceId = data.source.id

    if (remotePresenter === undefined) {
      remotePresenter = useRemotePresenter((event, data) => presenterWindow?.webContents.send('send-remote', event, data), users, (hidden) => {
        presenterWindow?.webContents.send('on-hidden', hidden)
      })
      remotePresenter.start(sourceId)
    } else {
      remotePresenter.useSource(sourceId)
    }
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

  ipcMain.handle('open-all-dev-tools', async (_event) => {
    if (app.isPackaged)
      return

    presenterWindow?.show()
    presenterWindow?.webContents.openDevTools()
    loginWindow?.webContents.openDevTools()
    viewerWindow?.webContents.openDevTools()
    notifierWindow?.webContents.openDevTools()

    remotePresenter?.openAllDevTools()
  })

  ipcMain.handle('login-via-browser', async (_event, discardSession: boolean) => {
    const url = `${getAppUrl()}?login=&target=app&discardSession=${discardSession ? 'true' : 'false'}`
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
  
      if (!windowDevtools.presenter || app.isPackaged)
        presenterWindow?.hide()
    }

    currentSource = data
  })

  let currentInviteCode: string | undefined
  ipcMain.handle('sharing-active', async (_event, inviteCode: string, data: string) => {
    const streamerData = JSON.parse(data) as StreamerData
    log.info('sharing-active handler called with source: ', streamerData.source.id, inviteCode)
    
    //if (inviteCode !== null) {
      currentInviteCode = inviteCode
      startPresenting(streamerData)
    
      customDialog.playSoundOnOpen('ping')
      openInviteMessage(inviteCode)
    //}
  })

  ipcMain.handle('show-sharing-active', () => {
    openInviteMessage(currentInviteCode)
  })

  ipcMain.handle('stop-sharing', async (_event) => {
    console.log('stop-sharing handler called')
    currentInviteCode = undefined
    remotePresenter?.stop()
    remotePresenter = undefined
    customDialog.closeTrayDialogs()
    
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
    console.log('toggle-remote-control', toggle)
    presenterWindow?.webContents.send('on-toggle-remote-control', toggle)
    remotePresenter?.toggleRemoteControl(toggle)
    remotePresenter?.sendReset()
  })

  ipcMain.handle('resize-window', async (_event, windowName: string, dimensions: ElectronWindowDimensions) => {
    remotePresenter?.resizeWindow(windowName, dimensions)
  })

  ipcMain.handle('get-stored-item', async <K extends keyof StorageSchema>(_event, key: K, defaultValue?: StorageSchema[K]) => {
    return store.get(key) ?? defaultValue
  })

  ipcMain.handle('set-stored-item', async <K extends keyof StorageSchema>(_event, key: K, value: StorageSchema[K]) => {
    store.set(key, value)
  })

  ipcMain.handle('remove-stored-item', async <K extends keyof StorageSchema>(_event, key: K) => {
    store.delete(key)
  })

  ipcMain.handle('clear-store', async () => {
    store.clear()
  })

  ipcMain.handle('receive-notification', async (_event, payload: NotificationPayload) => {
    console.log('receive-notification', payload)
    const notification = new Notification({ title: payload.title, body: payload.message, icon: notificationIcon })
    notification.on('click', () => {
      switch (payload.data?.type) {
        case 'share':
          tryPresenting()
          break
        case 'view':
          createViewerWindow(payload.data?.email)
          break
      }
    })
    notification.show()
  })
})()