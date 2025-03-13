<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { callApi } from '../api'
import { getStoredItem, notify } from '../util'
import { parseCode } from '../../util'

type Response = {
  success: boolean
  error?: string
}

const props = defineProps<{
  target?: string
}>()

const { t } = useI18n()

const email = ref<string>()
const token = ref<string>()

const code = computed({
  get: () => (email.value && token.value) ? btoa(`email=${email.value}&token=${token.value}`) : undefined,
  set: (value) => {
    const { email: e, token: t } = parseCode(value)
    email.value = e ?? email.value
    token.value = t ?? token.value
  },
})

onMounted(async () => {
  code.value = await getStoredItem('code')
})

function handleOpenApp() {
  window.location.href = `peekaview://login/?code=${code.value}`
}

function toScreenShare() {
  window.location.search = '?share'
}
    
async function handleRegister(e: Event) {
  e.preventDefault();

  if (!email.value)
    return

  try {
    const response = await callApi<Response>({
      action: 'registerMyEmail',
      email: email.value,
      target: props.target === 'app' ? 'app' : 'web',
    })

    if (response.success)
      handleJustRegistered()
  } catch (error) {
    console.error('Error during registration:', error);
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
          v-model="email"
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

      <div class="text-secondary">
        <small>{{ $t('login.orEnterCode') }}</small>
        <div class="bg-light p-3 rounded mt-2 mb-3">
          <code>{{ code }}</code>
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