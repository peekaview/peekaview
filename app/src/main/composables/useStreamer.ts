import { dialog } from 'electron'

import { io, type Socket } from 'socket.io-client'
import { WindowManager } from '../modules/WindowManager.js'
import { RemoteControl } from '../modules/RemoteControl.js'
import { useCustomDialog } from './useCustomDialog.js'

//const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// Intervals
const checkWindowIntervalTime = (isMac || isLinux) ? 1000 : 100

export type Streamer = ReturnType<typeof useStreamer>

export function useStreamer() {
  // Dependencies
  const customDialog = useCustomDialog()
  const windowManager = new WindowManager()
  const remoteControl = new RemoteControl('')
  
  // Socket connection
  let socket: Socket | undefined
  
  // Streaming control flags
  let streamingState: 'paused' | 'active' | 'off' = 'off'
  let joined = false
  
  // Intervals
  let checkWindowInterval: NodeJS.Timeout | undefined
  let resetInterval: NodeJS.Timeout | undefined
  
  // Last state for pause/resume
  let pausedState: {
    mouseenabled: boolean;
    remotecontrolinputenabled: boolean;
  } | undefined
  
  // Room arguments
  let args: {
    hwnd: string,
    hostname: string,
    roomid: string,
    roomname: string,
    username: string,
    userid: string,
    color: string,
  } | undefined

  function joinRoom() {
    if (!joined && args !== undefined) {
      socket = io(`${args.hostname}`)
      socket.emit('join', { roomId: args.roomid, isPresenter: false })

      console.log('joined room:', args.roomid)
      joined = true
    }
  }

  function setArgs(hwnd: string, hostname: string, roomname: string, roomid: string, username: string, userid: string) {
    // Extract just the number if hwnd is in 'window:number:0' format
    hwnd = String(hwnd).includes(':') 
      ? String(hwnd).split(':')[1]
      : hwnd

    // Generate a color from username if not provided
    let color = generateColorFromUsername(username)
    
    args = { hwnd, hostname, roomname, roomid, username, userid, color }
  }

  // Helper method to generate consistent colors from username
  function generateColorFromUsername(username: string) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Convert to hex color, ensuring good contrast and saturation
    const color = Math.abs(hash).toString(16).substring(0, 6).padEnd(6, 'f');
    return color;
  }

  async function startSharing() {
    if (args === undefined)
      return

    const hwnd = `${args.hwnd}`
    //const windowtitle = args.windowtitle

    console.log(`hwndstreamer:${hwnd}`)

    /* const { desktopCapturer } = require('electron')
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then(async (sources) => {
      for (const source of sources) {
        if ((!isMac || source.id.split(':')[0] == 'screen') && source.id.split(':')[1] === hwnd)
          showStreamerOverlay(source.id)
        if (isMac && source.name.replace(/[^a-zA-Z0-9]/g, '').startsWith(windowtitle.replace(/[^a-zA-Z0-9]/g, '')))
          showStreamerOverlay(source.id)
      }
    }) */

    const windowList = await windowManager.getWindowList()
    if (windowList.includes(hwnd) || hwnd == '0') {
      console.log(`${hwnd} in windowList`)

      showStreamerOverlay()

      windowManager.selectAndActivateWindow(hwnd)
      startStreaming()
      remoteControl.registerEventListener(socket, windowManager)

      windowManager.checkWindowSizeAndReposition()

      if (checkWindowInterval == undefined) {
        checkWindowInterval = setInterval(() => {
          // pause streaming, if window is minimized
          if (windowManager.isMinimized()) {
            console.log('window is minimized')
            pauseStreaming()
          }
          else {
            // pause streaming, if window change position or size
            if (windowManager.checkWindowSizeAndReposition()) {
              console.log('window was resized')
              pauseStreaming()
              // resume streaming, if window is back to normal state
            }
            else {
              if (windowManager.isVisible()) {
                resumeStreamingIfPaused()
              }
            }
          }

          if (!windowManager.isVisible()) {
            console.log('window is not visible')
            //stopSharing()
            pauseStreaming()
          }
        }, checkWindowIntervalTime)
      }
    }
    else {
      dialog.showErrorBox('Fenster nicht gefunden', `${hwnd} existiert nicht`)
    }
  }

  function stopSharing() {
    if (joined) {
      socket!.disconnect()
      socket!.close()
    }

    if (resetInterval != undefined) {
      clearInterval(resetInterval)
      resetInterval = undefined
    }

    if (checkWindowInterval != undefined) {
      clearInterval(checkWindowInterval)
      checkWindowInterval = undefined
    }

    console.log('stop sharing!!')
    customDialog.closeShareDialogs()
    windowManager.hideRecordOverlay()
    remoteControl.hideRemoteControl()
    remoteControl.deactivate()
    streamingState = 'off'
  }

  function pauseStreaming() {
    if (streamingState !== 'paused') {
      streamingState = 'paused'

      if (pausedState === undefined) {
        pausedState = {
          mouseenabled: remoteControl.mouseenabled,
          remotecontrolinputenabled: remoteControl.remotecontrolinputenabled
        }
        remoteControl.mouseenabled = false
        remoteControl.remotecontrolinputenabled = false
        sendReset()
      }

      console.log('pause')
      windowManager.hideRecordOverlay()
      remoteControl.hideRemoteControl()
    }
  }

  function resumeStreamingIfPaused() {
    if (streamingState === 'paused') {
      if (pausedState !== undefined) {
        remoteControl.mouseenabled = pausedState.mouseenabled
        remoteControl.remotecontrolinputenabled = pausedState.remotecontrolinputenabled
        pausedState = undefined
      }
      
      streamingState = 'active'
      console.log('resume')
      startStreaming()
    }
  }

  function startStreaming() {
    if (args !== undefined && streamingState === 'off') {
      console.log("startStreaming")

      sendReset()

      streamingState = 'active'

      windowManager.selectWindow(args.hwnd)
      windowManager.showRecordOverlay()
      //windowManager.showDebugOverlay(args)
      remoteControl.activate(args.hwnd)
    }
  }

  function sendReset() {
    if (args === undefined)
      return

    const obj = {
      room: args.roomid,
      scalefactor: windowManager.getScaleFactor(),
      iscreen: windowManager.isScreen(),
      remotecontrol: remoteControl.remotecontrolinputenabled,
      mouseenabled: remoteControl.mouseenabled,
      dimensions: windowManager.getWindowOuterDimensions(),
    }

    console.log(JSON.stringify(obj))
    socket!.emit('reset', JSON.stringify(obj))

    if (resetInterval != undefined) {
      clearInterval(resetInterval)
      resetInterval = undefined
    }

    resetInterval = setInterval(() => {
      const obj = {
        room: args!.roomid,
        scalefactor: windowManager.getScaleFactor(),
        iscreen: windowManager.isScreen(),
        remotecontrol: remoteControl.remotecontrolinputenabled,
        mouseenabled: remoteControl.mouseenabled,
        dimensions: windowManager.getWindowOuterDimensions(),
      }
      socket!.emit('reset', JSON.stringify(obj))
    }, 2000)
  }

  function sendScaleFactor() {
    if (args === undefined)
      return

    const obj = {
      room: args.roomid,
      scalefactor: windowManager.getScaleFactor(),
    }
    // socket!.sendBuffer = [];
    socket!.volatile.emit('host-info', JSON.stringify(obj))
  }

  function showStreamerOverlay() {
    //customDialog.openShareDialog(args.hostname, {})
  }

  return {
    remoteControl,

    joinRoom,
    setArgs,
    startSharing,
    stopSharing,
    pauseStreaming,
    resumeStreamingIfPaused,
    sendScaleFactor,
    showStreamerOverlay
  }
}
