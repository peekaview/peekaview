import { computed, MaybeRef, reactive, ref, shallowRef, unref, watch } from 'vue'

import { useScreenPresent, type ScreenPresent, type ScreenShareData } from "./useSimplePeerScreenShare"

import type { AcceptedRequestData } from '../types'
import { callApi, UnauthorizedError } from '../api'
import { getPlatform } from '../util'
import { RemoteData, ScreenSource, SendRemote } from '../../interface'
import { stringToColor, uuidv4 } from '../../util'

interface Request {
  request_id: string
  name: string
}

export type Presenter = ReturnType<typeof usePresenter>

type PresenterData = {
  email: MaybeRef<string>
  token: MaybeRef<string>
  pointerEnabled: MaybeRef<boolean>
  remoteControlEnabled: MaybeRef<boolean>
}

type PresenterOptions = {
  onRequest?: (request: Request) => Promise<boolean>
  onStream?: (stream: MediaStream, shareAudio?: boolean) => void
  onRemote?: SendRemote
  onReset?: (data: RemoteData<'reset'>) => void
  onStop?: () => void
  onApiError?: (error: Error, requestData: any) => void
}

export function usePresenter(data: PresenterData, getStream: (shareAudio: boolean) => Promise<MediaStream | undefined>, options?: PresenterOptions) {
  const inApp = !!window.electronAPI
  const screenPresent = ref<ScreenPresent>()
  const screenShareData = ref<ScreenShareData>()
  const viewers = computed(() => Object.values(screenPresent.value?.participants ?? {}).map(p => p.user))
  const viewCode = computed(() => btoa(`viewEmail=${ unref(data.email) }`))
  const latestRequest = ref<Request>()

  const requestInterval = ref<number>()
  const pingInterval = ref<number>()
  const lastPingTime = ref<number>()
  
  const sessionState = ref<'stopped' | 'active' | 'paused'>('stopped')
  const stream = shallowRef<MediaStream | undefined>()

  watch(viewers, (viewers) => {
    window.electronAPI?.updateUsers(JSON.stringify(viewers))
    sendReset()
  })

  watch(sessionState, (state) => {
    if (state === 'paused')
      return
  
    if (state === 'stopped') {
      clearInterval(requestInterval.value)
      requestInterval.value = undefined
      return
    }
  
    if (requestInterval.value)
      return
  
    requestInterval.value = window.setInterval(async () => {
      console.log('Checking for requests')
      if (latestRequest.value)
        return
  
      const requestData = {
        action: 'doesAnyoneWantToSeeMyScreen' as const,
        email: unref(data.email),
        token: unref(data.token),
      }
      
      try {
        const requests = await callApi<Request[]>(requestData)
        
        if (requests.length > 0) {
          latestRequest.value = requests[0];
        }
      } catch (error) {
        console.error('Error checking requests:', error);
        handleApiError(error as Error, requestData)
      }
    }, 2000)
  })
  
  watch(latestRequest, async (request) => {
    if (!request)
      return

    if (!options?.onRequest) {
      acceptRequest(request)
    } else {
      const response = await options.onRequest(request)
      if (response)
        acceptRequest(request)
      else
        denyRequest(request)
    }

    latestRequest.value = undefined
  })

  window.electronAPI?.onHidden((hidden) => {
    if (screenPresent.value) {
      screenPresent.value.sendRemote('hide', { hidden })
    }
  })
  
  window.electronAPI?.onRemote((event, data) => {
    if (screenPresent.value) {
      screenPresent.value.sendRemote(event, data)
    }
  })

  let resetTimeout: number | undefined
  let resetJson: string
  watch(stream, (stream) => {
    clearTimeout(resetTimeout)
    if (!stream)
      return
    
    sendReset()
  })

  watch(() => [unref(data.pointerEnabled), unref(data.remoteControlEnabled)], () => {
    sendReset()
  })

  //let lastResetWidth: number | undefined
  //let lastResetHeight: number | undefined
  function sendReset(interval = false) {
    clearTimeout(resetTimeout)
    if (inApp)
      return

    const width = stream.value?.getVideoTracks()[0].getSettings().width ?? 0
    const height = stream.value?.getVideoTracks()[0].getSettings().height ?? 0

    // TODO: do send in case a new viewer joins somehow
    /*if (lastResetWidth === width && lastResetHeight === height)
      return

    lastResetWidth = width
    lastResetHeight = height
    */ 

    const resetData = {
      isScreen: true, // TODO
      dimensions: {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
      },
      coverBounds: [],
      pointerEnabled: unref(data.pointerEnabled),
      remoteControlEnabled: unref(data.remoteControlEnabled),
    }
    
    const json = JSON.stringify(resetData)
    if (!interval || resetJson != json) {
      resetJson = json
      console.log('reset', resetData)
      screenPresent.value?.sendRemote('reset', resetData)
      options?.onReset?.(resetData)
    }

    resetTimeout = window.setTimeout(() => sendReset(true), 2000)
  }
  
  async function startSession() {
    if (screenPresent.value)
      return

    const requestData = {
      action: 'createScreenShareRoom' as const,
      email: unref(data.email),
      token: unref(data.token),
    }

    try {
      const acceptedData = await callApi<AcceptedRequestData>(requestData)

      screenShareData.value = {
        user: {
          id: uuidv4(),
          name: unref(data.email),
          color: stringToColor(unref(data.email)),
          platform: getPlatform(),
          inApp,
        },
        roomName: acceptedData.roomId,
        roomId: acceptedData.roomId,
        turnCredentials: acceptedData.turnCredentials,
        serverUrl: acceptedData.videoServer,
        controlServer: acceptedData.controlServer,
      }

      pingInterval.value = window.setInterval(() => {
        updateOnlineStatus()
      }, 10000)
      updateOnlineStatus()

      screenPresent.value = await useScreenPresent(screenShareData.value, {
        inApp,
        onRemote: (event, data) => {
          options?.onRemote?.(event, data)
          if (inApp)
            window.electronAPI?.sendRemote(event, data)
        }
      })
      
      presentSource()
    } catch (error) {
      console.error('Error creating room:', error);
      handleApiError(error as Error, requestData)
    }
  }

  async function presentSource(source?: ScreenSource, shareAudio = false) {
    if (!screenPresent.value)
      return

    try {
      const s = await getStream(shareAudio)
      if (!s)
        return

      await cleanUpStream()
      stream.value = s
      await screenPresent.value.addStream(stream.value, shareAudio)
      options?.onStream?.(stream.value, shareAudio)
      sessionState.value = 'active'

      source && window.electronAPI?.sharingActive(viewCode.value, JSON.stringify({ source, userName: unref(data.email) }))
    } catch (error) {
      console.error('Error sharing local screen:', error)
    }
  }
      
  async function updateOnlineStatus() {
    if (document.hidden)
      return

    console.log('Updating online status')
    const requestData = {
      action: 'iAmOnline' as const,
      email: unref(data.email),
      token: unref(data.token),
    }

    try {
      await callApi(requestData)
      lastPingTime.value = Date.now()
    } catch (error) {
      console.error('Error updating online status:', error)
      handleApiError(error as Error, requestData)
    }
  }

  async function acceptRequest(request: Request) {
    const requestData = {
      action: 'youAreAllowedToSeeMyScreen' as const,
      email: unref(data.email),
      token: unref(data.token),
      request_id: request.request_id,
    }

    try {
      await callApi(requestData)
    } catch (error) {
      console.error('Error accepting request:', error)
      handleApiError(error as Error, requestData)
    }
  }

  async function denyRequest(request: Request) {
    const requestData = {
      action: 'youAreNotAllowedToSeeMyScreen' as const,
      email: unref(data.email),
      token: unref(data.token),
      request_id: request.request_id,
    }
    try {
      await callApi(requestData)
    } catch (error) {
      console.error('Error denying request:', error)
      handleApiError(error as Error, requestData)
    }
  }
      
  function handleApiError(error: Error, requestData: any) {
    window.electronAPI?.log("presenter error", error, JSON.stringify(requestData))
    if (!import.meta.env.DEV && error instanceof UnauthorizedError) {
      if (inApp)
        window.electronAPI!.logout(true)
      else
        window.location.href = `/?login=${btoa(`target=web&discardSession=true`)}`
      return
    }

    options?.onApiError?.(error, requestData)
  }
  
  function pauseSharing() {
    if (stream.value)
      stream.value.getTracks()[0].enabled = false
    sessionState.value = 'paused'
    screenPresent.value?.sendRemote('pause', { enabled: true })
  }
  
  function resumeSharing() {
    if (stream.value)
      stream.value.getTracks()[0].enabled = true
    sessionState.value = 'active'
    screenPresent.value?.sendRemote('pause', { enabled: false })
  }
  
  function stopSharing() {
    cleanUpStream()
  
    if (screenPresent.value)
      screenPresent.value.leave()
  
    cleanUpCallbacks()
    
    sessionState.value = 'stopped'
    window.electronAPI?.stopSharing()
  
    options?.onStop?.()
  }
  
  async function cleanUpStream() {
    if (stream.value) {
      await screenPresent.value?.cleanUpStream()
      stream.value.getTracks().forEach(track => track.stop())
      stream.value = undefined
    }
  }

  function cleanUpCallbacks() {
    clearInterval(requestInterval.value)
    clearInterval(pingInterval.value)
  }

  return reactive({
    viewCode,
    stream,
    viewers,
    screenShareData: computed(() => screenShareData.value),
    sendRemote: computed(() => screenPresent.value?.sendRemote),
    
    startSession,
    sendReset,
    pauseSharing,
    resumeSharing,
    stopSharing,
    presentSource,
    cleanUpStream,
    cleanUpCallbacks,
  })
}

export function getStreamInBrowser(shareAudio = false) {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: shareAudio
  })
}

export function getStreamFromSource(source: ScreenSource, shareAudio = false) {
  return navigator.mediaDevices.getUserMedia({
    ...(shareAudio ? {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      }
    }
    : {}),
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
      }
    }
  })
}