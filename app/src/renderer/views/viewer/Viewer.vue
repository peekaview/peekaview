<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'

import RemoteControl from "./RemoteControl.vue"
import RequestAccess from '../form/RequestAccess.vue'

import { ScreenShareData } from '../../composables/useSimplePeerScreenShare'
import { ViewerData } from '../../types'

defineProps<{
  contact: ViewerData
}>()

const emit = defineEmits<{
  (e: 'stop'): void
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

function stop() {
  screenShareData.value = undefined
  emit('stop')
}
</script>

<template>
  <RemoteControl
    v-show="screenShareData"
    :data="screenShareData"
    @stop="stop"
  />
  <div class="content-wrapper">
    <div
      v-if="!screenShareData"
      class="section-content"
    >
      <div class="text-center">
        <div class="panel">
          <RequestAccess
            :contact="contact"
            @accept="screenShareData = $event"
            @stop="stop"
          />
        </div>
      </div>
    </div>
  </div>
</template>