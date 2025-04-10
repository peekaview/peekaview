<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import CopyField from '../components/CopyField.vue'

import { ContactData } from '../../interface'

const props = defineProps<{
  email: string
  token: string
  contactToNotify?: ContactData
}>()

const emit = defineEmits<{
  (e: 'stop'): void
}>()

const presenterWindow = ref<Window | undefined>()
const inviteUrl = computed(() => new URL(`${import.meta.env.VITE_APP_URL}?view=${btoa(`viewEmail=${ props.email }`)}`).toString())

onMounted(() => {
  present()
})

onBeforeUnmount(() => {
  presenterWindow.value?.close()
})

function present() {
  if (presenterWindow.value) {
    presenterWindow.value.focus()
    return
  }

  const data = computed(() => btoa(new URLSearchParams({
    email: props.email,
    token: props.token,
  }).toString()))
  
  presenterWindow.value = window.open(
    `browserPresenter/index.html?data=${data.value}${props.contactToNotify ? `&notify=${JSON.stringify(props.contactToNotify)}` : ''}`,
    '_blank',
    `width=400,height=300,popup=true`
  ) ?? undefined

  if (!presenterWindow.value) {
    throw new Error('Failed to open presenter window')
  }

  presenterWindow.value.focus()
  presenterWindow.value.onbeforeunload = (e) => {
    e.preventDefault()
    e.returnValue = 'onbeforeunload'
    emit('stop')
    return 'onbeforeunload'
  }
}

function stop() {
  presenterWindow.value?.close()
  emit('stop')
}
</script>

<template>
  <div class="text-center">
    <p style="font-size: 1.33rem;font-weight: bold">{{ $t('share.activeSession.canBeClosed') }}</p>
    <p>{{ $t('share.activeSession.keepAlive') }}</p>
  </div>
  <hr />
  <div class="text-center">
    <p>{{ $t('share.activeSession.invite') }}</p>
    <CopyField :text="inviteUrl" />
  </div>
  <button class="btn btn-secondary w-100 mt-4" @click="stop">{{ $t('share.activeSession.stop') }}</button>
</template>
