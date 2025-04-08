<script setup lang="ts">
import { ref } from 'vue'

import PeekaViewLogo from '../../../assets/img/peekaviewlogo.png'
import { callApi } from '../../api'

const params = new URLSearchParams(window.location.search)
const discardSession = params.get('discardSession') === 'true'

const loggingIn = ref(false)
const code = ref<string>()
const invalid = ref(false)

function login() {
  window.electronAPI!.loginViaBrowser(discardSession)
  loggingIn.value = true
}

async function loginWithCode() {
  if (!code.value)
    return

  try {
    const response = await callApi('login', {
      code: code.value,
    })
    
    const authCode = btoa(`email=${response.email}&token=${response.token}`)
    window.electronAPI!.loginWithCode(authCode)
  } catch (e) {
    invalid.value = true
  }
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
          <h2>{{ $t('loginWindow.waitForLogin') }}</h2>
          <h3 class="text-secondary mt-3">{{ $t('loginWindow.orEnterCode') }}</h3>
          <input v-model="code" class="form-control mt-3" type="text" :placeholder="$t('loginWindow.enterCode')" @change="invalid = false">
          <label v-if="invalid" class="text-danger mt-1">{{ $t('loginWindow.invalidCode') }}</label>
          <button class="btn btn-primary btn-lg w-100 mt-3" :disabled="!code" @click="loginWithCode">{{ $t('loginWindow.loginWithCode') }}</button>
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