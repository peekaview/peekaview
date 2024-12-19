<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'

import RemoteControl from "./RemoteControl.vue"
import RequestAccess from './RequestAccess.vue'

import type { ScreenShareData } from '../../types'

defineProps<{
  email?: string
  name?: string
}>()

defineEmits<{
  (e: 'toggle-full-video', active: boolean): void
}>()

const screenShareData = ref<ScreenShareData>()

let lastViewActiveInterval = window.setInterval(() => {
  if (!screenShareData.value)
    return

  localStorage.setItem('lastViewActive', Date.now().toString())
}, 1000)

onBeforeUnmount(() => {
  clearInterval(lastViewActiveInterval)
  localStorage.removeItem('lastViewActive')
})

window.addEventListener('beforeunload', () => {
  clearInterval(lastViewActiveInterval)
  localStorage.removeItem('lastViewActive')
})
</script>

<template>
  <RemoteControl
    v-show="screenShareData"
    :data="screenShareData"
    @stop="screenShareData = undefined"
    @toggle-full-video="$emit('toggle-full-video', $event)"
  />
  <RequestAccess
    v-if="!screenShareData"
    :email="email"
    :name="name"
    @accept="screenShareData = $event"
  />
</template>