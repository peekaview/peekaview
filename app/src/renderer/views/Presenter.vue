<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  email: string
  token: string
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
  presenterWindow.value = window.open(`browserPresenter/index.html?data=${data.value}`, '_blank', `width=400,height=300,popup=true`) ?? undefined
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
</script>

<template>
  <div class="text-center">
    <p style="font-size: 1.33rem;font-weight: bold">{{ $t('share.activeSession.canBeClosed') }}</p>
    <p>{{ $t('share.activeSession.keepAlive') }}</p>
  </div>
  <hr />
  <div class="text-center">
    <p>{{ $t('share.activeSession.invite') }}</p>
    <code>{{ inviteUrl }}</code>
  </div>
</template>