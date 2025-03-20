<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ContactData } from '../../interface';

const props = defineProps<{
  email: string
  token: string
  contactToNotify?: ContactData
}>()

const emit = defineEmits<{
  (e: 'stop'): void
}>()

const presenterWindow = ref<Window | undefined>()
const inviteUrl = computed(() => `${import.meta.env.VITE_APP_URL}?view=${btoa(`viewEmail=${ props.email }`)}`)

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

const copied = ref(false)
function copyCode() {
  navigator.clipboard.writeText(inviteUrl.value)
  if (copied.value)
    return
  
  copied.value = true
  setTimeout(() => copied.value = false, 5000)
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
    <div class="copy-text" @click="copyCode">
      <code>{{ inviteUrl }}</code>
    </div>
    <div class="mt-2" v-if="copied">{{ $t('general.copied') }}!</div>
  </div>
</template>
