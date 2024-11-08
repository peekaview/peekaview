<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Swal from 'sweetalert2'

import { callApi } from '../api'

type LoginState = 'loggedIn' | 'loggingIn' | 'protocolTimedOut' | 'registered' | 'unregistered'

type Response = {
  // TODO: define response
}

const loginState = ref<LoginState>()

const email = ref<string>()
const token = ref<string>()

const code = computed(() => {
  return (email.value && token.value) ? btoa(`email=${email.value}&token=${token.value}`) : undefined
})

onMounted(() => {
  email.value = localStorage.getItem('email') ?? undefined
  token.value = localStorage.getItem('token') ?? undefined

  loginState.value = email.value && token.value ? 'registered' : 'unregistered'
})

function handleLogin() {
  window.location.href = `peekaview://action=login&email=${email.value}&token=${token.value}` // TODO: fix protocol handling on Linux

  setTimeout(() => {
    loginState.value = 'protocolTimedOut'
  }, 5000)
}
    
async function handleRegister(e: Event) {
  e.preventDefault();

  if (!email.value)
    return

  try {
    await callApi<Response>({
      action: 'register',
      email: email.value,
    })
  } catch (error) {
    console.error('Error during registration:', error);
    handleError(error);
  }
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
    <form v-if="loginState === 'unregistered'" class="section-form" @submit="handleRegister">
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
    <div v-else-if="loginState === 'registered'">
      <button class="btn btn-primary btn-lg w-100" @click="handleLogin">
        {{ $t('login.login') }}
      </button>
    </div>
    <template v-else-if="loginState === 'loggingIn'">
      <div class="waiting-spinner"></div>
      <h4 class="mt-3" id="waitingMessage">{{ $t('login.loggingIn') }}</h4>
    </template>
    <div v-else-if="loginState === 'protocolTimedOut'">
      <p>{{ $t('login.useCodeAlternatively') }}</p>
      <b>{{ code }}</b>
    </div>
    <div v-else-if="loginState === 'loggedIn'">
      
    </div>
  </div>
</template>