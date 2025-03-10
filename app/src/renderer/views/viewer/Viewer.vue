<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'

import RemoteViewer from "./RemoteViewer.vue"
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

onBeforeUnmount(cleanUp)
window.addEventListener('beforeunload', cleanUp)

function cleanUp() {
  clearInterval(lastViewActiveInterval)
  localStorage.removeItem('lastViewActive')
}

function stop() {
  screenShareData.value = undefined
  cleanUp()
  emit('stop')
}
</script>

<template>
  <RemoteViewer
    v-show="screenShareData"
    :data="screenShareData"
    @stop="stop"
  />
  <div 
    v-if="!screenShareData"
    class="content-wrapper"
  >
    <div class="section-content">
      <div class="text-center">
        <div class="panel">
          <RequestAccess
            :contact="contact"
            @accepted="screenShareData = $event"
            @denied="stop"
            @stop="stop"
          />
        </div>
      </div>
    </div>
  </div>
</template>