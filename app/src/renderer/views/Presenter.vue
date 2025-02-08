<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { prompt } from '../util'

const props = defineProps<{
  email: string
  token: string
}>()

const { t } = useI18n()

const downloadLink = ref('downloads/PeekaView.exe')
const presenterWindow = ref<Window | undefined>()
const inviteUrl = computed(() => `${import.meta.env.VITE_APP_URL}?view=${btoa(`viewEmail=${ props.email }`)}`)

onBeforeUnmount(() => {
  presenterWindow.value?.close()
})

function present() {
  if (presenterWindow.value) {
    presenterWindow.value.focus()
    return
  }

  const data = computed(() => btoa(new URLSearchParams({
    email: props.email,
    token: props.token,
  }).toString()))
  presenterWindow.value = window.open(`browserPresenter/index.html?data=${data.value}`, '_blank', 'width=400,height=300,right=160,top=0,popup=true') ?? undefined
  if (!presenterWindow.value) {
    throw new Error('Failed to open presenter window')
  }

  presenterWindow.value.focus()
  presenterWindow.value.onbeforeunload = () => {
    presenterWindow.value = undefined
  }
}

function shareViaApp() {
  const protocolUrl = `peekaview://action=share&${new URLSearchParams({ email: props.email, token: props.token }).toString()}`
  window.location.href = protocolUrl
  
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
</script>

<template>
  <div class="content-wrapper">
    <div v-if="presenterWindow" class="section-content">
      <h3 class="text-center mb-4">{{ $t('share.activeSession.active') }}</h3>
      <div class="panel">
        <div class="text-center">
          <p style="font-size: 1.33rem;font-weight: bold">{{ $t('share.activeSession.canBeClosed') }}</p>
          <p>{{ $t('share.activeSession.keepAlive') }}</p>
        </div>
        <hr />
        <div class="text-center">
          <p>{{ $t('share.activeSession.invite') }}</p>
          <code>{{ inviteUrl }}</code>
        </div>
      </div>
    </div>
    <div v-else class="section-content">
      <h3 class="text-center mb-4">{{ $t('share.howToShare') }}</h3>
      <div class="panel share-options-stack">
        <div class="share-option primary">
          <div class="option-content">
            <h3>{{ $t('share.appOption.title') }}</h3>
            <p>{{ $t('share.appOption.description') }}</p>
            <button class="btn btn-primary btn-lg w-100" :disabled="!!presenterWindow" @click="shareViaApp">
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
            <button class="btn btn-outline-primary btn-lg w-100" :disabled="!!presenterWindow" @click="present">
              {{ $t('share.browserOption.button') }}
            </button>
          </div>
        </div>
        
        <div class="download-option">
          <p class="text-muted mb-2">{{ $t('share.download.prompt') }}</p>
          <a :href="downloadLink" class="btn btn-link download-link" download>
            <i class="mdi mdi-download me-2"></i>
            {{ $t('share.download.button') }}
          </a>
        </div>
      </div>
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
</style>