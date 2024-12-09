import { dialog } from 'electron'

import { io, type Socket } from 'socket.io-client'
import { WindowManager } from './WindowManager.js'
import { RemoteControl } from './RemoteControl.js'
import { useCustomDialog } from '../composables/useCustomDialog'

//const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// var socket = require('socket.io-client')('http://meetdev.meetzi.de:5901');
let socket: Socket | null = null

// Intervals
const windowcheckinterval = (isMac || isLinux) ? 1000 : 100
let resetinterval: NodeJS.Timeout | null = null

export class Streamer {
  customDialog: ReturnType<typeof useCustomDialog>
  windowManager: typeof WindowManager
  remoteControl: typeof RemoteControl
  hwnd: string | null
  streamerOverlay: null
  lastState: {
    mouseenabled: boolean
    remotecontrolinputenabled: boolean
  } | null
  fullframeinterval: NodeJS.Timeout | null
  checkwindowinterval: NodeJS.Timeout | null
  roomsession: null
  streamingpaused: boolean
  streamingactive: boolean
  imgBufferLast: null
  diffBufferLast: null
  resizeBufferLast: null
  windowlist: string[] | null
  joined: boolean
  lastmousePosX: number
  lastmousePosY: number
  hostname: string | null
  imagedimensions: null
  args: {
    hwnd: string | null
    hostname: string | null
    roomid: string | null
    roomname: string | null
    username: string | null
    userid: string | null
    color: string | null
  }
  lastcheck: {
    lastframetime: string | null
    calcdimensions: string | null
    calcrect: string | null
    returnrect: string | null
    returnfullframe: string | null
  }
  lastrect: {
    left: number
    top: number
    width: number
    height: number
  }

  constructor() {
    this.customDialog = useCustomDialog()
    this.windowManager = new WindowManager()
    this.remoteControl = new RemoteControl('')
    this.hwnd = null
    this.hostname = null

    this.streamerOverlay = null

    this.args = {
      hwnd: null,
      hostname: null,
      roomid: null,
      roomname: null,
      username: null,
      userid: null,
      color: null,
    }

    this.lastState = null

    // this.fullframeinterval = null;
    this.fullframeinterval = null
    this.checkwindowinterval = null
    this.roomsession = null

    this.streamingpaused = false

    this.streamingactive = false
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

  joinRoom() {
    if (!this.joined) {
      socket = io(`${this.hostname}`)
      socket.emit('join', { roomId: this.roomsession, isPresenter: false })


      console.log('joined room:', this.roomsession)
      this.joined = true
    }
  }

  setHostname(hostname) {
    this.hostname = hostname
  }

  setArgs(hwnd, hostname, roomname, roomid, username, userid) {
    // Extract just the number if hwnd is in 'window:number:0' format
    this.hwnd = String(hwnd).includes(':') 
      ? String(hwnd).split(':')[1]
      : hwnd
      
    this.roomsession = roomid
    this.hostname = hostname

    // Generate a color from username if not provided
    let color = this.generateColorFromUsername(username)
    
    this.args = { hwnd: this.hwnd, hostname: hostname, roomname: roomname, roomid: roomid, username: username, userid: userid, color: color }
  }

  // Helper method to generate consistent colors from username
  generateColorFromUsername(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Convert to hex color, ensuring good contrast and saturation
    const color = Math.abs(hash).toString(16).substring(0, 6).padEnd(6, 'f');
    return color;
  }

  async startSharing() {
    const hwnd = `${this.args.hwnd}`
    //const windowtitle = this.args.windowtitle

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

    if (this.windowlist?.includes(hwnd) || hwnd == '0') {
      console.log(`${hwnd} in windowlsit`)

      this.showStreamerOverlay()

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
              if (self.windowManager.isVisible()) {
                self.resumeStreamingIfPaused()
              }
            }
          }

          if (!self.windowManager.isVisible()) {
            console.log('window is not visible')
            //self.stopSharing()
            self.pauseStreaming()
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
      socket!.disconnect()
      socket!.close()
    }

    if (resetinterval != null) {
      clearInterval(resetinterval)
      resetinterval = null
    }

    if (this.checkwindowinterval != null) {
      clearInterval(this.checkwindowinterval)
      this.checkwindowinterval = null
    }

    console.log('stop sharing!!')
    this.customDialog.closeShareDialogs()
    this.windowManager.hideRecordOverlay()
    this.remoteControl.hideRemoteControl()
    this.remoteControl.deactivate()
    this.streamingactive = false
  }

  pauseStreaming() {
    if (!this.streamingpaused) {
      this.streamingpaused = true

      if (this.lastState == null) {
        this.lastState = {
          mouseenabled: this.remoteControl.mouseenabled,
          remotecontrolinputenabled: this.remoteControl.remotecontrolinputenabled
        }
        this.remoteControl.mouseenabled = false
        this.remoteControl.remotecontrolinputenabled = false
        this.sendReset()
      }

      console.log('pause')
      this.windowManager.hideRecordOverlay()
      this.remoteControl.hideRemoteControl()
      this.streamingactive = false
    }
  }

  resumeStreamingIfPaused() {
    if (this.streamingpaused) {
      if (this.lastState != null) {
        this.remoteControl.mouseenabled = this.lastState.mouseenabled
        this.remoteControl.remotecontrolinputenabled = this.lastState.remotecontrolinputenabled
        this.lastState = null
      }
      
      this.streamingpaused = false
      console.log('resume')
      this.startStreaming()
    }
  }

  startStreaming() {
    if (!this.streamingactive) {
      console.log("startStreaming")

      this.sendReset()

      this.streamingactive = true

      this.windowManager.selectWindow(this.hwnd)
      this.windowManager.showRecordOverlay()
      //this.windowManager.showDebugOverlay(this.args)
      this.remoteControl.activate(this.hwnd)
    }
  }

  sendReset() {
    const self = this
      const obj = {
        room: self.roomsession,
        scalefactor: self.windowManager.getScaleFactor(),
        iscreen: self.windowManager.isScreen(),
        remotecontrol: self.remoteControl.remotecontrolinputenabled,
        mouseenabled: self.remoteControl.mouseenabled,
        dimensions: self.windowManager.getWindowOuterDimensions(),
      }

      console.log(JSON.stringify(obj))
      socket!.emit('reset', JSON.stringify(obj))

      if (resetinterval != null) {
        clearInterval(resetinterval)
        resetinterval = null
      }

      resetinterval = setInterval(() => {
        const obj = {
          room: self.roomsession,
          scalefactor: self.windowManager.getScaleFactor(),
          iscreen: self.windowManager.isScreen(),
          remotecontrol: self.remoteControl.remotecontrolinputenabled,
          mouseenabled: self.remoteControl.mouseenabled,
          dimensions: self.windowManager.getWindowOuterDimensions(),
        }
        socket!.emit('reset', JSON.stringify(obj))
      }, 2000)
      
  }

  sendScaleFactor() {
    const obj = {
      room: this.roomsession,
      scalefactor: this.windowManager.getScaleFactor(),
    }
    // socket.sendBuffer = [];
    socket!.volatile.emit('host-info', JSON.stringify(obj))
  }

  showStreamerOverlay() {
    //this.customDialog.openShareDialog(this.hostname!, {})
  }
}
