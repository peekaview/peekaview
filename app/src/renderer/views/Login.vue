<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { callApi } from '../api'
import { getStoredItem, notify } from '../util'

import CopySvg from '../../assets/icons/content-copy.svg'

const props = defineProps<{
  target?: string
}>()

const { t } = useI18n()

const formEmail = ref<string>()
const code = ref<string | undefined>()

onMounted(async () => {
  code.value = new URLSearchParams(window.location.search).get('code') ?? undefined
})

function handleOpenApp() {
  window.location.href = `peekaview://login/?code=${code.value}`
}

function toScreenShare() {
  window.location.search = '?share'
}
    
async function handleRegister(e: Event) {
  e.preventDefault()

  if (!formEmail.value)
    return

  try {
    const uuid = (await getStoredItem('uuid'))!
    const response = await callApi('registerMyEmail', {
      email: formEmail.value,
      uuid,
      target: props.target === 'app' ? 'app' : 'web',
    })

    if (response.success)
      handleJustRegistered()
  } catch (error) {
    console.error('Error during registration:', error)
    handleError()
  }
}

function handleJustRegistered() {
  notify({
    type: 'success',
    text: t('login.justRegistered'),
    confirmButtonText: t('general.ok'),
  })
}

function handleError() {
  notify({
    type: 'error',
    title: t('login.connectionError.title'),
    text: t('login.connectionError.text'),
    confirmButtonText: t('general.ok'),
  })
}

function copy(code: string) {
  navigator.clipboard.writeText(code)
}
</script>

<template>
  <form v-if="!code" @submit="handleRegister">
    <div class="form-content">
      <div class="mb-4">
        <p>{{ $t('login.notLoggedIn') }}</p>
      </div>
      <div class="mb-4">
        <label for="email" class="form-label">{{ $t('labels.yourEmail') }}</label>
        <input type="email" class="form-control form-control-lg" id="email" name="email"
          v-model="formEmail"
          placeholder="example@email.com" required>
      </div>
      <button type="submit" class="btn btn-primary btn-lg w-100">{{ $t('login.register') }}</button>
    </div>
  </form>
  <div v-else-if="target === 'app'">
    <div class="form-content">
      <h2 class="mb-3">{{ $t('login.successful') }}</h2>
      <p class="mb-4">{{ $t('login.successMessageApp') }}</p>
      
      <button class="btn btn-primary btn-lg w-100 mb-4" @click="handleOpenApp">
        {{ $t('login.openApp') }}
      </button>

      <div>
        <p>{{ $t('login.orEnterCode') }}</p>
        <div class="bg-light p-3 rounded mt-2 mb-3">
          <code>{{ code }}</code>
          <div class="btn btn-sm btn-secondary" :title="$t('toolbar.copyToClipboard')" @click="copy(code)">
            <CopySvg />
          </div>
        </div>
        <small>{{ $t('login.contactSupport') }}</small>
      </div>
    </div>
  </div>
  <div v-else>
    <div class="form-content">
      <h2 class="mb-3">{{ $t('login.successful') }}</h2>
      <p class="text-secondary mb-4">{{ $t('login.successMessage') }}</p>
      
      <button class="btn btn-primary btn-lg w-100 mb-4" @click="toScreenShare">
        {{ $t('login.toShare') }}
      </button>
    </div>
  </div>
</template>