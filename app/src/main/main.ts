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
import fs from 'fs'

import { useCustomDialog, type DialogOptions } from './composables/useCustomDialog'
import { useStreamer, type Streamer } from './composables/useStreamer'

//import { WindowManager } from './modules/WindowManager'
//import { Conference } from './modules/Conference.js'
import { RemoteData, RemoteEvent, ScreenSource, StreamerData } from '../interface.js'
import { resolvePath } from './util'
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

  let appWindow: BrowserWindow | undefined
  let loginWindow: BrowserWindow | undefined
  let sourcesWindow: BrowserWindow | undefined
  //let windowManager: WindowManager | undefined

  let tray: Tray

  let selectedScreenSource: ScreenSource | undefined
  let isQuitting = false

  let currentViewCode: string | undefined

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
    const notificationIcon = nativeImage.createFromPath(path.join(__dirname, PeekaViewLogo)).resize({ width: 64, height: 64 })
    new Notification({ title: 'PeekaView', body: "PeekaView is running", icon: notificationIcon }).show()
  })

  const onTrayClick = () => {
    if (sourcesWindow?.isMinimized()) {
      sourcesWindow.restore()
      sourcesWindow.show()
      return
    }

    if (appWindow) {
      if (!app.isPackaged) {
        appWindow.restore()
        appWindow.show()
      }
      return
    }

    tryShareScreen()
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
        { icon: createMenuIcon(PresentIcon), label: i18n.t('trayMenu.shareMyScreen'), type: 'normal', click: () => tryShareScreen() },
        { icon: createMenuIcon(RequestIcon), label: i18n.t('trayMenu.requestScreenShare'), type: 'normal', click: () => loadParams({ action: 'view' }, true) },
        { type: 'separator' },
        { icon: createMenuIcon(LogoutIcon), label: i18n.t('trayMenu.logout'), type: 'normal', click: () => logout(), enabled: !!store.get('code') },
        { icon: createMenuIcon(HelpIcon), label: i18n.t('trayMenu.help'), type: 'submenu', submenu: [
          { icon: createMenuIcon(InfoIcon), label: i18n.t('trayMenu.about'), type: 'normal', click: () => showAbout() },
          { icon: createMenuIcon(LanguageIcon), label: i18n.t('trayMenu.changeLanguage'), type: 'submenu', submenu: Object.entries(languages).map(([locale, label]) => (
            { label, type: 'normal', click: () => i18n.changeLanguage(locale).then(() => {
              appWindow?.webContents.send('change-language', locale)
              sourcesWindow?.webContents.send('change-language', locale)
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
      height: 640,
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
      } else if (!currentViewCode && !isQuitting) {
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
    if (!code) {
      createLoginWindow()
      return
    }

    if (!appWindow)
      return

    const url = appWindow.webContents.getURL()
    const params = new URL(url).searchParams
    const share = params.get('share')
    if (currentViewCode && share === code)
      return

    loadParams({ share: code }, !app.isPackaged)
  }

  function logout(discardSession = false) {
    log.info('Logging out, discarding session:', discardSession)
    appWindow?.hide()
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

    /*if (process.platform === 'darwin') {
      windowManager = new WindowManager()
      sourceId = await windowManager.getHwndForWindowByTitleAndId(data.source.name, sourceId)
    }*/

    //if (currentViewCode)
    //  stopSharing()

    streamer = useStreamer((event, data) => appWindow?.webContents.send('send-remote', event, data))
    streamer.startSharing(sourceId, data.roomId)
  }

  function stopSharing() {
    log.info('Stopping sharing, clearing currentViewCode')
    currentViewCode = undefined
    streamer?.stopSharing()
    customDialog.closeShareDialogs()
    customDialog.closeTrayDialogs()
  }

  function loadParams(params: Record<string, string>, show?: boolean) {
    if (!appWindow)
      return

    log.info('Loading app with params:', params)
    windowLoad(appWindow, undefined, params)
    if (show !== undefined)
      show ? appWindow.show() : appWindow.hide()
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

  ipcMain.handle('dialog', async (_event, options: DialogOptions) => {
    customDialog.openDialog('dialog', options)
  })

  ipcMain.handle('reply-dialog', async (_event, id: number, result: string) => {
    appWindow?.webContents.send('reply-dialog', id, result)
  })

  ipcMain.handle('on-remote', async <T extends RemoteEvent>(_event, event: T, data: RemoteData<T>) => {
    streamer?.onRemote(event, data)
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
    log.info('Screen source selected:', source?.id, source?.name)
    selectedScreenSource = source
    sourcesWindow?.close()
  })

  /*ipcMain.handle('start-remote-control', async (_event, data: StreamerData) => {
    startRemoteControl(data)
  })*/

  

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
    
    
      customDialog.playSoundOnOpen('ping.wav')
      customDialog.openShareDialog(import.meta.env.VITE_APP_URL, {})
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
    appWindow?.hide()
  })

  ipcMain.handle('pause-sharing', async (_event) => {
    streamer.pauseStreaming()
  })

  ipcMain.handle('resume-sharing', async (_event) => {
    customDialog.playSoundOnOpen('ping.wav')
    customDialog.openDialog('dialog', {
      title: 'Sharing resumed',
      detail: "Sharing resumed, other users can now see your shared screen or application",
      timeout: 3000
    })
    streamer.resumeStreamingIfPaused()
  })

  ipcMain.handle('enable-mouse', async (_event) => {
    console.log('Enabling mouse control')
    streamer.remotePresenter.enableMouse()
  })

  ipcMain.handle('disable-mouse', async (_event) => {
    console.log('Disabling mouse control')
    streamer.remotePresenter.disableMouse()
  })

  ipcMain.handle('enable-remote-control', async (_event) => {
    console.log('Enabling remote control')
    streamer.remotePresenter.enableRemoteControl()
  })

  ipcMain.handle('disable-remote-control', async (_event) => {
    console.log('Disabling remote control')
    streamer.remotePresenter.disableRemoteControl()
  })

  ipcMain.handle('quit', async (_event) => {
    quit()
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
