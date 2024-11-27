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
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { exec } from 'child_process'
import i18n from 'i18next'
import backend from 'i18next-fs-backend'

import { useCustomDialog, type DialogParams } from './composables/useCustomDialog'

import { Streamer } from './modules/Streamer'
//import { Conference } from './modules/Conference.js'

import PeekaViewLogo from '../assets/img/peekaview.png'
import { ScreenSource } from '../interface.js'

declare const APP_VERSION: string
declare const CSP_POLICY: string

interface StoreSchema {
  code: string | undefined
}

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

  const languages = {
    en: 'English',
    de: 'Deutsch',
  }

  const i18nReady = i18n.use(backend).init({
    backend: {
      loadPath: app.isPackaged
        ? path.join(process.resourcesPath, 'locales/{{lng}}.json')
        : path.join(__dirname, '../../src/locales/{{lng}}.json'),
      addPath: app.isPackaged
        ? path.join(process.resourcesPath, 'locales/{{lng}}.missing.json')
        : path.join(__dirname, '../../src/locales/{{lng}}.missing.json'),
    },
    lng: Intl.DateTimeFormat().resolvedOptions().locale.substring(0, 2),
    fallbackLng: Object.keys(languages)[0],
    preload: Object.keys(languages),
    ns: ['translation'],
  })

  let appWindow: BrowserWindow | undefined
  let loginWindow: BrowserWindow | undefined
  let sourcesWindow: BrowserWindow | undefined

  let tray: Tray

  let selectedScreenSource: ScreenSource | undefined
  let isQuitting = false

  let streamer: Streamer
  const customDialog = useCustomDialog()

  const Store = (await import('electron-store')).default
  const store = new Store<StoreSchema>({
    schema: {
      code: {
        type: 'string',
        default: undefined,
      }
    }
  }) as any
  log.info('Store initialized')

  if (process.platform === 'win32')
    app.setAppUserModelId(app.name)

  app.whenReady().then(() => {
    log.info('App is ready, initializing...')
    
    if (process.platform === 'linux') {
      exec(`xdg-mime default peekaview.desktop x-scheme-handler/peekaview`)
      log.info('Set xdg-mime defaults for Linux')
    }

    const trayIconPath = path.join(__dirname, PeekaViewLogo)
    const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })

    tray = new Tray(trayIcon)

    tray.setToolTip('PeekaView')

    tray.on('click', () => {
      if (process.platform === 'linux')
        tryShareScreen()
    })

    tray.on('double-click', () => {
      tryShareScreen()
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

    createAppWindow()
    log.info('Main window created')

    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        log.info('No windows found, creating new window on activate')
        appWindow?.webContents.send('change-language', i18n.resolvedLanguage)
        createAppWindow(true)
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

      if (appWindow) {
        if (appWindow.isMinimized()) appWindow.restore()
        appWindow.focus()
      }
    })

    log.info("App initialization complete")
    const notificationIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 64, height: 64 })
    new Notification({ title: 'PeekaView', body: "PeekaView is running", icon: notificationIcon }).show()
  })

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
        { label: i18n.t('trayMenu.shareMyScreen'), type: 'normal', click: () => tryShareScreen() },
        { label: i18n.t('trayMenu.requestScreenShare'), type: 'normal', click: () => loadParams({ action: 'view' }) },
        { type: 'separator' },
        { label: i18n.t('trayMenu.logout'), type: 'normal', click: () => logout(), enabled: !!store.get('code') },
        { label: i18n.t('trayMenu.help'), type: 'submenu', submenu: [
          { label: i18n.t('trayMenu.about'), type: 'normal', click: () => showAbout() },
          { label: i18n.t('trayMenu.changeLanguage'), type: 'submenu', submenu: Object.entries(languages).map(([locale, label]) => (
            { label, type: 'normal', click: () => i18n.changeLanguage(locale).then(() => {
              appWindow?.webContents.send('change-language', locale)
              sourcesWindow?.webContents.send('change-language', locale)
              loginWindow?.webContents.send('change-language', locale)
              updateContextMenu()
            })}
          ))},
        ] },
        { label: i18n.t('trayMenu.quit'), type: 'normal', click: () => quit() },
      )
      
      const contextMenu = Menu.buildFromTemplate(menuItems)
      tray.setContextMenu(contextMenu)
    })
  }

  const showAbout = () => {
    dialog.showMessageBox({
      message: `PeekaView v${APP_VERSION}\n\n© Limtec GmbH 2024 - info@limtec.de`,
      title: i18n.t('trayMenu.about'),
    })
  }

  const createAppWindow = (show = false) => {
    log.info('Creating main window', { show })
    appWindow = new BrowserWindow({
      title: 'PeekaView',
      icon: path.join(__dirname, PeekaViewLogo),
      show,
      width: 1280,
      height: 720,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        //webSecurity: false, // Make sure this is off only for development, adjust for production.
        //allowRunningInsecureContent: true,
        preload: path.join(__dirname, '../preload/app.js'),
      }
    })

    appWindow.webContents.setWindowOpenHandler(({ url }) => {
      log.info('External URL requested:', url)
      shell.openExternal(url)
      return { action: 'deny' }
    })

    appWindow.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault()
        appWindow!.hide()
        sourcesWindow?.close()
      }
    })

    windowLoad(appWindow)

    appWindow?.webContents.send('change-language', i18n.resolvedLanguage)
    log.info('Main window loaded')

    !app.isPackaged && appWindow.webContents.openDevTools()
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

  const createSourcesWindow = () => {
    log.info('Opening sources window')
    if (sourcesWindow) {
      log.info('Reusing existing sources window')
      if (sourcesWindow.isMinimized()) sourcesWindow.restore()
      sourcesWindow.focus()
      return
    }

    log.info('Creating new sources window')
    sourcesWindow = new BrowserWindow({
      icon: path.join(__dirname, PeekaViewLogo),
      width: 960,
      height: 540,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/sources.js'),
      }
    })

    sourcesWindow.on('close', (e) => {
      if (selectedScreenSource) {
        appWindow?.webContents.send('send-screen-source', selectedScreenSource)
      } else if (!isQuitting) {
        const response = dialog.showMessageBoxSync({
          message: i18n.t('sourcesWindow.confirmCancel'),
          title: i18n.t('general.areYouSure'),
          buttons: [
            i18n.t('general.yes'),
            i18n.t('general.no'),
          ]
        })

        if (response === 1) {
          e.preventDefault()
          return
        }

        appWindow?.hide()
      }

      sourcesWindow = undefined
    })
    windowLoad(sourcesWindow, 'sources')
    sourcesWindow?.webContents.send('change-language', i18n.resolvedLanguage)
  }

  function handleProtocol(url: string) {
    log.info("Processing protocol URL", url)
    const params = new URL(url).searchParams

    const code = params.get('code') ?? undefined
    store.set('code', code)
    log.info('Auth code stored from protocol')
    loginWindow?.close()
    tryShareScreen()
  }

  function tryShareScreen() {
    const code = store.get('code')
    log.info('Attempting to share screen', { hasAuthCode: !!code })
    if (code)
      loadParams({ share: code })
    else
      createLoginWindow()
  }

  function logout(discardSession = false) {
    log.info('Logging out, discarding session:', discardSession)
    appWindow?.hide()
    store.delete('code')
    createLoginWindow(discardSession)
  }

  function startRemoteControl(hwnd: string, name: string) {
    if (!hwnd || !name) {
      log.error('Invalid hwnd or name for remote control')
      return
    }
    log.info('Starting remote control with hwnd:', hwnd, 'and window name:', name)

    // Todo: replace hard coded roomname, roomid, username, userid with the ones from api
    streamer = new Streamer()
    streamer.setArgs(hwnd, import.meta.env.VITE_CONTROLSERVER, 'roomname', 'roomid', 'username', 'userid' )
    streamer.joinRoom()
    streamer.startSharing()
  }

  function loadParams(params: Record<string, string>) {
    if (!appWindow)
      return

    log.info('Loading app with params:', params)
    windowLoad(appWindow, undefined, params)
    appWindow.show()
  }

  function windowLoad(window: BrowserWindow, entryKey?: string | undefined, params?: Record<string, string>) {
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${entryKey ? entryKey + '/': ''}index.html${params ? '?' + (new URLSearchParams(params).toString()) : ''}`)
    else
      window.loadFile(path.join(__dirname, `../renderer/${entryKey ? entryKey + '/': ''}index.html`), { query: params })
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

  ipcMain.handle('close-app-window', async () => {
    
  })

  // Handle graceful shutdown
  ipcMain.handle('handle-app-closing', async () => {
    if (process.platform === "darwin")
      return false
    
    log.info('Handling app closing request')
    isQuitting = true
    app.quit()

    setTimeout(() => {
      log.warn('Force quitting after timeout')
      app.exit(0)
    }, 1000)

    return true
  })

  // Error handling
  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error)
  })

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Rejection:', reason)
  })

  ipcMain.handle('dialog', async (_event, params: DialogParams) => {
    customDialog.openDialog('dialog', params)
  })

  ipcMain.handle('reply-dialog', async (_event, id: number, result: string) => {
    appWindow?.webContents.send('on-reply-dialog', id, result)
  })

  ipcMain.handle('open-screen-source-selection', async () => {
    createSourcesWindow()
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
    store.set('code', code)
    tryShareScreen()
  })

  ipcMain.handle('get-screen-sources', async () => {
    log.info('Fetching screen sources')
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] })
    return sources.map(({ id, name, thumbnail }) => ({ id, name, thumbnail: thumbnail.toDataURL() }))
  })

  ipcMain.handle('select-screen-source', async (_event, source: ScreenSource | undefined) => {
    log.info('Screen source selected:', source)
    selectedScreenSource = source
    sourcesWindow?.close()
  })

  ipcMain.handle('start-remote-control', async (_event, source: ScreenSource) => {
    startRemoteControl(source.id, source.name) // TODO: handle errors
  })

  ipcMain.handle('toggleRemoteControl', async (_event) => {
    console.log('toggleRemoteControl')
    streamer.remoteControl.toggleRemoteControl()
    streamer.remoteControl.toggleMouse()
  })
  
  ipcMain.handle('toggleMouse', async (_event) => {
    console.log('toggleMouse')
    streamer.remoteControl.toggleMouse()
  })

  ipcMain.handle('stopSharing', async (_event) => {
    console.log('stopSharing')
    quit()
  })
})()
