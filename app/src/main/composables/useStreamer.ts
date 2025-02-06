import { dialog } from 'electron'

import { createSourceManager } from '../sources/createSourceManager.js'
import { useRemotePresenter } from './useRemotePresenter.js'
import { i18n } from '../i18n'

import type { RemoteData, RemoteEvent, UserData } from '../../interface.d.ts'
import { getWindowList } from '../util.js'
import { SourceManager } from '../sources/SourceManager.js'

//const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// Intervals
const checkWindowIntervalTime = (isMac || isLinux) ? 1000 : 1000

export type Streamer = ReturnType<typeof useStreamer>

export function useStreamer(sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void, users: UserData[] = []) {
  // Dependencies
  let sourceManager: SourceManager
  const remotePresenter = useRemotePresenter(sendRemote, users)
  
  // Streaming control flags
  let streamingState: 'hidden' | 'paused' | 'active' | 'stopped' = 'stopped'
  
  // Intervals
  let checkWindowInterval: NodeJS.Timeout | undefined
  let resetInterval: NodeJS.Timeout | undefined
  
  // Last state for pause/resume
  let pausedState: {
    mouseEnabled: boolean;
    remoteControlActive: boolean;
  } | undefined

  let hwnd: string | undefined
  let roomid: string | undefined

  async function startSharing(sourceId: string, roomId: string) {
    if (sourceId.includes(':'))
      hwnd = sourceId.split(':')[1]
    roomid = roomId

    console.log(`hwndstreamer:${hwnd}`)

    const windowList = await getWindowList()
    if (!hwnd || (!windowList.includes(hwnd) && hwnd != '0')) {
      dialog.showErrorBox(i18n.t('windowNotFound.title'), i18n.t('windowNotFound.content', { hwnd }))
      return
    }
    
    console.log(`${hwnd} in windowList`)

    await startStreaming()

    sourceManager.checkIfRectangleUpdated()
    checkWindow()
    if (!checkWindowInterval)
      checkWindowInterval = setInterval(() => checkWindow(), checkWindowIntervalTime)
  }

  function checkWindow() {
    // pause streaming, if window is minimized
    remotePresenter.updateWindowBorders(sourceManager.getOuterDimensions())
    if (sourceManager.isMinimized()) {
      console.log('window is minimized')
      pauseStreaming(true)
    }
    else if (sourceManager.checkIfRectangleUpdated()) {
      console.log('window was resized')
      pauseStreaming(true)
      // resume streaming, if window is back to normal state
    }
    else if (sourceManager.isVisible()) {
      resumeStreamingIfPaused(true)
    }

    if (!sourceManager.isVisible() && streamingState !== 'hidden') {
      console.log('window is not visible')
      //stopSharing()
      pauseStreaming(true)
    }
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

    remotePresenter.hideOverlayWindow()
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
        remoteControlActive: remotePresenter.remoteControlActive
      }
      remotePresenter.mouseEnabled = false
      remotePresenter.remoteControlActive = false
      sendReset()
    }

    console.log('pause')
    remotePresenter.hideOverlayWindow()
    remotePresenter.hideRemoteControl()
  }

  async function resumeStreamingIfPaused(fromHidden = false) {
    if (streamingState !== 'hidden' && (streamingState !== 'paused' || fromHidden))
      return

    if (pausedState !== undefined) {
      remotePresenter.mouseEnabled = pausedState.mouseEnabled
      remotePresenter.remoteControlActive = pausedState.remoteControlActive
      pausedState = undefined
    }
    
    streamingState = 'stopped'
    console.log('resume')
    await startStreaming()
  }

  async function startStreaming() {
    if (hwnd !== undefined && streamingState === 'stopped') {
      console.log("startStreaming")

      streamingState = 'active'

      sourceManager = createSourceManager(hwnd)
      await sourceManager.onInit()
      sourceManager.bringToFront()
      remotePresenter.activate(sourceManager)

      sendReset()
    }
  }

  function sendReset() {
    if (roomid === undefined)
      return

    const send = () => {
      const toolbarBounds = remotePresenter.getToolbarBounds()
      sendRemote('reset', {
        isScreen: sourceManager.isScreen(),
        dimensions: sourceManager.getOuterDimensions(),
        coverBounds: toolbarBounds ? [toolbarBounds] : [],
      })
    }

    send()

    if (resetInterval != undefined) {
      clearInterval(resetInterval)
      resetInterval = undefined
    }

    resetInterval = setInterval(() => send(), 2000)
  }

  return {
    remotePresenter,

    startSharing,
    stopSharing,
    pauseStreaming,
    resumeStreamingIfPaused,
  }
}
