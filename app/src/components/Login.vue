<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Swal from 'sweetalert2'

import { callApi } from '../api'

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
    handleError(error);
  }
}

function handleJustRegistered() {
  Swal.fire({
    icon: 'success',
    text: t('login.justRegistered'),
    showCancelButton: false,
    showConfirmButton: false,
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  });
}

function handleError(error) {
  Swal.fire({
    icon: 'error',
    title: 'Connection Error',
    text: 'There was a problem connecting to the server. Please try again.',
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  });
}
</script>

<template>
  <div class="text-center">
    <form v-if="!registered" class="section-form" @submit="handleRegister">
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
    <div v-else class="section-form">
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
</template>