<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useDrawOverlay } from '../../composables/useDrawOverlay'

const canvasRef = useTemplateRef('canvas')
const drawOverlay = useDrawOverlay(canvasRef)

window.electronAPI!.onMouseDown((data) => {
  drawOverlay.startStroke(data.id, [data.x, data.y])
})

window.electronAPI!.onMouseMove((data) => {
  drawOverlay.continueStroke(data.id, data.color, [data.x, data.y])
})

window.electronAPI!.onMouseUp((data) => {
  drawOverlay.endStroke(data.id)
})
</script>

<template>
  <canvas ref="canvas" />
</template>

<style>
body, #draw-overlay {
  border: 0px;
  margin: 0px;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

canvas {
  width: 100%;
  height: 100%;
}
</style>
