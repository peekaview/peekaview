<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { prompt } from '../../util'

const props = defineProps<{
  email: string
  token: string
}>()

defineEmits<{
  (e: 'present'): void
}>()

const { t } = useI18n()

const downloadLink = ref('downloads/PeekaView.exe')

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
  
    <button class="btn btn-outline-secondary btn-lg w-100" @click="$emit('present')">
      {{ $t('share.browserOption.button') }}
    </button>
  
  <div class="download-option">
    <span class="text-muted">{{ $t('share.download.prompt') }}</span>
    <a :href="downloadLink" class="btn btn-link" download>
      {{ $t('share.download.button') }}
    </a>
  </div>
</template>

<style>
.share-option {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid rgba(0,0,0,0.08);
}

.share-option.primary {
  border: 2px solid #1a73e8;
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

.download-option span {
  font-size: 0.9rem;
  color: #64748b;
}

.download-option a {
  color: #1a73e8;
  text-decoration: none;
  font-size: 0.9rem;
}

.download-option:hover {
  text-decoration: underline;
}
</style>