<script setup lang="ts">
import { ref } from 'vue'
import Swal from 'sweetalert2'

import Modal from './Modal.vue'

import type { AcceptedRequestData, ScreenShareData } from '../types'
import { callApi } from '../api';

type RequestStatus = "request_accepted" | "request_notified" | "request_not_answered" | "request_open"
type RequestUserStatus = "online" | "away" | "offline" | "unknown"

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

const email = defineModel<string>('email')
const name = defineModel<string>('name')

const requestStatus = ref<RequestStatus>()
const requestUserStatus = ref<RequestUserStatus>()
const requestLastSeen = ref<number>()

const waitingMessage = ref<string | undefined>()

function generateRequestId(length = 8) {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
    
async function handleSubmit(e: Event) {
  e.preventDefault();

  if (!email.value || !name.value)
    return

  waitingMessage.value = 'Verbindung wird aufgebaut...'
  setTimeout(() => {
    // waitingMessage.value = `We've sent an email to ${email.value}. You can keep this window open.`
  }, 20000)
  
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
    const data = await callApi<Response>({
      action: 'showMeYourScreen',
      ...params,
    })
    
    if (initial) {
      waitingMessage.value = `Warten auf Antwort von ${email.value}...`
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
          return;
        case 'request_open':
          if (!requestStatus.value)
            waitingMessage.value = `Warten auf Antwort von ${email.value}...`
          break;
      }

      window.setTimeout(() => {
        requestScreen(params)
      }, 1000);
    }
  } catch (error) {
    console.error('Error during polling:', error);
    handleError(error);
  }
}
    
function handleRequestAccepted(data: AcceptedRequestData) {
  waitingMessage.value = undefined
  requestStatus.value = undefined
  
  setTimeout(() => {
    emit('startSharing', {
      roomName: data.roomId,
      jwtToken: data.jwt,
      serverUrl: data.videoServer,
      isSharer: false,
    })
  }, 300);
}

function handleError(error) {
  waitingMessage.value = undefined
  requestStatus.value = undefined
  
  Swal.fire({
    icon: 'error',
    title: 'Connection Error',
    text: 'There was a problem connecting to the server. Please try again.',
    customClass: {
        popup: 'animate__animated animate__fadeIn'
    }
  });
}

function formatLastSeen(timestamp) {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  
  if (seconds < 60)
    return 'gerade eben'
  
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `vor ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  }
  
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
  }
  
  const days = Math.floor(seconds / 86400);
  return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
}
</script>

<template>
  <h3 class="text-center mb-4">Request Screen Share Access</h3>

  <form id="viewerForm" class="section-form" @submit="handleSubmit">
    <div class="form-content">
      <div class="mb-4">
        <label for="email" class="form-label">Email address of user to connect with</label>
        <input type="email" class="form-control form-control-lg" id="email" name="email"
          v-model="email"
          placeholder="example@email.com" required>
      </div>
      <div class="mb-4">
        <label for="name" class="form-label">Your Name</label>
        <input type="text" class="form-control form-control-lg" id="name" name="name"
          v-model="name"
          placeholder="Enter your name" required>
      </div>
      <button type="submit" class="btn btn-primary btn-lg w-100">Request Access</button>
    </div>
  </form>

  <Modal :show="!!waitingMessage" no-close-on-backdrop no-close-on-esc hide-header hide-footer>
    <div class="text-center">
      <div class="waiting-spinner"></div>
      <h4 class="mt-3" id="waitingMessage">{{ waitingMessage }}</h4>
      <p v-if="requestUserStatus" class="mb-3">
        <span v-if="requestUserStatus === 'online'" class="badge bg-success">online <small>(zuletzt aktiv {{ formatLastSeen(requestLastSeen) }})</small></span>
        <span v-else-if="requestUserStatus === 'away'" class="badge bg-secondary">away <small>(zuletzt aktiv {{ formatLastSeen(requestLastSeen) }})</small></span>
        <span v-else-if="requestUserStatus === 'offline'" class="badge bg-secondary">Benutzer offline</span>
        <span v-else class="badge bg-warning">Benutzer inaktiv oder offline</span>
      </p>
      <p class="text-muted small mt-10">
        Sie können das Fenster geöffnet lassen. Sobald Ihre Anfrage akzeptiert wird, 
        wird die Verbindung automatisch hergestellt.
      </p>
    </div>
  </Modal>
</template>