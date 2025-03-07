<script setup lang="ts">
import { computed } from 'vue'
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

const downloadLink = import.meta.env.VITE_DOWNLOAD_URL

const code = computed(() => btoa(`email=${props.email}&token=${props.token}`))

function shareViaApp() {
  const protocolUrl = `peekaview://share/?code=${code.value}`
  window.location.href = protocolUrl
  
  setTimeout(async () => {
    const result = await prompt({
      title: t('share.appDialog.title'),
      html: 
        t('share.appDialog.message') + '<br><br>' +
        t('share.appDialog.download', { link: downloadLink }),
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
  <div class="open-in-app">
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
  
  <button class="continue-in-browser btn btn-lg w-100" @click="$emit('present')">
    {{ $t('share.browserOption.button') }}
  </button>
  
  <div class="download-option">
    <span>{{ $t('share.download.prompt') }}</span>
    <a :href="downloadLink" class="btn btn-link" download>
      {{ $t('share.download.button') }}
    </a>
  </div>
</template>

<style>
.open-in-app {
  border-radius: 12px;
  padding: 1.5rem;
  text-align: center;
  border: 2px solid var(--primary-color);
}

.open-in-app h3 {
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
  color: var(--header-color);
}

.open-in-app p {
  margin-bottom: 1.25rem;
  font-size: 0.95rem;
}

.continue-in-browser {
  color: var(--text-color);
  border-color: var(--text-color);
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
  background-color: var(--text-color);
}

.divider::before {
  left: 0;
}

.divider::after {
  right: 0;
}

.divider span {
  padding: 0 1rem;
  font-size: 0.9rem;
  position: relative;
  z-index: 1;
}

.download-option {
  text-align: center;
  padding: 1rem;
  border-top: 1px solid rgba(0,0,0,0.05);
  margin-top: 1rem;
  font-size: 0.9rem;
}

.download-option a {
  color: var(--primary-color);
  text-decoration: none;
  font-size: 0.9rem;
}

.download-option a:hover {
  text-decoration: underline;
}
</style>