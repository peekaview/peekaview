<script setup lang="ts">
import { ref } from 'vue'

import PeekaViewLogo from '../../../assets/img/peekaviewlogo.png'

const params = new URLSearchParams(window.location.search)
const discardSession = params.get('discardSession') === 'true'

const loggingIn = ref(false)
const code = ref<string>()

function login() {
  window.electronAPI!.loginViaBrowser(discardSession)
  loggingIn.value = true
}

function loginWithCode() {
  code.value && window.electronAPI!.loginWithCode(code.value)
}
</script>

<template>
  <div class="container">
    <div class="row justify-content-center">
      <div class="p-4 fade-in">
        <img :src="PeekaViewLogo" alt="Logo" class="logo mb-4">
        
        <div v-if="!loggingIn" class="text-center">
          <h2 class="mb-4">{{ $t('loginWindow.login') }}</h2>
          <button class="btn btn-primary btn-lg w-100" @click="login">{{ $t('loginWindow.login') }}</button>
          <p v-if="discardSession" class="mt-4">{{ $t('loginWindow.sessionError') }}</p>
        </div>

        <div v-else class="text-center">
          <h2 class="mb-3">{{ $t('loginWindow.waitForLogin') }}</h2>
          <h3 class="text-secondary mb-3">{{ $t('loginWindow.orEnterCode') }}</h3>
          <input v-model="code" class="form-control mb-3" type="text" :placeholder="$t('loginWindow.enterCode')">
          <button class="btn btn-primary btn-lg w-100" :disabled="!code" @click="loginWithCode">{{ $t('loginWindow.loginWithCode') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
img {
  max-width: 100%;
}
</style>