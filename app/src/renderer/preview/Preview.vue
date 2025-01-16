<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'

import Toolbar from '../components/Toolbar.vue'
import { ScreenShareData, ScreenView, useScreenView } from '../composables/useSimplePeerScreenShare';

const videoRef = useTemplateRef('video')
const screenView = ref<ScreenView>()

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')
  
  screenView.value = await useScreenView(JSON.parse(atob(data)) as ScreenShareData, {
    role: 'preview',
    videoElement: videoRef.value ?? undefined
  })
})
</script>

<template>
  <div>
    <Toolbar collapsible>
      <div class="btn">
      </div>
    </Toolbar>
    <video ref="video" />
  </div>
</template>
