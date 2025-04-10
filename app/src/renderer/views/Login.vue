<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useField } from 'vee-validate'
import { string } from 'yup'

import CopyField from '../components/CopyField.vue'

import { callApi } from '../api'
import { getStoredItem, notify } from '../util'

const props = defineProps<{
  authCode?: string
  loginCode?: string
  target?: string
}>()

const { t } = useI18n()

const { value: email, errorMessage: emailError } = useField<string>('email', string().email(t('validation.invalidEmail')).required(t('validation.required')))

function handleOpenApp() {
  window.location.href = `peekaview://login/?code=${props.authCode}`
}

function toScreenShare() {
  window.location.search = '?share'
}
    
async function handleRegister(e: Event) {
  e.preventDefault()

  if (!email.value)
    return

  try {
    const uuid = (await getStoredItem('uuid'))!
    const response = await callApi('registerMyEmail', {
      email: email.value,
      uuid,
      target: props.target === 'app' ? 'app' : 'web',
    })

    if (response.success)
      notify({
        type: 'success',
        text: t('login.justRegistered'),
        confirmButtonText: t('general.ok'),
      })
  } catch (error) {
    console.error('Error during registration:', error)
    notify({
      type: 'error',
      title: t('login.connectionError.title'),
      text: t('login.connectionError.text'),
      confirmButtonText: t('general.ok'),
    })
  }
}
</script>

<template>
  <form v-if="!loginCode" @submit="handleRegister">
    <div class="form-content">
      <div class="mb-4">
        <p>{{ $t('login.notLoggedIn') }}</p>
      </div>
      <div class="mb-4">
        <label for="email" class="form-label">{{ $t('labels.yourEmail') }}</label>
        <input type="email" class="form-control form-control-lg" id="email" name="email"
          v-model="email" placeholder="example@email.com" required>
      </div>
      <label v-if="emailError" class="text-danger mt-1">{{ emailError }}</label>
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
        <CopyField class="mb-2" :text="loginCode" />
        <small>{{ $t('login.contactSupport') }}</small>
      </div>
    </div>
  </div>
  <div v-else>
    <div class="form-content">
      <h2 class="">{{ $t('login.successful') }}</h2>
      <p class="mt-3">{{ $t('login.successMessage') }}</p>
      
      <button class="btn btn-primary btn-lg w-100 mt-4" @click="toScreenShare">
        {{ $t('login.toShare') }}
      </button>
    </div>
  </div>
</template>