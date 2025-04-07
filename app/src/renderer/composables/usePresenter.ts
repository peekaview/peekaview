import { computed, MaybeRef, reactive, ref, shallowRef, unref, watch } from 'vue'

import { useScreenPresent, type ScreenPresent, type ScreenShareData } from "./useSimplePeerScreenShare"

import { callApi, UnauthorizedError } from '../api'
import { getPlatform, getStoredItem, incrementRecentContacts } from '../util'
import { RemoteData, ScreenSource, StreamState, SendRemote, ViewerTool, ContactData, NotificationPayload } from '../../interface'
import { stringToColor } from '../../util'

import PeekaViewLogo from '../../assets/img/peekaviewlogo.png'

export type Presenter = ReturnType<typeof usePresenter>

type PresenterData = {
  email: MaybeRef<string>
  token: MaybeRef<string>
  toolsEnabled: MaybeRef<Record<ViewerTool, boolean>>
}

type RequestData = {
  requestId: string
  accessToken?: string | undefined
  name: string
}

type PresenterOptions = {
  notify?: {
    contact: MaybeRef<ContactData | undefined>
    getMessage: (name: string) => string
  }
  onRequest?: (request: RequestData) => Promise<boolean>
  onStream?: (stream: MediaStream) => void
  onRemote?: SendRemote
  onReset?: (data: RemoteData<'reset'>) => void
  onStop?: () => void
  onAllViewersLeft?: () => Promise<boolean>
  onApiError?: (error: Error, requestData: any) => void
}

export function usePresenter(data: PresenterData, getStream: () => Promise<{ stream: MediaStream | undefined, source: ScreenSource | undefined }>, options?: PresenterOptions) {
  const inApp = !!window.electronAPI
  const screenPresent = ref<ScreenPresent>()
  const screenShareData = ref<ScreenShareData>()
  const viewers = computed(() => Object.values(screenPresent.value?.participants ?? {}).map(p => p.user))

  const inviteCode = ref<string>()
  const accessToken = ref<string>()

  watch(viewers, async (viewers, oldViewers) => {
    window.electronAPI?.updateUsers(JSON.stringify(viewers))
    incrementRecentContacts(viewers)

    if (viewers.length > 0)
      sendReset()
    else if (oldViewers.length > 0) {
      const result = await options?.onAllViewersLeft?.()
      if (result)
        stopSharing()
    }
  })

  const pingInterval = ref<number>()
  const lastPingTime = ref<number>()
  
  const streamState = ref<StreamState>('stopped')
  const stream = shallowRef<MediaStream | undefined>()

  const requestQueue = reactive<Record<string, RequestData>>({})

  let checkRequestTimeout: number | undefined
  watch(streamState, (state) => {
    if (state === 'stopped')
      return
    
    const interval = async () => {
      clearTimeout(checkRequestTimeout)
      await checkRequests()

      checkRequestTimeout = window.setTimeout(async () => {
        await checkRequests()
        interval()
      }, 2000)
    }

    interval()

    processRequests()
  })

  window.electronAPI?.onHidden((flag) => {
    streamState.value = flag ? 'hidden' : 'active'
    sendReset()
  })
  
  window.electronAPI?.onRemote((event, data) => {
    screenPresent.value?.sendRemote(event, data)
  })

  let resetTimeout: number | undefined
  let resetJson: string
  watch(stream, (stream) => {
    clearTimeout(resetTimeout)
    if (!stream)
      return
    
    sendReset()
  })

  watch(data.toolsEnabled, () => {
    sendReset()
  })

  //let lastResetWidth: number | undefined
  //let lastResetHeight: number | undefined
  function sendReset(interval = false) {
    clearTimeout(resetTimeout)
    if (inApp || !screenPresent.value)
      return

    const constraints = stream.value?.getVideoTracks()[0].getConstraints()
    const maxWidth = typeof constraints?.width === 'number' ? constraints.width : constraints?.width?.max ?? 0
    const maxHeight = typeof constraints?.height === 'number' ? constraints.height : constraints?.height?.max ?? 0

    const settings = stream.value?.getVideoTracks()[0].getSettings()
    const width = settings?.width || maxWidth
    const height = settings?.height || maxHeight

    const resetData = {
      isScreen: true, // TODO
      inBrowser: true,
      dimensions: {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
      },
      coverBounds: [],
      toolsEnabled: unref(data.toolsEnabled),
      streamState: streamState.value,
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
  
  let unwatchContactToNotify: () => void
  async function startSession() {
    if (screenPresent.value)
      return

    const requestData = {
      email: unref(data.email),
      token: unref(data.token),
    }
    console.log("createScreenShareRoom", requestData)

    try {
      const acceptedData = await callApi('createScreenShareRoom', requestData)

      const id = (await getStoredItem('uuid'))!
      screenShareData.value = {
        user: {
          id,
          email: unref(data.email),
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
      inviteCode.value = acceptedData.inviteCode
      accessToken.value = acceptedData.accessToken

      pingInterval.value = window.setInterval(() => {
        updateOnlineStatus()
      }, 10000)
      updateOnlineStatus()

      screenPresent.value = await useScreenPresent(screenShareData.value, {
        onRemote: (event, data) => {
          options?.onRemote?.(event, data)
          if (inApp)
            window.electronAPI?.sendRemote(event, data)
        }
      })
      
      await presentSource()

      unwatchContactToNotify = watch(() => unref(options?.notify?.contact), (contact) => {
        if (!contact)
          return

        console.log('Notify contact:', contact)
        window.electronAPI?.log('Notify contact:', JSON.stringify(contact))
        callApi('sendPushNotification', {
          email: unref(data.email),
          token: unref(data.token),
          uuid: contact.id,
          notification: JSON.stringify<NotificationPayload>({
            title: 'PeekaView',
            message: options!.notify!.getMessage(unref(data.email)),
            data: {
              icon: PeekaViewLogo,
              url: new URL(`${import.meta.env.VITE_APP_URL}/?share`).toString(),
              type: 'view',
              email: unref(data.email),
            }
          })
        })
      }, { immediate: true })
  } catch (error) {
      console.error('Error creating room:', error);
      handleApiError(error as Error, requestData)
    }
  }

  async function presentSource() {
    if (!screenPresent.value)
      return

    try {
      const { stream: str, source } = await getStream()
      if (!str)
        return

      await cleanUpStream()
      stream.value = str
      await screenPresent.value.addStream(stream.value)
      options?.onStream?.(stream.value)
      stream.value.getVideoTracks()[0].onended = () => {
        stopSharing()
      }
      streamState.value = 'active'

      console.log('sharingActive', inviteCode.value, source)
      source && window.electronAPI?.sharingActive(inviteCode.value!, JSON.stringify({ source, userName: unref(data.email) }))
    } catch (error) {
      console.error('Error sharing local screen:', error)
    }
  }
      
  async function updateOnlineStatus() {
    if (document.hidden)
      return

    const requestData = {
      email: unref(data.email),
      token: unref(data.token),
      inviteCode: inviteCode.value!,
    }

    try {
      await callApi('iAmOnline', requestData)
      lastPingTime.value = Date.now()
    } catch (error) {
      console.error('Error updating online status:', error)
      handleApiError(error as Error, requestData)
    }
  }

  async function checkRequests() {
    const requestData = {
      email: unref(data.email),
      token: unref(data.token),
    }
    
    try {
      const requests = await callApi('doesAnyoneWantToSeeMyScreen', requestData)
      for (const request of requests)
        requestQueue[request.requestId] = request
    } catch (error) {
      console.error('Error checking requests:', error);
      handleApiError(error as Error, requestData)
    }
  }

  let processRequestTimeout: number | undefined
  async function processRequests() {
    clearTimeout(processRequestTimeout)
    const keys = Object.keys(requestQueue)
    if (keys.length > 0) {
      const id = keys[0]
      window.electronAPI?.log('processRequests', JSON.stringify(requestQueue[id]))
      if (!options?.onRequest || requestQueue[id].accessToken === accessToken.value) {
        await handleRequest(id, true)
      } else {
        const response = await options.onRequest(requestQueue[id])
        handleRequest(id, response)
      }
      delete requestQueue[id]
    }

    processRequestTimeout = window.setTimeout(() => processRequests(), 100)
  }

  async function handleRequest(id: string, allowed: boolean) {
    const requestData = {
      allowed,
      email: unref(data.email),
      token: unref(data.token),
      requestId: id,
    }

    try {
      await callApi('handleIfAllowedToSeeMyScreen', requestData)
    } catch (error) {
      console.error('Error handling request:', error)
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
    streamState.value = 'paused'
    sendReset()
  }
  
  function resumeSharing() {
    if (stream.value)
      stream.value.getTracks()[0].enabled = true
    streamState.value = 'active'
    sendReset()
  }
  
  function stopSharing() {
    cleanUpStream()
  
    if (screenPresent.value)
      screenPresent.value.leave()
  
    cleanUpCallbacks()
    
    streamState.value = 'stopped'
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
    clearTimeout(checkRequestTimeout)
    checkRequestTimeout = undefined
    clearTimeout(processRequestTimeout)
    processRequestTimeout = undefined

    for (const id in requestQueue)
      delete requestQueue[id]

    clearInterval(pingInterval.value)
    pingInterval.value = undefined
    unwatchContactToNotify?.()
  }

  return reactive({
    inviteCode,
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