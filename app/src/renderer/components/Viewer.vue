<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Swal from 'sweetalert2'

import Modal from './Modal.vue'
import TrackContainer from "./TrackContainer.vue"
import RemoteControl from "./RemoteControl.vue"

import type { AcceptedRequestData, ScreenShareData, ScreenView } from '../types'
import { callApi } from '../api'
import { useScreenView } from '../composables/useLiveKitScreenShare'
import { useRemoteControl } from  '../composables/useRemoteControl'

type RequestStatus = "request_accepted" | "request_denied" | "request_notified" | "request_not_answered" | "request_open"
type RequestUserStatus = "online" | "away" | "offline" | "unknown"
type WaitingStatus = "establishing" | "notified" | "waiting"

type UnacceptedRequestResponse = {
  message: string
  status: Exclude<RequestStatus, "request_accepted">
  user_status: RequestUserStatus
  last_seen: number
  jwt: undefined
  videoServer: undefined
  controlServer: undefined
  roomId: undefined
}

type AcceptedRequestResponse = {
  message: string
  status: "request_accepted"
  user_status: RequestUserStatus
  last_seen: number
} & AcceptedRequestData

type Response = UnacceptedRequestResponse | AcceptedRequestResponse

type RequestParams = {
  email: string
  name: string
  request_id: string
}

const props = defineProps<{
  email?: string
  name?: string
}>()

const { t } = useI18n()

const inputEmail = ref<string>()
const inputName = ref<string>(props.name ?? '')

const requestStatus = ref<RequestStatus>()
const requestUserStatus = ref<RequestUserStatus>()
const requestLastSeen = ref<number>()

const screenShareData = ref<ScreenShareData>()
const screenView = ref<ScreenView>()
const waitingStatus = ref<WaitingStatus | undefined>()

const videoHeight = ref<number>()
const videoWidth = ref<number>()

const remoteViewerWrapper = ref<HTMLDivElement>()
const remoteControl = ref()

const { openRemoteControl, closeRemoteControl } = useRemoteControl()

watch(screenShareData, async (data) => {
  if (data)
    screenView.value = await useScreenView(data, () => {
      Swal.fire({
        icon: 'info',
        text: t('viewer.sharingEnded'),
        customClass: {
          popup: 'animate__animated animate__fadeIn'
        }
      })
      screenView.value = undefined

      closeRemoteControl()
    })
})

const liveKitDebugUrl = computed(() => 
  screenShareData.value ? `https://meet.livekit.io/custom?liveKitUrl=wss://${screenShareData.value.serverUrl}&token=${screenShareData.value.jwtToken}` : undefined
)

function generateRequestId(length = 8) {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}
    
async function handleSubmit(e: Event) {
  e.preventDefault()

  if ((!props.email && !inputEmail.value) || !inputName.value)
    return

  localStorage.setItem('name', inputName.value)

  waitingStatus.value = 'establishing'
  requestStatus.value = undefined

  const params = {
    email: props.email ?? inputEmail.value!,
    name: inputName.value,
    request_id: generateRequestId(),
  }
  requestScreen(params, true)
}

async function requestScreen(params: RequestParams, initial = false) {
  try {
    if (waitingStatus.value === undefined || waitingStatus.value === 'notified')
      return

    const data = await callApi<Response>({
      action: 'showMeYourScreen',
      ...params,
    })
    
    if (initial) {
      waitingStatus.value = 'waiting'
    } else {
      requestStatus.value = data.status
      requestUserStatus.value = data.user_status
      requestLastSeen.value = data.last_seen

      switch (data.status) {
        case 'request_accepted':
          handleRequestAccepted({
            jwt: data.jwt,
            videoServer: data.videoServer,
            controlServer: data.controlServer,
            roomId: data.roomId,
          })
          return
        case 'request_denied':
          waitingStatus.value = undefined
          return
        case 'request_notified':
          waitingStatus.value = 'notified'
          return
        case 'request_open':
          if (!requestStatus.value)
            waitingStatus.value = 'waiting'
          break
      }
    }

    window.setTimeout(() => requestScreen(params), 1000)
  } catch (error) {
    console.error('Error during polling:', error)
    handleError()
  }
}
    
function handleRequestAccepted(data: AcceptedRequestData) {
  console.log('handleRequestAccepted called with data:', data)
  waitingStatus.value = undefined
  requestStatus.value = undefined
  
  screenShareData.value = {
    roomName: data.roomId,
    jwtToken: data.jwt,
    serverUrl: data.videoServer
  }

  setTimeout(async () => {
    console.log('Inside setTimeout callback')
    console.log('Refs status before init:', {
      wrapper: !!remoteViewerWrapper.value,
    });
    initializeRemoteViewer(data)
  }, 500)
}

function initializeRemoteViewer(data: AcceptedRequestData) {
  console.log('initializeRemoteViewer called')

  const params = {
    roomid: 'roomid',
    username: 'username',
    userid: 'userid',
    color: Math.floor(Math.random()*16777215).toString(16),
    hostname: 'wss://c1.peekaview.de'
  }

  console.log('Generated params:', params)
  
  document.querySelector('.main-header')?.classList.add('d-none')

  remoteControl.value?.openRemoteControl(
    params.roomid,
    params.username,
    params.userid,
    params.color,
    params.hostname
  )
}

function handleError() {
  waitingStatus.value = undefined
  requestStatus.value = undefined
  
  Swal.fire({
    icon: 'error',
    title: 'Connection Error',
    text: t('viewer.connectionError'),
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  })
}

function formatLastSeen(timestamp: number | undefined) {
  if (!timestamp)
    return t('viewer.lastSeen.unknown')

  const seconds = Math.floor((Date.now() / 1000) - timestamp)
  
  if (seconds < 60)
    return t('viewer.lastSeen.justNow')
  
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return t('viewer.lastSeen.minutesAgo', minutes)
  }
  
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return t('viewer.lastSeen.hoursAgo', hours)
  }
  
  const days = Math.floor(seconds / 86400)
  return t('viewer.lastSeen.daysAgo', days)
}

onMounted(() => {
  console.log('Component mounted, checking refs:', {
    wrapper: !!remoteViewerWrapper.value,
  });
});
</script>

<template>
  <RemoteControl 
    ref="remoteControl" 
    class="remote-viewer-wrapper" 
    style="width: 800px; height: 600px;"
  >
      <div v-if="screenView" class="viewer">
        <TrackContainer 
          v-if="screenView.getTrackElement"
          class="video-container"
          :get-track-element="screenView.getTrackElement"
          :style="{ width: videoWidth, height: videoHeight }"
        />
        <slot />
      </div>
      <div v-else class="content-wrapper">
        <div class="section-content">
          <h3 class="text-center mb-4">{{ $t('viewer.requestScreenShare') }}</h3>

          <h5 v-if="email" class="text-center mb-4">{{ $t('viewer.requestFrom', { email }) }}</h5>

          <form class="section-form" @submit="handleSubmit">
            <div class="form-content">
              <div v-if="!email" class="mb-4">
                <label for="email" class="form-label">{{ $t('labels.connectToEmail') }}</label>
                <input type="email" class="form-control form-control-lg" name="email"
                  v-model="inputEmail"
                  placeholder="example@email.com" required>
              </div>
              <div class="mb-4">
                <label for="name" class="form-label">{{ $t('labels.yourName') }}</label>
                <input type="text" class="form-control form-control-lg" name="name"
                  v-model="inputName"
                  placeholder="Enter your name" required>
              </div>
              <button type="submit" class="btn btn-primary btn-lg w-100">{{ $t('viewer.requestAccess') }}</button>
            </div>
          </form>
        </div>
      </div>
  </RemoteControl>

  <Modal :show="requestStatus === 'request_denied'">
    <template #default>
      <p>{{ $t('viewer.requestDenied', { email }) }}</p>
    </template>
    <template #ok>
      <button type="button" class="btn btn-primary" @click="requestStatus = undefined">{{ $t('general.ok') }}</button>
    </template>
  </Modal>

  <Modal :show="!!waitingStatus" no-close-on-backdrop no-close-on-esc hide-header ok-only>
    <template #default>
      <div class="text-center">
        <div class="waiting-spinner"></div>
        <h4 v-if="waitingStatus" class="mt-3">{{ $t(`viewer.waitingStatus.${waitingStatus}`, { email }) }}</h4>
        <p v-if="requestUserStatus" class="mb-3">
          <span v-if="requestUserStatus === 'online'" class="badge bg-success">{{ $t('viewer.userStatus.online', { lastSeen: formatLastSeen(requestLastSeen) }) }}</span>
          <span v-else-if="requestUserStatus === 'away'" class="badge bg-secondary">{{ $t('viewer.userStatus.away', { lastSeen: formatLastSeen(requestLastSeen) }) }}</span>
          <span v-else-if="requestUserStatus === 'offline'" class="badge bg-secondary">{{ $t('viewer.userStatus.offline') }}</span>
          <span v-else class="badge bg-warning">{{ $t('viewer.userStatus.inactive') }}</span>
        </p>
        <p class="text-muted small mt-10">
          {{ $t('viewer.keepWindowOpen') }}
        </p>
      </div>
    </template>
    <template #ok>
      <button type="button" class="btn btn-secondary" @click="waitingStatus = undefined">
        {{ $t('general.cancel') }}
      </button>
    </template>
  </Modal>
</template>

<style>

.viewer, .video-container, .video-container video {
  width: 100%;
  height: 100%;
}



/*
.viewer {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 0;
}

.video-container {
  flex-grow: 1;
  position: relative;
  background: #3b3b3b;
  aspect-ratio: 16/9;
  border-radius: 6px;
  overflow: hidden;
  min-height: 0;
}

.video-container video {
  width: 100%;
  height: 100%;
}

.remote-viewer-wrapper {
  margin-top: 20px;
  border: 1px solid #ccc;
  border-radius: 6px;
  overflow: hidden;
}*/
</style>