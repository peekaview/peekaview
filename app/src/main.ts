import path from 'path'
import url from 'url'
import { app, BrowserWindow, ipcMain, desktopCapturer, Menu, nativeImage, net, protocol, Tray, session, shell } from "electron"
import { updateElectronApp } from 'update-electron-app'

import PeekaviewLogo from './assets/img/peekaview.png'

declare const APP_WEBPACK_ENTRY: string
declare const APP_PRELOAD_WEBPACK_ENTRY: string

declare const SOURCES_WEBPACK_ENTRY: string
declare const SOURCES_PRELOAD_WEBPACK_ENTRY: string

declare const CSP_POLICY: string

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit()
}

updateElectronApp()

// allow superhigh cpu usage for faster video-encoding
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '1000')

let appWindow: BrowserWindow
let sourcesWindow: BrowserWindow

let isQuitting = false

const createAppWindow = (show = false) => { // (roomName: string, jwtToken: string, serverUrl: string) => {
  appWindow = new BrowserWindow({
    title: 'Peekaview',
    icon: path.join(__dirname, PeekaviewLogo),
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

  appWindow.loadURL(APP_WEBPACK_ENTRY)// + '?' + (new URLSearchParams({ email: roomName, jwt: jwtToken, url: serverUrl }).toString()))

  // Open the DevTools.
  !app.isPackaged && appWindow.webContents.openDevTools()
}

if (!app.isDefaultProtocolClient('peekaview'))
  app.setAsDefaultProtocolClient('peekaview')

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const trayIconPath = path.join(__dirname, PeekaviewLogo)
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  
  const tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Beenden', type: 'normal', click: () => {
      isQuitting = true
      app.quit()
    }},
  ])
  tray.setToolTip('Peekaview')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    appWindow.show()
  })

  protocol.handle('peekaview', (request) => {
    const filePath = request.url.slice('peekaview://'.length)
    console.log(request.url)
    return net.fetch(url.pathToFileURL(path.join(__dirname, filePath)).toString())
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

  createAppWindow(!app.isPackaged)
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow(true)
    }
  })
})

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