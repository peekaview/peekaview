<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'

import { useDrawOverlay } from '../composables/useDrawOverlay'
import { UserData } from '../../interface'

const canvasRef = useTemplateRef('canvas')
const users = ref<UserData[]>([])
const mappedUsers = computed(() => {
  const mappedUsers: Record<string, UserData> = {}
  for (const user of users.value)
    mappedUsers[user.id] = user

  return mappedUsers
})

const drawOverlay = useDrawOverlay(canvasRef, { users: mappedUsers })

window.electronAPI!.onUpdateUsers((data) => {
  window.electronAPI?.log("onUpdateUsers", data)
  users.value = data
})

window.electronAPI!.onMouseDown((data) => {
  window.electronAPI?.log("onMouseDown", data)
  drawOverlay.startStroke(data.userId, [data.x, data.y])
})

window.electronAPI!.onMouseMove((data) => {
  drawOverlay.continueStroke(data.userId, [data.x, data.y])
})

window.electronAPI!.onMouseUp((data) => {
  drawOverlay.endStroke(data.userId)
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
