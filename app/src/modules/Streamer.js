import path from 'path'
import { dialog, screen, BrowserWindow } from 'electron'

import { io } from 'socket.io-client'
import { WindowManager } from './WindowManager.js'
import { RemoteControl } from './RemoteControl.js'
import { CustomDialog } from './CustomDialog.js'

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// var socket = require('socket.io-client')('http://meetdev.meetzi.de:5901');
let socket = null

// Intervals
const windowcheckinterval = (isMac || isLinux) ? 1000 : 100
let resetinterval = null

export class Streamer {
  constructor(hostname) {
    this.customDialog = new CustomDialog()
    this.windowManager = new WindowManager()
    this.remoteControl = new RemoteControl('')
    this.hwnd = null

    this.streamerOverlay = null
    this.hostname = hostname

    this.args = {
      hwnd: null,
      hostname: null,
      roomname: null,
      school: null,
      username: null,
      userid: null,
    }

    // this.fullframeinterval = null;
    this.fullframeinterval = null
    this.checkwindowinterval = null
    this.roomsession = null

    this.streamingpaused = false

    this.streamingactive = null
    this.imgBufferLast = null
    this.diffBufferLast = null
    this.resizeBufferLast = null
    this.windowlist = null
    this.joined = false

    this.lastmousePosX = 0
    this.lastmousePosY = 0

    this.lastcheck = {
      lastframetime: null,
      calcdimensions: null,
      calcrect: null,
      returnrect: null,
      returnfullframe: null,
    }

    this.lastrect = { left: 0, top: 0, width: 100, height: 100 }
    this.imagedimensions = null
  }

  setRoomSession(roomsession) {
    this.roomsession = roomsession
    if (!this.joined) {
      socket = io(`https://${this.hostname}/`)
      socket.emit('join-message', this.roomsession)
      this.joined = true
    }
  }

  setHostname(hostname) {
    this.hostname = hostname
  }

  setArgs(hwnd, windowtitle, hostname, roomname, school, username, userid) {
    // Extract just the number if hwnd is in 'window:number:0' format
    this.hwnd = String(hwnd).includes(':') 
      ? String(hwnd).split(':')[1]
      : hwnd
      
    this.args = { hwnd: this.hwnd, hostname: hostname, roomname: roomname, school: school, username: username, userid: userid }
  }

  async startSharing() {
    const hwnd = `${this.args.hwnd}`
    const windowtitle = this.args.windowtitle

    console.log(`hwndstreamer:${hwnd}`)

    
    /* const { desktopCapturer } = require('electron')
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then(async (sources) => {
      for (const source of sources) {
        if ((!isMac || source.id.split(':')[0] == 'screen') && source.id.split(':')[1] === hwnd)
          this.showStreamerOverlay(source.id)
        if (isMac && source.name.replace(/[^a-zA-Z0-9]/g, '').startsWith(windowtitle.replace(/[^a-zA-Z0-9]/g, '')))
          this.showStreamerOverlay(source.id)
      }
    }) */

    if (this.windowlist == null)
      this.windowlist = await this.windowManager.getWindowList()


    console.log(this.args)
    console.log(this.hwnd)
    console.log(this.windowlist)

    if (this.windowlist.includes(hwnd) || hwnd == 0) {
      console.log(`${hwnd} in windowlsit`)

      this.showStreamerOverlay(hwnd)

      this.windowManager.selectAndActivateWindow(hwnd)
      // windowManager = this.windowManager
      this.startStreaming()
      this.remoteControl.registerEventListener(socket, this.windowManager)

      const self = this
      self.windowManager.checkWindowSizeAndReposition()

      if (this.checkwindowinterval == null) {
        this.checkwindowinterval = setInterval(() => {
          // pause streaming, if window is minimized
          if (self.windowManager.isMinimized()) {
            console.log('window is minimized')
            self.pauseStreaming()
          }
          else {
            // pause streaming, if window change position or size
            if (self.windowManager.checkWindowSizeAndReposition()) {
              console.log('window was resized')
              self.pauseStreaming()
              // resume streaming, if window is back to normal state
            }
            else {
              // console.log('window is back');
              self.resumeStreamingIfPaused()
            }
          }

          if (!self.windowManager.isVisible()) {
            console.log('window is not visible')
            self.stopSharing()
          }
        }, windowcheckinterval)
      }
    }
    else {
      dialog.showErrorBox('Fenster nicht gefunden', `${hwnd} existiert nicht`)
    }
  }

  stopSharing() {
    if (this.joined) {
      socket.disconnect()
      socket.close()
    }

    if (resetinterval != null) {
      clearInterval(resetinterval)
      resetinterval = null
    }

    if (this.checkwindowinterval != null) {
      clearInterval(this.checkwindowinterval)
      this.checkwindowinterval = null
    }

    // this.closeStreamerOverlay()
    console.log('stop sharing!!')
    this.customDialog.closeShareDialogs()
    this.windowManager.hideRecordOverlay()
    this.remoteControl.hideRemoteControl()
    this.remoteControl.deactivate()
    if (this.streamingactive != null)
      this.streamingactive = null
  }

  /*
  toggleRemoteControl() {
    this.remoteControl.toggleRemoteControl()
  }

  toggleMouse() {
    this.remoteControl.toggleMouse()
  } */

  pauseStreaming() {
    if (!this.streamingpaused) {
      this.streamingpaused = true

      console.log('pause')
      this.windowManager.hideRecordOverlay()
      this.remoteControl.hideRemoteControl()
      if (this.streamingactive != null)
        this.streamingactive = null
    }
  }

  resumeStreamingIfPaused() {
    if (this.streamingpaused) {
      this.streamingpaused = false
      console.log('resume')
      this.startStreaming()
    }
  }

  startStreaming() {
    if (this.streamingactive == null) {
      const self = this
      const obj = {}
      obj.room = self.roomsession
      obj.scalefactor = self.windowManager.getScaleFactor()
      obj.iscreen = self.windowManager.isScreen()
      obj.remotecontrol = self.remoteControl.remotecontrolinputenabled
      obj.mouseenabled = self.remoteControl.mouseenabled
      obj.dimensions = self.windowManager.getWindowOuterDimensions()
      console.log(JSON.stringify(obj))
      socket.emit('reset', JSON.stringify(obj))

      if (resetinterval != null) {
        clearInterval(resetinterval)
        resetinterval = null
      }

      resetinterval = setInterval(() => {
        const obj = {}
        obj.room = self.roomsession
        obj.scalefactor = self.windowManager.getScaleFactor()
        obj.iscreen = self.windowManager.isScreen()
        obj.remotecontrol = self.remoteControl.remotecontrolinputenabled
        obj.mouseenabled = self.remoteControl.mouseenabled
        obj.dimensions = self.windowManager.getWindowOuterDimensions()
        socket.emit('reset', JSON.stringify(obj))
      }, 2000)

      this.streamingactive = 1

      this.windowManager.selectWindow(this.hwnd)
      this.windowManager.showRecordOverlay()
      this.remoteControl.activate(this.hwnd)
    }
  }

  sendScaleFactor() {
    const obj = {}
    obj.room = this.roomsession
    obj.scalefactor = this.windowManager.getScaleFactor()
    // socket.sendBuffer = [];
    socket.volatile.emit('host-info', JSON.stringify(obj))
  }

  /* closeStreamerOverlay() {
    //customDialog.closeShareDialogs()

    if (this.streamerOverlay != null) {
      this.streamerOverlay.close()
      this.streamerOverlay = null
    }
  } */

  showStreamerOverlay(hwnd) {
    this.customDialog.playSoundOnOpen('ping.wav')
    this.customDialog.openTrayDialog(this.hostname, {
      detail: (hwnd !== 0 ? 'Sie haben ein Fenster mit meetzi geteilt. Andere Teilnehmer können das Fenster sehen/bearbeiten.' : 'Sie haben Ihren Bildschirm mit meetzi geteilt. Andere Teilnehmer können den Bildschirminhalt sehen/bearbeiten.'),
    })
    this.customDialog.openShareDialog(this.hostname, {})

    /*
    if (this.streamerOverlay == null) {

      let y = 0
      if (process.platform === 'linux')
        y = screen.getPrimaryDisplay().workArea.y
      if (process.platform === 'win32')
        y = screen.getPrimaryDisplay().workAreaSize.height - (sourceid.split(':')[0] == 'window' ? 32 : 232)
      if (process.platform === 'darwin')
        y = 0

      this.streamerOverlay = new BrowserWindow({
        x: screen.getPrimaryDisplay().workAreaSize.width - 302,
        y,
        width: 302,
        height: sourceid.split(':')[0] == 'window' ? 32 : 232,
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        roundedCorners: false,
        // type: "toolbar",
        title: '__meetzi - WindowCaptureClose',
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          additionalArguments: [
            sourceid.replaceAll(':', '_'),
            this.args.hostname,
            this.roomsession,
          ],
          preload: path.join(__static, '/windowoverlaybutton.js'),
        },
      })

      // this.streamerOverlay.webContents.openDevTools();

      // this.streamerOverlay.removeMenu();
      // this.overlayrecord.setAlwaysOnTop(true, 'screen-saver');
      this.streamerOverlay.loadFile(
        path.join(__static, '/windowoverlaybutton.html'),
      )

      this.streamerOverlay.on('closed', () => {
        this.streamerOverlay = null
        this.closeStreamerOverlay()
      })
    } */
  }
}
