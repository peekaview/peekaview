<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Swal from 'sweetalert2'

import Modal from './Modal.vue'

import type { AcceptedRequestData, ScreenShareData } from '../types'
import { callApi } from '../api'

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

defineProps<{
  email?: string
  name?: string
}>()

const emit = defineEmits<{
  (e: 'startSharing', data: ScreenShareData): void
}>()

const { t } = useI18n()

const email = defineModel<string>('email')
const name = defineModel<string>('name')

const requestStatus = ref<RequestStatus>()
const requestUserStatus = ref<RequestUserStatus>()
const requestLastSeen = ref<number>()

const waitingStatus = ref<WaitingStatus | undefined>()

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

  if (!email.value || !name.value)
    return

  waitingStatus.value = 'establishing'
  requestStatus.value = undefined

  const params = {
    email: email.value,
    name: name.value,
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
    handleError(error)
  }
}
    
function handleRequestAccepted(data: AcceptedRequestData) {
  waitingStatus.value = undefined
  requestStatus.value = undefined
  
  setTimeout(() => {
    emit('startSharing', {
      roomName: data.roomId,
      jwtToken: data.jwt,
      serverUrl: data.videoServer,
      isSharer: false,
    })
  }, 300)
}

function handleError(error) {
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

function formatLastSeen(timestamp) {
  const seconds = Math.floor((Date.now() / 1000) - timestamp)
  
  if (seconds < 60)
    return t('viewer.lastSeen.justNow')
  
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return t('viewer.lastSeen.minutesAgo', { minutes })
  }
  
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return t('viewer.lastSeen.hoursAgo', { hours })
  }
  
  const days = Math.floor(seconds / 86400)
  return t('viewer.lastSeen.daysAgo', { days })
}
</script>

<template>
  <h3 class="text-center mb-4">{{ $t('viewer.requestScreenShare') }}</h3>

  <form class="section-form" @submit="handleSubmit">
    <div class="form-content">
      <div class="mb-4">
        <label for="email" class="form-label">{{ $t('labels.connectToEmail') }}</label>
        <input type="email" class="form-control form-control-lg" id="email" name="email"
          v-model="email"
          placeholder="example@email.com" required>
      </div>
      <div class="mb-4">
        <label for="name" class="form-label">{{ $t('labels.yourName') }}</label>
        <input type="text" class="form-control form-control-lg" id="name" name="name"
          v-model="name"
          placeholder="Enter your name" required>
      </div>
      <button type="submit" class="btn btn-primary btn-lg w-100">{{ $t('viewer.requestAccess') }}</button>
    </div>
  </form>

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