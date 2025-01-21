<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

import Toolbar from '../components/Toolbar.vue'
import { ScreenShareData, ScreenView, useScreenView } from '../composables/useSimplePeerScreenShare'
import { useDrawOverlay } from '../composables/useDrawOverlay'

const videoRef = useTemplateRef('video')
const canvasRef = useTemplateRef('canvas')
const screenView = ref<ScreenView>()

const drawOverlay = useDrawOverlay(canvasRef)

async function startPreview() {
  const params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')
  
  screenView.value = await useScreenView(JSON.parse(atob(data)) as ScreenShareData, {
    role: 'preview',
    videoElement: videoRef.value ?? undefined,
    onRemote: (event, data) => {
      console.log('remote', event, data)
    }
  })
}
</script>

<template>
  <div>
    <Toolbar collapsible>
      <button v-if="!screenView" class="btn btn-primary" @click="startPreview">Start Preview</button>
    </Toolbar>
    <video ref="video" />
    <canvas ref="canvas" />
  </div>
</template>

<style>
video {
  max-width: 100%;
  max-height: 100%;
}
</style>
