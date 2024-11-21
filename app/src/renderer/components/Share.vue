<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Swal from 'sweetalert2'

import { useScreenShare } from "../composables/useLiveKitScreenShare"
import Modal from './Modal.vue'

import type { AcceptedRequestData, ScreenShare, ScreenShareData } from '../types'
import { callApi, UnauthorizedError } from '../api'
import { ScreenSource } from '../../interface'

interface Request {
  request_id: string
  name: string
}

const props = defineProps<{
  email: string
  token: string
}>()

const { t } = useI18n()

const appUrl = ref(import.meta.env.VITE_APP_URL)
const offerDownload = ref(!window.electronAPI)
const downloadLink = ref('downloads/PeekaView.exe')

const screenShareData = ref<ScreenShareData>()
const screenShare = ref<ScreenShare>()
const latestRequest = ref<Request>()

const pingInterval = ref<number>()
const lastPingTime = ref<number>()

const sessionActive = ref(false)

const viewCode = computed(() => btoa(`viewEmail=${ props.email }`))
        
document.addEventListener('visibilitychange', () => {
  if (document.hidden)
    clearInterval(pingInterval.value)
  else
    startPingInterval()
})

window.electronAPI?.onSendScreenSource((source) => {
  source && shareLocalScreen(source)
})

watch(offerDownload, async (flag) => {
  if (flag)
    return

  await startSession()
}, { immediate: true })

let requestInterval: number | undefined
watch(sessionActive, (flag) => {
  if (!flag) {
    clearInterval(requestInterval)
    requestInterval = undefined
    return
  }

  requestInterval = window.setInterval(async () => {
  try {
    if (latestRequest.value)
      return

    const requests = await callApi<Request[]>({
      action: 'doesAnyoneWantToSeeMyScreen',
      email: props.email,
      token: props.token,
    })
    
    if (requests.length > 0) {
      latestRequest.value = requests[0];
    }
  } catch (error) {
    console.error('Error checking requests:', error);
    handleError(error as Error)

    sessionActive.value = false
  }
  }, 2000)
})

function startPingInterval() {
  pingInterval.value = window.setInterval(() => {
    updateOnlineStatus();
  }, 10000) // Ping every 10 seconds
  updateOnlineStatus() // Initial ping
}
    
async function updateOnlineStatus() {
  try {
    await callApi({
      action: 'doesAnyoneWantToSeeMyScreen',
      email: props.email,
      token: props.token,
    })
    lastPingTime.value = Date.now();
  } catch (error) {
    console.error('Error updating online status:', error);
    handleError(error as Error)
  }
}

async function acceptRequest() {
  if (!latestRequest.value)
    return

  try {
    await callApi({
      action: 'youAreAllowedToSeeMyScreen',
      email: props.email,
      token: props.token,
      request_id: latestRequest.value.request_id,
    })

    latestRequest.value = undefined
  } catch (error) {
    console.error('Error accepting request:', error)
    handleError(error as Error)
  }
}

async function denyRequest() {
  if (!latestRequest.value)
    return

  try {
    await callApi({
      action: 'youAreNotAllowedToSeeMyScreen',
      email: props.email,
      token: props.token,
      request_id: latestRequest.value.request_id,
    })

    latestRequest.value = undefined
  } catch (error) {
    console.error('Error denying request:', error)
    handleError(error as Error)
  }
}
    
async function startSession() {
  if (screenShare.value)
    return

  try {
    const data = await callApi<AcceptedRequestData>({
      action: 'createScreenShareRoom',
      email: props.email,
      token: props.token,
    })

    screenShareData.value = {
      roomName: data.roomId,
      jwtToken: data.jwt,
      serverUrl: data.videoServer,
    }

    screenShare.value = await useScreenShare(screenShareData.value)
    shareLocalScreen()
  } catch (error) {
    console.error('Error creating room:', error);
    handleError(error as Error)
  }
}

async function shareLocalScreen(source?: ScreenSource, shareAudio = false) {
  if (!screenShare.value)
    return

  try {
    let stream: MediaStream
    if (window.electronAPI) {
      console.debug('Electron environment detected')
      if (!source) {
        console.debug('No source provided, opening screen source selection')
        await window.electronAPI.openScreenSourceSelection()
        return
      }

      stream = await navigator.mediaDevices.getUserMedia({
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
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080
          }
        }
      })
    } else {
      console.debug('Browser environment detected')
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: shareAudio
      })
    }

    if (!stream)
      return

    console.debug('Screen stream obtained:', stream)
    await screenShare.value.addStream(stream, shareAudio)
    sessionActive.value = true    

    source && window.electronAPI?.startRemoteControl(source)
  } catch (error) {
    console.error('Error sharing local screen:', error)
  }
}
    
function handleError(error: Error) {
  console.log("handleError", error)
  if (error instanceof UnauthorizedError) {
    if (window.electronAPI)
      window.electronAPI.logout(true)
    else
      window.location.href = `/?login=${btoa(`target=web&discardSession=true`)}`
    return
  }

  Swal.fire({
    icon: 'error',
    title: 'Error',
    text: t('share.requestError'),
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  });
}

function shareViaApp() {
  const protocolUrl = `peekaview://action=share&${new URLSearchParams({ email: props.email, token: props.token }).toString()}`
  window.location.href = protocolUrl
  
  // Show backup dialog after a short delay
  setTimeout(async () => {
    const result = await Swal.fire({
      title: t('share.appDialog.title'),
      html: 
        t('share.appDialog.message') + '<br><br>' +
        t('share.appDialog.download', { link: downloadLink.value }),
      icon: 'info',
      showCancelButton: true,
      confirmButtonText: t('share.appDialog.tryAgain'),
      cancelButtonText: t('share.appDialog.cancel'),
      customClass: {
        popup: 'animate__animated animate__fadeIn'
      }
    })
    
    if (result.isConfirmed)
      window.location.href = protocolUrl
  }, 1000);
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

      <template v-else-if="!sessionActive">
        <div class="panel">
          <h3 class="mb-3">{{ $t('share.openSession.title') }}</h3>
          <p class="text-secondary mb-4">
            {{ $t('share.openSession.description') }}
          </p>
        </div>
      </template>

      <template v-else>
        <div class="panel">
          <h3 class="mb-3 share-title">{{ $t('share.activeSession.title') }}</h3>
          <p class="text-secondary mb-4">
            {{ $t('share.activeSession.description') }}
          </p>
          <div class="text-secondary">
            <small>{{ $t('share.activeSession.invite') }}</small>
            <div class="bg-light p-3 rounded mt-2 mb-3">
              <code>{{ appUrl }}?view={{ viewCode }}</code>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <Modal :show="!!latestRequest" hide-header>
    <template #default>
      <p>{{ $t('share.requestAccess.message', { name: latestRequest?.name }) }}</p>
    </template>
    <template #ok>
      <button type="button" class="btn btn-primary" @click="acceptRequest">
        {{ $t('share.requestAccess.accept') }}
      </button>
    </template>
    <template #cancel>
      <button type="button" class="btn btn-secondary" @click="denyRequest">
        {{ $t('share.requestAccess.deny') }}
      </button>
    </template>
  </Modal>
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