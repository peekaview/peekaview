import { dialog } from 'electron'

import { WindowManager } from '../modules/WindowManager.js'
import { useRemotePresenter } from './useRemotePresenter.js'

import type { RemoteData, RemoteEvent, RemoteResetData } from '../../interface.d.ts'

//const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// Intervals
const checkWindowIntervalTime = (isMac || isLinux) ? 1000 : 1000

export type Streamer = ReturnType<typeof useStreamer>

export function useStreamer(sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void) {
  // Dependencies
  const windowManager = new WindowManager()
  const remotePresenter = useRemotePresenter(sendRemote)
  
  // Streaming control flags
  let streamingState: 'hidden' | 'paused' | 'active' | 'stopped' = 'stopped'
  
  // Intervals
  let checkWindowInterval: NodeJS.Timeout | undefined
  let resetInterval: NodeJS.Timeout | undefined
  
  // Last state for pause/resume
  let pausedState: {
    mouseEnabled: boolean;
    remoteControlInputEnabled: boolean;
  } | undefined

  let hwnd: string | undefined
  let roomid: string | undefined

  async function startSharing(sourceId: string, roomId: string) {
    hwnd = sourceId.includes(':') 
      ? sourceId.split(':')[1]
      : hwnd
    roomid = roomId

    console.log(`hwndstreamer:${hwnd}`)

    const windowList = await windowManager.getWindowList()
    if (windowList.includes(hwnd) || hwnd == '0') {
      console.log(`${hwnd} in windowList`)

      windowManager.selectAndActivateWindow(hwnd)
      startStreaming()

      windowManager.checkWindowSizeAndReposition()

      if (checkWindowInterval == undefined) {
        checkWindowInterval = setInterval(() => {
          // pause streaming, if window is minimized
          if (windowManager.isMinimized()) {
            console.log('window is minimized')
            pauseStreaming(true)
          }
          else if (windowManager.checkWindowSizeAndReposition()) {
            console.log('window was resized')
            pauseStreaming(true)
            // resume streaming, if window is back to normal state
          }
          else if (windowManager.isVisible()) {
            resumeStreamingIfPaused(true)
          }

          if (!windowManager.isVisible()) {
            console.log('window is not visible')
            //stopSharing()
            pauseStreaming(true)
          }
        }, checkWindowIntervalTime)
      }
    }
    else {
      dialog.showErrorBox('Fenster nicht gefunden', `${hwnd} existiert nicht`)
    }
  }

  function toggleRemoteControl(toggle?: boolean) {
    remotePresenter.toggleRemoteControl(toggle)
  }

  function toggleMouse(toggle?: boolean) {
    remotePresenter.toggleMouse(toggle)
  }

  function stopSharing() {
    if (resetInterval != undefined) {
      clearInterval(resetInterval)
      resetInterval = undefined
    }

    if (checkWindowInterval != undefined) {
      clearInterval(checkWindowInterval)
      checkWindowInterval = undefined
    }

    console.log('stop sharing!!')
    windowManager.hideRecordOverlay()
    remotePresenter.hideRemoteControl()
    remotePresenter.deactivate()

    streamingState = 'stopped'
  }

  function pauseStreaming(fromHidden = false) {
    if (streamingState === 'paused' || (streamingState === 'hidden' && !fromHidden))
      return

    streamingState = fromHidden ? 'hidden' : 'paused'

    if (pausedState === undefined) {
      pausedState = {
        mouseEnabled: remotePresenter.mouseEnabled,
        remoteControlInputEnabled: remotePresenter.remoteControlInputEnabled
      }
      remotePresenter.mouseEnabled = false
      remotePresenter.remoteControlInputEnabled = false
      sendReset()
    }

    console.log('pause')
    windowManager.hideRecordOverlay()
    remotePresenter.hideRemoteControl()
  }

  function resumeStreamingIfPaused(fromHidden = false) {
    if (streamingState !== 'hidden' && (streamingState !== 'paused' || fromHidden))
      return

    if (pausedState !== undefined) {
      remotePresenter.mouseEnabled = pausedState.mouseEnabled
      remotePresenter.remoteControlInputEnabled = pausedState.remoteControlInputEnabled
      pausedState = undefined
    }
    
    streamingState = 'stopped'
    console.log('resume')
    startStreaming()
  }

  function startStreaming() {
    if (hwnd !== undefined && streamingState === 'stopped') {
      console.log("startStreaming")

      

      streamingState = 'active'

      windowManager.selectWindow(hwnd)
      windowManager.showRecordOverlay()
      //windowManager.showDebugOverlay(args)
      remotePresenter.activate(hwnd)

      sendReset()
    }
  }

  function sendReset() {
    if (roomid === undefined)
      return

    const obj = {
      room: roomid,
      scalefactor: windowManager.getScaleFactor() || 1,
      iscreen: windowManager.isScreen(),
      remotecontrol: remotePresenter.remoteControlInputEnabled,
      mouseenabled: remotePresenter.mouseEnabled,
      dimensions: windowManager.getWindowOuterDimensions(),
    }

    sendRemote('reset', obj)

    if (resetInterval != undefined) {
      clearInterval(resetInterval)
      resetInterval = undefined
    }

    resetInterval = setInterval(() => {
      const message: RemoteResetData = {
        room: roomid!,
        scalefactor: windowManager.getScaleFactor(),
        iscreen: windowManager.isScreen(),
        remotecontrol: remotePresenter.remoteControlInputEnabled,
        mouseenabled: remotePresenter.mouseEnabled,
        dimensions: windowManager.getWindowOuterDimensions(),
      }

      console.log('sendReset', message)

      sendRemote('reset', message)
    }, 2000)
  }

  function onRemote<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
    remotePresenter.onRemote(event, data)
  }

  return {
    remotePresenter,

    startSharing,
    stopSharing,
    pauseStreaming,
    resumeStreamingIfPaused,
    toggleRemoteControl,
    toggleMouse,
    onRemote,
  }
}
