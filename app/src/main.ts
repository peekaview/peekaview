import path from 'path'
import url from 'url'
import { app, BrowserWindow, clipboard, ipcMain, desktopCapturer, Menu, nativeImage, net, protocol, Tray, session, shell } from "electron"
import { exec } from 'child_process'
import { updateElectronApp } from 'update-electron-app'

import PeekaViewLogo from './assets/img/peekaview.png'

declare const APP_WEBPACK_ENTRY: string
declare const APP_PRELOAD_WEBPACK_ENTRY: string

declare const SOURCES_WEBPACK_ENTRY: string
declare const SOURCES_PRELOAD_WEBPACK_ENTRY: string

declare const APP_URL: string
declare const CSP_POLICY: string

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit()
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('An instance of the app is already running, quitting...')
  app.quit()
} else {
  updateElectronApp()

  if (!app.isDefaultProtocolClient('peekaview')) {
    const success = app.setAsDefaultProtocolClient('peekaview')
    if (!success) {
      console.error('Failed to set peekaview protocol')
    }
  }
  // allow superhigh cpu usage for faster video-encoding
  app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '1000')
}

let appWindow: BrowserWindow
let sourcesWindow: BrowserWindow

let isQuitting = false

let email: string | undefined
let token: string | undefined

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (process.platform === 'linux')
    exec(`xdg-mime default peekaview.desktop x-scheme-handler/peekaview`)
  
  const trayIconPath = path.join(__dirname, PeekaViewLogo)
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  
  const tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([ // TODO: localize
    { label: '[Dev] Open PeekaView URL', type: 'normal', click: () => {
        try {
          const text = clipboard.readText()
          new URL(text) // test if it's a valid URL
          handleProtocol(text)
        } catch (e) {
          console.error('Clipboard content does not seem to be a valid PeekaView URL')
        }
      },
    },
    { label: 'Meinen Bildschirm teilen', type: 'normal', click: () => tryShareScreen() },
    { label: 'Bildschirm-Anfrage stellen', type: 'normal', click: () => viewScreen() },
    { label: 'Beenden', type: 'normal', click: () => quit() },
  ])
  tray.setToolTip('PeekaView')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    // appWindow.show()
  })

  tray.on('double-click', () => {
    tryShareScreen()
  })

  protocol.handle('peekaview', request => handleProtocol(request.url) ?? new Response())

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
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow(true)
    }
  })

  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('second-instance', event, commandLine, workingDirectory)
    if (appWindow) {
      if (appWindow.isMinimized()) appWindow.restore()
        appWindow.focus()
    }
  })
})

const createAppWindow = (show = false) => {
  appWindow = new BrowserWindow({
    title: 'PeekaView',
    icon: path.join(__dirname, PeekaViewLogo),
    show,
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      //webSecurity: false, // Make sure this is off only for development, adjust for production.
      //allowRunningInsecureContent: true,
      preload: APP_PRELOAD_WEBPACK_ENTRY,
    }
  })

  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  appWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      appWindow.hide()
    }
  })

  appWindow.loadURL(APP_WEBPACK_ENTRY)

  // Open the DevTools.
  !app.isPackaged && appWindow.webContents.openDevTools()
}

function handleProtocol(protocolUrl: string) {
  const protocolPath = protocolUrl.slice('peekaview://'.length)
  const params = new URLSearchParams(protocolPath)
  email = params.get('email') ?? undefined
  token = params.get('token') ?? undefined
  tryShareScreen()
  return undefined
}

function tryShareScreen() {
  if (email && token) {
    appWindow.loadURL(APP_WEBPACK_ENTRY + '?' + (new URLSearchParams({ action: 'share', email, token }).toString()))
    appWindow.show()
  } else {
    shell.openExternal(`${APP_URL}?action=login`)
  }
}

function viewScreen() {
  appWindow.loadURL(APP_WEBPACK_ENTRY + '?' + (new URLSearchParams({ action: 'view' }).toString()))
  appWindow.show()
}

function quit() {
  isQuitting = true
  app.quit()
}

// Handle graceful shutdown
ipcMain.handle('handle-app-closing', async () => {
  console.log('Handling app closing');
  // Perform any necessary cleanup here
  isQuitting = true
  app.quit()

  // Force quit after a timeout if app.quit() doesn't work
  setTimeout(() => {
    console.log('Force quitting...');
    app.exit(0);
  }, 1000);

  return true;
});

ipcMain.handle('open-screen-source-selection', async () => {
  if (sourcesWindow)
    return

  // Create the browser window.
  sourcesWindow = new BrowserWindow({
    width: 800,
    height: 450,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: SOURCES_PRELOAD_WEBPACK_ENTRY,
    }
  })

  sourcesWindow.loadURL(SOURCES_WEBPACK_ENTRY)
})

ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] })
  return sources.map(({ id, name, thumbnail }) => ({ id, name, thumbnail: thumbnail.toDataURL() }))
})

ipcMain.handle('select-screen-source-id', async (_event, id: string) => {
  sourcesWindow.close()
  appWindow.webContents.send('send-screen-source-id', id)
})