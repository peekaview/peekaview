<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useScreenPresent, type ScreenPresent, type ScreenShareData } from "../composables/useSimplePeerScreenShare"

import type { AcceptedRequestData } from '../types'
import { callApi, UnauthorizedError } from '../api'
import { notify, prompt } from '../util'
import { ScreenSource } from '../../interface'
import { stringToColor, uuidv4 } from '../../util'

interface Request {
  request_id: string
  name: string
}

const props = defineProps<{
  email: string
  token: string
}>()

const { t } = useI18n()

const inElectron = !!window.electronAPI

const appUrl = ref(import.meta.env.VITE_APP_URL)
const offerDownload = ref(!inElectron)
const downloadLink = ref('downloads/PeekaView.exe')

const screenShareData = ref<ScreenShareData>()
const screenPresent = ref<ScreenPresent>()
const viewers = computed(() => screenPresent.value?.users ?? [])
const latestRequest = ref<Request>()

const requestInterval = ref<number>()
const pingInterval = ref<number>()
const lastPingTime = ref<number>()

const sessionState = ref<'stopped' | 'active' | 'paused'>('stopped')

const viewCode = computed(() => btoa(`viewEmail=${ props.email }`))

const stream = shallowRef<MediaStream | undefined>() 

let previewWindow: Window | null = null

let resetInterval: number | undefined
watch(stream, (stream) => {
  if (!stream || inElectron) {
    clearInterval(resetInterval)
    return
  }
  
  resetInterval = window.setInterval(() => {
    screenPresent.value?.sendRemote('reset', {
      isScreen: false, // TODO
      dimensions: {
        left: 0,
        top: 0,
        right: stream.getVideoTracks()[0].getSettings().width ?? 0,
        bottom: stream.getVideoTracks()[0].getSettings().height ?? 0,
      },
      toolbarBounds: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
    })
  }, 2000)
})

onMounted(() => {
  document.addEventListener('visibilitychange', togglePingInterval)
  togglePingInterval()

  window.electronAPI?.onCleanUpStream(() => {
    cleanUpStream()
  })
})

onBeforeUnmount(() => {
  clearInterval(requestInterval.value)
  clearInterval(pingInterval.value)
  document.removeEventListener('visibilitychange', togglePingInterval)
})

window.electronAPI?.onSendScreenSource((source) => {
  if (screenShareData.value && source) {
    shareLocalScreen(source)
  }
})

window.electronAPI?.onRemote((event, data) => {
  if (screenPresent.value) {
    screenPresent.value.sendRemote(event, data)
  }
})

watch(viewers, (viewers) => {
  window.electronAPI?.updateUsers(JSON.stringify(viewers))
})

watch(offerDownload, async (flag) => {
  if (flag)
    return

  await startSession()
}, { immediate: true })

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
      email: props.email,
      token: props.token,
    }
    
    try {
      const requests = await callApi<Request[]>(requestData)
      
      if (requests.length > 0) {
        latestRequest.value = requests[0];
      }
    } catch (error) {
      console.error('Error checking requests:', error);
      handleError(error as Error, requestData)
    }
  }, 2000)
})

watch(latestRequest, async (request) => {
  if (!request)
    return
  const result = await prompt({
    text: t('share.requestAccess.message', { name: request.name }),
    confirmButtonText: t('share.requestAccess.accept'),
    cancelButtonText: t('share.requestAccess.deny'),
    sound: 'ringtone',
  })
      
  if (result === '0')
    acceptRequest()
  else
    denyRequest()
})

function togglePingInterval() {
  if (document.hidden) {
    clearInterval(pingInterval.value)
    return
  }

  window.electronAPI?.log('startPingInterval')
  pingInterval.value = window.setInterval(() => {
    updateOnlineStatus()
  }, 10000) // Ping every 10 seconds
  updateOnlineStatus() // Initial ping
}
    
async function updateOnlineStatus() {
  console.log('Updating online status')
  const requestData = {
    action: 'doesAnyoneWantToSeeMyScreen' as const,
    email: props.email,
    token: props.token,
  }

  try {
    await callApi(requestData)
    lastPingTime.value = Date.now()
  } catch (error) {
    console.error('Error updating online status:', error)
    handleError(error as Error, requestData)
  }
}

async function acceptRequest() {
  if (!latestRequest.value)
    return

  const requestData = {
    action: 'youAreAllowedToSeeMyScreen' as const,
    email: props.email,
    token: props.token,
    request_id: latestRequest.value.request_id,
  }

  try {
    await callApi(requestData)

    latestRequest.value = undefined
  } catch (error) {
    console.error('Error accepting request:', error)
    handleError(error as Error, requestData)
  }
}

async function denyRequest() {
  if (!latestRequest.value)
    return

  const requestData = {
    action: 'youAreNotAllowedToSeeMyScreen' as const,
    email: props.email,
    token: props.token,
    request_id: latestRequest.value.request_id,
  }
  try {
    await callApi(requestData)

    latestRequest.value = undefined
  } catch (error) {
    console.error('Error denying request:', error)
    handleError(error as Error, requestData)
  }
}
    
async function startSession() {
  if (screenPresent.value)
    return

  const requestData = {
    action: 'createScreenShareRoom' as const,
    email: props.email,
    token: props.token,
  }

  try {
    const data = await callApi<AcceptedRequestData>(requestData)

    screenShareData.value = {
      user: {
        id: uuidv4(),
        name: props.email,
        color: stringToColor(props.email),
      },
      roomName: data.roomId,
      roomId: data.roomId,
      turnCredentials: data.turnCredentials,
      serverUrl: data.videoServer,
      controlServer: data.controlServer,
    }

    screenPresent.value = await useScreenPresent(screenShareData.value, {
      inBrowser: !inElectron,
      onRemote: (event, data) => {
        if (inElectron)
          window.electronAPI?.sendRemote(event, data)
      }
    })
    shareLocalScreen()
  } catch (error) {
    console.error('Error creating room:', error);
    handleError(error as Error, requestData)
  }
}

async function shareLocalScreen(source?: ScreenSource, shareAudio = false) {
  if (!screenPresent.value)
    return

  try {
    if (inElectron) {
      console.debug('Electron environment detected')
      if (!source) {
        console.debug('No source provided, opening screen source selection')
        await window.electronAPI!.openScreenSourceSelection()
        return
      }

      stream.value = await navigator.mediaDevices.getUserMedia({
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
            /*minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080*/
          }
        }
      })
    } else {
      console.debug('Browser environment detected')
      stream.value = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: shareAudio
      })
    }

    if (!stream.value)
      return

    console.debug('Screen stream obtained:', stream.value)
    await screenPresent.value.addStream(stream.value, shareAudio)
    sessionState.value = 'active'

    source && window.electronAPI?.sharingActive(viewCode.value, JSON.stringify({ source, roomId: screenShareData.value?.roomId, userName: props.email }))

    openPreview()
  } catch (error) {
    console.error('Error sharing local screen:', error)
  }
}

function openPreview() {
  if (inElectron)
    return

  const data = btoa(JSON.stringify({
    ...screenShareData.value, 
    userName: 'preview'
  }))
  previewWindow = window.open(`preview/index.html?data=${data}`, '_blank', 'width=400,height=300,right=160,top=0,popup=true')
}
    
function handleError(error: Error, requestData: any) {
  window.electronAPI?.log("presenter error", error, JSON.stringify(requestData))
  if (!import.meta.env.DEV && error instanceof UnauthorizedError) {
    if (inElectron)
      window.electronAPI!.logout(true)
    else
      window.location.href = `/?login=${btoa(`target=web&discardSession=true`)}`
    return
  }

  notify({
    type: 'error',
    title: 'Error',
    text: t('share.requestError') + '\n\n' + error.message,
    confirmButtonText: t('general.ok'),
  })
}

function shareViaApp() {
  const protocolUrl = `peekaview://action=share&${new URLSearchParams({ email: props.email, token: props.token }).toString()}`
  window.location.href = protocolUrl
  
  // Show backup dialog after a short delay
  setTimeout(async () => {
    const result = await prompt({
      title: t('share.appDialog.title'),
      html: 
        t('share.appDialog.message') + '<br><br>' +
        t('share.appDialog.download', { link: downloadLink.value }),
      type: 'info',
      confirmButtonText: t('share.appDialog.tryAgain'),
      cancelButtonText: t('share.appDialog.cancel'),
    })
    
    if (result === '0')
      window.location.href = protocolUrl
  }, 1000)
}

function pauseSharing() {
  window.electronAPI?.pauseSharing()
  if (stream.value)
    stream.value.getTracks()[0].enabled = false
  sessionState.value = 'paused'
}

function resumeSharing() {
  window.electronAPI?.resumeSharing()
  if (stream.value)
    stream.value.getTracks()[0].enabled = true
  sessionState.value = 'active'
}

function cleanUpStream() {
  if (stream.value) {
    stream.value.getTracks().forEach(track => track.stop())
    stream.value = undefined
  }
}

function stopSharing() {
  cleanUpStream()

  if (screenPresent.value)
    screenPresent.value.leave()

  clearInterval(requestInterval.value)
  clearInterval(pingInterval.value)
  document.removeEventListener('visibilitychange', togglePingInterval)
  
  sessionState.value = 'stopped'
  window.electronAPI?.stopSharing()

  previewWindow?.close()
  previewWindow = null

  offerDownload.value = !inElectron
}
</script>

<template>
  <div class="content-wrapper">
    <div class="section-content">
      <template v-if="token && offerDownload">
        <h3 class="text-center mb-4">{{ $t('share.howToShare') }}</h3>
        <div class="panel share-options-stack">
          <div class="share-option primary">
            <div class="option-content">
              <h3>{{ $t('share.appOption.title') }}</h3>
              <p>{{ $t('share.appOption.description') }}</p>
              <button class="btn btn-primary btn-lg w-100" @click="shareViaApp">
                {{ $t('share.appOption.button') }}
              </button>
            </div>
          </div>
          
          <div class="divider">
            <span>{{ $t('share.or') }}</span>
          </div>
          
          <div class="share-option secondary">
            <div class="option-content">
              <h3>{{ $t('share.browserOption.title') }}</h3>
              <p>{{ $t('share.browserOption.description') }}</p>
              <button class="btn btn-outline-primary btn-lg w-100" @click="offerDownload = false">
                {{ $t('share.browserOption.button') }}
              </button>
            </div>
          </div>
          
          <div class="download-option">
            <p class="text-muted mb-2">{{ t('share.download.prompt') }}</p>
            <a :href="downloadLink" class="btn btn-link download-link" download>
              <i class="mdi mdi-download me-2"></i>
              {{ $t('share.download.button') }}
            </a>
          </div>
        </div>
      </template>

      <template v-else-if="sessionState === 'stopped'">
        <div class="panel">
          <h3 class="mb-3">{{ $t('share.openSession.title') }}</h3>
          <p class="text-secondary mb-4">
            {{ $t('share.openSession.description') }}
          </p>
        </div>
      </template>

      <template v-else>
        <div class="panel">
          <h3 class="mb-3" :class="{ 'share-title': sessionState === 'active' }">{{ $t(`share.activeSession.${sessionState}`) }}</h3>
          <p class="text-secondary mb-4">
            {{ $t('share.activeSession.description') }}
          </p>
          <div class="text-secondary">
            <small>{{ $t('share.activeSession.invite') }}</small>
            <div class="bg-light p-3 rounded mt-2 mb-3">
              <code>{{ appUrl }}?view={{ viewCode }}</code>
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" @click="stopSharing">
              {{ $t('share.activeSession.stop') }}
            </button>
            <button type="button" class="btn btn-secondary" @click="shareLocalScreen()">
              {{ $t('share.activeSession.shareDifferentScreen') }}
            </button>
            <button v-if="sessionState === 'paused'" type="button" class="btn btn-secondary" @click="resumeSharing">
              {{ $t('share.activeSession.resume') }}
            </button>
            <button v-else type="button" class="btn btn-secondary" @click="pauseSharing">
              {{ $t('share.activeSession.pause') }}
            </button>
          </div>
          <div v-if="!inElectron" class="btn-row">
            <button class="btn btn-secondary" @click="openPreview">
              {{ $t('share.activeSession.openPreview') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style>
.share-options-stack {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.share-option {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid rgba(0,0,0,0.08);
  transition: transform 0.2s, box-shadow 0.2s;
}

.share-option:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0,0,0,0.08);
  background: rgba(255, 255, 255, 0.95);
}

.share-option.primary {
  border: 2px solid #1a73e8;
  background: rgba(255, 255, 255, 0.97);
}

.share-option h3 {
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
  color: #2c3e50;
}

.share-option p {
  color: #64748b;
  margin-bottom: 1.25rem;
  font-size: 0.95rem;
}

/* Divider Styles */
.divider {
  text-align: center;
  position: relative;
  padding: 0.5rem 0;
}

.divider::before,
.divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 45%;
  height: 1px;
  background-color: rgba(0,0,0,0.1);
}

.divider::before {
  left: 0;
}

.divider::after {
  right: 0;
}

.divider span {
  background: rgba(255, 255, 255, 0.9);
  padding: 0 1rem;
  color: #64748b;
  font-size: 0.9rem;
  position: relative;
  z-index: 1;
}

/* Download Option Styles */
.download-option {
  text-align: center;
  padding: 1rem;
  border-top: 1px solid rgba(0,0,0,0.05);
  margin-top: 1rem;
}

.download-option p {
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
  color: #64748b;
}

.download-link {
  color: #1a73e8;
  text-decoration: none;
  font-size: 0.9rem;
}

.download-link:hover {
  text-decoration: underline;
}

.share-title::after {
  margin-left: 1rem;
}

.share-title::before {
  margin-right: 1rem;
}

.share-title::before, 
.share-title::after {
  content: '';
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border-radius: 1rem;
  border: 1px solid red;
  background: red;
  box-shadow: 2px 2px 5px;
}
</style>