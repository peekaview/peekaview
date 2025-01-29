<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import BrowserPanel from './BrowserPanel.vue'
import { usePresenter } from './usePresenter'

const props = defineProps<{
  email: string
  token: string
}>()

const inApp = !!window.electronAPI
if (inApp) {
  const presenter = usePresenter(props.email, props.token)
  presenter.startSession()

  onBeforeUnmount(() => {
    presenter.cleanUpCallbacks()
  })
}

const presenterWindow = ref<Window | undefined>()
function present() {
  if (presenterWindow.value) {
    presenterWindow.value.focus()
    return
  }

  const data = computed(() => btoa(JSON.stringify({
    email: props.email,
    token: props.token,
  })))
  presenterWindow.value = window.open(`presenter/index.html?data=${data.value}`, '_blank', 'width=400,height=300,right=160,top=0,popup=true') ?? undefined
  if (!presenterWindow.value) {
    throw new Error('Failed to open presenter window')
  }

  presenterWindow.value.focus()
  presenterWindow.value.onbeforeunload = () => {
    presenterWindow.value = undefined
  }
}

onBeforeUnmount(() => {
  presenterWindow.value?.close()
})
</script>

<template>
  <BrowserPanel
    v-if="!inApp"
    :email="email"
    :token="token"
    :disabled="!!presenterWindow"
    @open-in-browser="present"
  />
</template>