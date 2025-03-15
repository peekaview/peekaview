<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AcceptedRequestData, ViewerData } from '../../types'
import { callApi } from '../../api'
import { getPlatform, getStoredItem, notify, setStoredItem } from '../../util'
import { ScreenShareData } from '../../composables/useSimplePeerScreenShare'
import { stringToColor } from '../../../util'

type RequestStatus = "request_accepted" | "request_denied" | "request_notified" | "request_not_answered" | "request_open"
type RequestUserStatus = "online" | "away" | "offline" | "unknown"
type WaitingStatus = "establishing" | "notified" | "waiting"

type UnacceptedRequestResponse = {
  message: string
  status: Exclude<RequestStatus, "request_accepted">
  user_status: RequestUserStatus
  last_seen: number
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
  contact: ViewerData
}>()

const emit = defineEmits<{
  (e: 'accepted', data: ScreenShareData): void
  (e: 'denied'): void
  (e: 'stop'): void
}>()

const { t } = useI18n()

const waitingStatus = ref<WaitingStatus | undefined>('establishing')
const requestStatus = ref<RequestStatus>()
const requestUserStatus = ref<RequestUserStatus>()
const requestLastSeen = ref<number>()

onMounted(async () => {
  const lastViewActive = await getStoredItem('lastViewActive') ?? 0
  if (Date.now() - lastViewActive < 2000) {
    notify({
      type: 'error',
      title: t('viewer.sessionAlreadyActiveTitle'),
      text: t('viewer.sessionAlreadyActive'),
      confirmButtonText: t('general.ok'),
    })
    return
  }

  setStoredItem('name', props.contact.name)

  const uuid = (await getStoredItem('uuid'))!
  const params = {
    email: props.contact.email,
    name: props.contact.name,
    request_id: uuid.replace(/-/g, '').substring(0, 8), // uuid,
  }
  requestScreen(params, true)
})

async function requestScreen(params: RequestParams, initial = false) {
  try {
    if (waitingStatus.value === undefined)
      return

    const data = await callApi<Response>({
      action: 'showMeYourScreen',
      init: initial ? '1' : '0',
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
            videoServer: data.videoServer,
            controlServer: data.controlServer,
            roomId: data.roomId,
            turnCredentials: data.turnCredentials,
          })
          return
        case 'request_denied':
          handleRequestDenied()
          return
        case 'request_notified':
          waitingStatus.value = 'notified'
          break
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

async function handleRequestAccepted(data: AcceptedRequestData) {
  console.log('handleRequestAccepted called with data:', data)
  waitingStatus.value = undefined
  requestStatus.value = undefined

  const id = (await getStoredItem('uuid'))!
  emit('accepted', {
    user: {
      id,
      name: props.contact.name,
      color: stringToColor(props.contact.name ?? 'Anonymous'),
      platform: getPlatform(),
      inApp: !!window.electronAPI,
    },
    roomName: data.roomId,
    roomId: data.roomId,
    serverUrl: data.videoServer,
    controlServer: data.controlServer,
    turnCredentials: data.turnCredentials,
  })
}

function handleRequestDenied() {
  console.log('handleRequestDenied called')
  waitingStatus.value = undefined
  requestStatus.value = undefined

  notify({
    type: 'info',
    text: t('viewer.requestDenied', { email: props.contact.email }),
    confirmButtonText: t('general.ok'),
  })

  emit('denied')
}

function handleError() {
  waitingStatus.value = undefined
  requestStatus.value = undefined
  
  notify({
    type: 'error',
    title: t('viewer.connectionErrorTitle'),
    text: t('viewer.connectionError'),
    confirmButtonText: t('general.ok'),
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

function stop() {
  waitingStatus.value = undefined
  requestStatus.value = undefined
  
  emit('stop')
}
</script>

<template>
  <div v-if="waitingStatus" class="form-content">
    <div class="text-center">
      <div class="waiting-spinner"></div>
      <h4 class="mt-3">{{ $t(`viewer.waitingStatus.${waitingStatus}`, { email: props.contact.email }) }}</h4>
      <p v-if="requestUserStatus" class="mb-3">
        <span v-if="requestUserStatus === 'online'" class="badge bg-success">{{ $t('viewer.userStatus.online', { lastSeen: formatLastSeen(requestLastSeen) }) }}</span>
        <span v-else-if="requestUserStatus === 'away'" class="badge bg-secondary">{{ $t('viewer.userStatus.away', { lastSeen: formatLastSeen(requestLastSeen) }) }}</span>
        <span v-else-if="requestUserStatus === 'offline'" class="badge bg-secondary">{{ $t('viewer.userStatus.offline') }}</span>
        <span v-else class="badge bg-warning">{{ $t('viewer.userStatus.inactive') }}</span>
      </p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" @click="stop">
        {{ $t('general.cancel') }}
      </button>
    </div>
  </div>
</template>