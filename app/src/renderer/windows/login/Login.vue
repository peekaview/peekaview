<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useField } from 'vee-validate'
import { string } from 'yup'

import PeekaViewLogo from '../../../assets/img/peekaviewlogo.png'
import { callApi } from '../../api'
import { getStoredItem } from '../../util'

const { t } = useI18n()

const params = new URLSearchParams(window.location.search)
const discardSession = params.get('discardSession') === 'true'

const loginViaMail = ref(false)
const loginViaCode = ref(false)
const invalid = ref(false)
const { value: email, errorMessage: emailError, setErrors: setEmailError } = useField<string>('email', string().email(t('validation.invalidEmail')).required(t('validation.required')))
const { value: code, errorMessage: codeError, setErrors: setCodeError } = useField<string>('code', string().required(t('validation.required')))

function loginViaBrowser() {
  window.electronAPI!.loginViaBrowser(discardSession)
  loginViaCode.value = true
}
    
async function registerMail() {
  if (!email.value)
    return

  try {
    const uuid = (await getStoredItem('uuid'))!
    const response = await callApi('registerMyEmail', {
      email: email.value,
      uuid,
      target: 'app',
    })

    if (response.success) {
      loginViaCode.value = true
    }
  } catch (error) {
    console.error('Error during registration:', error)
    setEmailError(t('login.connectionError.text'))
  }
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
    setCodeError(t('loginWindow.invalidCode'))
  }
}
</script>

<template>
  <div class="container">
    <div class="d-flex flex-column align-items-center p-4 fade-in">
      <img :src="PeekaViewLogo" alt="Logo" class="logo mb-4">

      <h1 class="my-4">{{ $t('loginWindow.login') }}</h1>

      <div v-if="loginViaCode" class="text-center">
        <template v-if="loginViaMail">
          <h3 class="text-secondary mt-3">{{ $t('loginWindow.useMailCode') }}</h3>
        </template>
        <template v-else>
          <h2>{{ $t('loginWindow.waitForLogin') }}</h2>
          <h3 class="text-secondary mt-3">{{ $t('loginWindow.orEnterCode') }}</h3>
        </template>
        <input v-model="code" class="form-control mt-3" type="text" :placeholder="$t('loginWindow.code')" @change="invalid = false">
        <label v-if="codeError" class="text-danger mt-1">{{ codeError }}</label>
        <button class="btn btn-primary btn-lg w-100 mt-3" :disabled="!!codeError" @click="loginWithCode">{{ $t('loginWindow.loginWithCode') }}</button>
      </div>

      <div v-else-if="loginViaMail" class="text-center">
        <h3 class="text-secondary mt-3">{{ $t('loginWindow.enterMail') }}</h3>
        <input v-model="email" class="form-control mt-3" type="text" :placeholder="$t('loginWindow.mail')" @change="invalid = false">
        <label v-if="emailError" class="text-danger mt-1">{{ emailError }}</label>
        <button class="btn btn-primary btn-lg w-100 mt-3" :disabled="!!emailError" @click="registerMail">{{ $t('loginWindow.loginRegister') }}</button>
      </div>
      
      <div v-else class="text-center">
        <button class="btn btn-primary btn-lg w-100" @click="loginViaMail = true">{{ $t('loginWindow.loginViaMail') }}</button>
        <button class="btn btn-primary btn-lg w-100 mt-2" @click="loginViaBrowser">{{ $t('loginWindow.loginViaBrowser') }}</button>
        <small class="text-muted mt-2">{{ $t('loginWindow.loginViaBrowserDesc') }}</small>
        <p v-if="discardSession" class="mt-4">{{ $t('loginWindow.sessionError') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
img {
  max-width: 12rem;
  max-height: 12rem;
}
</style>
