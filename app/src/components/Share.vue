<script setup lang="ts">
import { ref } from 'vue'
import Swal from 'sweetalert2'
import { useI18n } from 'vue-i18n'

import Modal from './Modal.vue'

import type { AcceptedRequestData, ScreenShareData } from '../types'
import { callApi } from '../api';

interface Request {
  request_id: string
  name: string
}

type WaitingStatus = 'checking'

const props = defineProps<{
  email: string
  token: string
  sessionActive: boolean
}>()

const emit = defineEmits<{
  (e: 'startSharing', data: ScreenShareData): void
  (e: 'handleError', error: Error): void
}>()

const { t } = useI18n()

const downloadLink = ref('downloads/PeekAView.exe')

const sessionActive = defineModel<boolean>('sessionActive')

const latestRequest = ref<Request>()

const waitingStatus = ref<WaitingStatus>()

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
  waitingStatus.value = 'checking'

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
        waitingStatus.value = undefined
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
    if (!sessionActive.value)
      await createRoom()
  } catch (error) {
    console.error('Error accepting request:', error)
    handleError(error)
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
      isSharer: true,
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
    text: t('share.requestError'),
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  });
}

function shareViaApp() {
  const protocolUrl = `peekaview://action=share&${new URLSearchParams({ email: props.email, token: props.token }).toString()}`;
  window.location.href = protocolUrl;
  
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
  <template v-if="token && !listeningForRequests">
    <h3 class="text-center mb-4">{{ $t('share.howToShare') }}</h3>
    
    <div class="share-options-stack">
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
          <button class="btn btn-outline-primary btn-lg w-100" @click="listenForRequests()">
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
  <div v-else-if="sessionActive" id="activeSessionInfo">
    <h3 class="mb-4">{{ $t('share.activeSession.title') }}</h3>
    <div class="session-status alert alert-success">
      <i class="mdi mdi-cast me-2"></i>
      {{ $t('share.activeSession.status') }}
    </div>
  </div>
  <div v-else id="noActiveSession" class="start-sharing-info">
    <h3 class="mb-4">{{ $t('share.startSharing.title') }}</h3>
    <p class="text-muted">
      {{ $t('share.startSharing.description') }}
    </p>
  </div>

  <Modal :show="!!latestRequest">
    <template #default>
      <p id="requestMessage">{{ $t('share.requestAccess.message', { name: latestRequest?.name }) }}</p>
    </template>
    <template #ok>
      <button type="button" class="btn btn-primary" id="acceptRequestBtn" @click="acceptRequest">
        {{ $t('share.requestAccess.accept') }}
      </button>
    </template>
    <template #cancel>
      <button type="button" class="btn btn-secondary" @click="denyRequest">
        {{ $t('share.requestAccess.deny') }}
      </button>
    </template>
  </Modal>

  <Modal :show="!!waitingStatus" no-close-on-backdrop no-close-on-esc hide-header hide-footer>
    <template #default>
      <div class="text-center">
        <div class="waiting-spinner"></div>
        <h4 class="mt-3" id="waitingMessage">{{ $t(`share.waitingStatus.${waitingStatus}`) }}</h4>
      </div>
    </template>
  </Modal>
</template>

<style>
/* Share Options Styles */
.share-options-stack {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: rgba(255, 255, 255, 0.98);
  border-radius: 15px;
  padding: 2rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.8);
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

/* Session Status Styles */
.session-status {
  max-width: 400px;
  margin: 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 1rem 2rem;
  border-radius: 8px;
  background-color: #d4edda;
  border-color: #c3e6cb;
}

.start-sharing-info {
  background: rgba(255, 255, 255, 0.98);
  border-radius: 15px;
  padding: 2rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.8);
  max-width: 400px;
  margin: 0 auto;
}

/* Active Session Info */
#activeSessionInfo {
  max-width: 400px;
  margin: 0 auto;
}

/* Responsive Adjustments */
@media (max-width: 640px) {
  .share-options-stack,
  .start-sharing-info {
      padding: 1.5rem;
  }
}
</style>