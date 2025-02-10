<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import Signal from "../../components/Signal.vue"
import Cursor from "../../components/Cursor.vue"

import { useDrawOverlay } from '../../composables/useDrawOverlay'
import { useOverlayCursors } from '../../composables/useOverlayCursors'
import { useOverlaySignals } from '../../composables/useOverlaySignals'

import { UserData } from '../../../interface'

const canvasRef = useTemplateRef('canvas')
const scale = ref(1)
const mouseEnabled = ref(false)
const users = ref<UserData[]>([])
const mappedUsers = computed(() => {
  const mappedUsers: Record<string, UserData> = {}
  for (const user of users.value)
    mappedUsers[user.id] = user

  return mappedUsers
})

const drawOverlay = useDrawOverlay(canvasRef, { users: mappedUsers, scale })
const overlayCursors = useOverlayCursors(mappedUsers)
const overlaySignals = useOverlaySignals(mappedUsers)
watch(mouseEnabled, () => {
  overlayCursors.clear(true)
  overlaySignals.clear()
})

window.electronAPI!.onUpdateOverlayData((data) => {
  data.users && (users.value = data.users)
  data.scale && (scale.value = data.scale)
  data.mouseEnabled && (mouseEnabled.value = data.mouseEnabled)
})

window.electronAPI!.onMouseClick((data) => {
  overlaySignals.send(data.userId, data.x, data.y)
})

window.electronAPI!.onMouseDown((data) => {
  drawOverlay.startStroke(data.userId, [data.x, data.y])
})

window.electronAPI!.onMouseMove((data) => {
  drawOverlay.continueStroke(data.userId, [data.x, data.y])
  overlayCursors.move(data.userId, data.x, data.y)
})

window.electronAPI!.onMouseUp((data) => {
  drawOverlay.endStroke(data.userId)
})
</script>

<template>
  <Cursor
    v-for="(cursor, cursorId) in overlayCursors.cursors"
    :key="cursorId"
    v-bind="cursor"
    :scale="scale"
  />
  <Signal v-for="(signal, signalId) in overlaySignals.signals" :key="signalId" v-bind="signal" :scale="scale" />
  <canvas ref="canvas" />
</template>

<style>
html {
  background: transparent !important;
}

body, #overlay {
  border: 0px;
  margin: 0px;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent !important;
}

#overlay {
  border: 3px solid hsla(0, 100%, 50%, 0.75);
  width: 100vw;
  height: 100vh;
  animation: pulse 2s ease-in-out;
}

canvas {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100;
  width: 100%;
  height: 100%;
}

@keyframes pulse {
  0% { border-color: hsla(0, 100%, 50%, 0.1); }
  50% { border-color: hsla(0, 100%, 50%, 0.75); }
  100% { border-color: hsla(0, 100%, 50%, 0.1); }
}
</style>
