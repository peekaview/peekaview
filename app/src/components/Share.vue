<script setup lang="ts">
import { ref } from 'vue'
import Swal from 'sweetalert2'

import Modal from './Modal.vue'

import type { AcceptedRequestData, ScreenShareData } from '../types'
import { callApi } from '../api';

interface Request {
  request_id: string
  name: string
}

const props = defineProps<{
  email: string
  token: string
  sessionActive: boolean
}>()

const emit = defineEmits<{
  (e: 'startSharing', data: ScreenShareData): void
  (e: 'handleError', error: Error): void
}>()

const sessionActive = defineModel<boolean>('sessionActive')

const latestRequest = ref<Request>()

const waitingMessage = ref<string | undefined>()

const pingInterval = ref<number>()
const lastPingTime = ref<number>()
const listeningForRequests = ref(false)
        
document.addEventListener('visibilitychange', () => {
  if (document.hidden)
    clearInterval(pingInterval.value)
  else
    startPingInterval()
})

function listenForRequests() {
  listeningForRequests.value = true
  waitingMessage.value = 'Prüfen auf Teilnehmeranfragen...'

  window.setInterval(async () => {
    try {
      if (latestRequest.value)
        return

      const requests = await callApi<Request[]>({
        action: 'doesAnyoneWantToSeeMyScreen',
        email: props.email,
        token: props.token,
      })
      
      if (requests.length > 0) {
        waitingMessage.value = undefined
        latestRequest.value = requests[0];
      }
    } catch (error) {
      console.error('Error checking requests:', error);
    }
  }, 2000)
}

function startPingInterval() {
  pingInterval.value = window.setInterval(() => {
    updateOnlineStatus();
  }, 10000); // Ping every 10 seconds
  updateOnlineStatus(); // Initial ping
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
  }
}

async function acceptRequest(request: Request) {
  try {
    latestRequest.value = undefined
    
    await callApi({
      action: 'youAreAllowedToSeeMyScreen',
      email: props.email,
      token: props.token,
      request_id: request.request_id,
    })

    if (!sessionActive.value)
      await createRoom()
  } catch (error) {
    console.error('Error accepting request:', error)
    handleError(error)
  }
}
    
async function createRoom() {
  try {
    const data = await callApi<AcceptedRequestData>({
      action: 'createScreenShareRoom',
      email: props.email,
      token: props.token,
    })
    
    sessionActive.value = true;

    emit('startSharing', {
      roomName: data.roomId,
      jwtToken: data.jwt,
      serverUrl: data.videoServer,
    })
  } catch (error) {
    console.error('Error creating room:', error);
    handleError(error);
  }
}
    
function handleError(error) {
  Swal.fire({
    icon: 'error',
    title: 'Error',
    text: 'There was a problem processing your request. Please try again.',
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  });
}

function shareViaApp() {
  const protocolUrl = `peekaview://share#${new URLSearchParams({ email: props.email, token: props.token }).toString()}`;
  window.location.href = protocolUrl;
  
  // Show backup dialog after a short delay
  setTimeout(async () => {
    const result = await Swal.fire({
      title: 'PeekAView App',
      html: 
        'If the app doesn\'t open automatically, please make sure you have it installed.<br><br>' +
        'You can <a href="downloads/PeekAView.exe" class="alert-link">download it here</a>.',
      icon: 'info',
      showCancelButton: true,
      confirmButtonText: 'Try Again',
      cancelButtonText: 'Cancel',
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
  <template v-if="token && !listeningForRequests">
    <h3 class="text-center mb-4">How would you like to share your screen?</h3>
    
    <div class="share-options-stack">
      <div class="share-option primary">
        <div class="option-content">
          <h3>Share with PeekAView App</h3>
          <p>Recommended: Full remote access and drawing capabilities</p>
          <button class="btn btn-primary btn-lg w-100" @click="shareViaApp">
            Open in PeekAView App
          </button>
        </div>
      </div>
      
      <div class="divider">
        <span>or</span>
      </div>
      
      <div class="share-option secondary">
        <div class="option-content">
          <h3>Share in Browser</h3>
          <p>Basic screen sharing through your web browser</p>
          <button class="btn btn-outline-primary btn-lg w-100" @click="listenForRequests()">
            Continue in Browser
          </button>
        </div>
      </div>
      
      <div class="download-option">
        <p class="text-muted mb-2">Don't have the PeekAView App yet?</p>
        <a href="downloads/PeekAView.exe" class="btn btn-link download-link" download>
          <i class="mdi mdi-download me-2"></i>
          Download PeekAView for Windows
        </a>
      </div>
    </div>
    
  </template>
  <div v-else-if="sessionActive" id="activeSessionInfo">
    <h3 class="mb-4">Active Sharing Session</h3>
    <div class="session-status alert alert-success">
      <i class="mdi mdi-cast me-2"></i>
      Your screen is ready to be shared
    </div>
  </div>
  <div v-else id="noActiveSession" class="start-sharing-info">
    <h3 class="mb-4">Start Screen Sharing</h3>
    <p class="text-muted">
      Your screen will automatically be shared when someone requests access.
    </p>
  </div>

  <Modal :show="!!latestRequest">
    <template #header>
      Screen Share Request
    </template>
    <template #default>
      <p id="requestMessage">{{ latestRequest?.name }} wants to see your screen. Do you want to accept?</p>
    </template>
    <template #ok>
      <button type="button" class="btn btn-primary" id="acceptRequestBtn" @click="acceptRequest(latestRequest!)">Accept</button>
    </template>
    <template #cancel>
      <button type="button" class="btn btn-secondary" @click="latestRequest = undefined">Reject</button>
    </template>
  </Modal>

  <Modal :show="!!waitingMessage" no-close-on-backdrop no-close-on-esc hide-header hide-footer>
    <template #default>
      <div class="text-center">
        <div class="waiting-spinner"></div>
        <h4 class="mt-3" id="waitingMessage">{{ waitingMessage }}</h4>
      </div>
    </template>
  </Modal>
</template>