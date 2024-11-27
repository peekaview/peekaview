<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { callApi } from '../api'
import { notify } from '../util'

type Response = {
  success: boolean
  error?: string
}

const props = defineProps<{
  target?: string
}>()

const { t } = useI18n()

const registered = ref(false)

const email = ref<string>()
const token = ref<string>()

const code = computed(() => 
  (email.value && token.value) ? btoa(`email=${email.value}&token=${token.value}`) : undefined
)

onMounted(() => {
  email.value = localStorage.getItem('email') ?? undefined
  token.value = localStorage.getItem('token') ?? undefined

  registered.value = !!email.value && !!token.value
})

function handleOpenApp() {
  window.location.href = `peekaview://login/?code=${code.value}`
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
    showButtons: false
  })
}

function handleError() {
  notify({
    type: 'error',
    title: 'Connection Error',
    text: 'There was a problem connecting to the server. Please try again.'
  })
}
</script>

<template>
  <div class="content-wrapper">
    <div class="section-content">
      <div class="text-center">
        <form v-if="!registered" class="panel" @submit="handleRegister">
          <div class="form-content">
            <div class="mb-4">
              <label for="email" class="form-label">{{ $t('labels.yourEmail') }}</label>
              <input type="email" class="form-control form-control-lg" id="email" name="email"
                v-model="email"
                placeholder="example@email.com" required>
            </div>
            <button type="submit" class="btn btn-primary btn-lg w-100">{{ $t('login.register') }}</button>
          </div>
        </form>
        <div v-else class="panel">
          <div class="form-content">
            <h2 class="mb-3">{{ $t('login.successful') }}</h2>
            <p class="text-secondary mb-4">{{ $t('login.successMessage') }}</p>
            
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
      </div>
    </div>
  </div>
</template>