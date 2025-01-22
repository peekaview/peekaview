<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRef, useTemplateRef, watch } from 'vue'

import SignalContainer from "./SignalContainer.vue"

import CursorPng from '../../../assets/img/cursor.png'

import { useDrawOverlay } from '../../composables/useDrawOverlay'
import { usePanzoom } from './usePanzoom'
import { Dimensions, RemoteData, RemoteEvent, RemoteMouseData, RemoteResetData, UserData } from '../../../interface'
import { ScaleInfo, Signal, VideoTransform } from '../../types'
import { useKeyListeners } from './useEventListeners'

type Cursor = {
  name?: string
  color: string
  left: string
  top: string
  lastAction: number
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
}

const props = withDefaults(defineProps<{
  inputEnabled?: boolean
  mouseEnabled: boolean
  remoteControlActive?: boolean
  draggingOver?: boolean
  users: UserData[]
  userId: string
  videoTransform?: VideoTransform
}>(), {
  inputEnabled: true,
  draggingOver: false,
  remoteControlActive: false,
  users: () => [],
  videoTransform: () => ({ x: 0, y: 0, width: 0, height: 0, fullwidth: 0, fullheight: 0 }),
})

const emit = defineEmits<{
  (e: 'rescale', scaleinfo: ScaleInfo): void
  (e: 'mouse-inside', inside: boolean): void
  (e: 'synchronized'): void
  <T extends RemoteEvent>(e: 'send', data: { event: T, data: RemoteData<T>, options: SendOptions }): void
}>()

watch(() => props.mouseEnabled, () => clearMouseCursors(true))

const isSharingScreen = ref(true)
const mappedUsers = computed(() => {
  const users: Record<string, UserData> = {}
  for (const user of props.users)
    users[user.id] = user

  return users
})

// Skalierungsinfos
const videoScale = ref(1)
const remoteScale = ref(1)
const totalScale = computed(() => videoScale.value * remoteScale.value)

const sharerToolbarBoundsStyle = ref<Record<string, string> | undefined>()

const overlayRef = useTemplateRef('overlay')
const canvasRef = useTemplateRef('canvas')
const drawOverlay = useDrawOverlay(canvasRef, {
  scale: totalScale,
  dimensions: computed(() => props.videoTransform ? [props.videoTransform!.fullwidth, props.videoTransform!.fullheight] : undefined),
  users: mappedUsers
})

const { pressed, onKeyDown, onKeyUp } = useKeyListeners(key => emit('send', { event: "type", data: { key }, options: { receiveSelf: true, volatile: true } }), toRef(props.inputEnabled))

// Websocket-Message Object
let currentMouseData: RemoteMouseData = {
  x: 0,
  y: 0,
  userId: props.userId,
  draw: false
}
let lastMouseData: RemoteMouseData

let isMouseDown = false
let isMouseDragging = false
let synchronized = false

// Maus-Overlays
const signals = reactive<Record<string, Signal>>({})
const overlayCursors = reactive<Record<string, Cursor>>({})
window.setInterval(() => clearMouseCursors(), 1000)

const windowDimensions = reactive({ width: 0, height: 0 })
const { currentPan, currentPanScale, zoom, doZoom, onPanzoomChange } = usePanzoom(overlayRef, toRef(pressed.space), toRef(props.inputEnabled))

const scaleInfo = computed(() => ({
  x: currentPan.x,
  y: currentPan.y,
  scale: currentPanScale.value,
  width: windowDimensions.width,
  height: windowDimensions.height
}))

watch(scaleInfo, () => updateVideoScale(scaleInfo.value))

const overlayStyle = computed(() => {
  const style = {
    border: '1px solid blue',
    // Bei Screensharing sieht man den Remotemauszeiger, daher den eigenen durch ein feines Crosshair ersetzen
    cursor: isSharingScreen.value ? 'url(img/minicrosshair.png) 5 5, auto' : 'default',
    width: '0',
    height: '0',
    left: '0',
    top: '0',
  }
  if (props.videoTransform) {
    style.width = props.videoTransform.width + "px"
    style.height = props.videoTransform.height + "px"
    //style.left = Math.round((props.videoTransform.x - 2) - (props.videoTransform.fullwidth / props.videoTransform.width * lastPan.x) + ((props.videoTransform.fullwidth - props.videoTransform.width) / 2)) + "px"
    //style.top = Math.round((props.videoTransform.y - 2) - (props.videoTransform.fullwidth / props.videoTransform.width * lastPan.y) + ((props.videoTransform.fullheight - props.videoTransform.height) / 2)) + "px"
  }
  return style
})

function receiveMouseLeftClick(data: RemoteMouseData) {
  drawOverlay.endStroke(data.userId)
  if (props.remoteControlActive && data.draw && isSharingScreen.value)
    return

  const user = mappedUsers.value[data.userId]
  if (signals[user.id])
    return

  signals[user.id] = {
    color: user.color,
    left: Math.round(data.x * totalScale.value),
    top: Math.round(data.y * totalScale.value),
  }

  setTimeout(() => {
    if (signals[user.id])
      delete signals[user.id]
  }, 2000)
}

function receiveMouseMove(data: RemoteMouseData) {
  if (!props.remoteControlActive || data.draw) {
    drawOverlay.continueStroke(data.userId, [data.x, data.y])
  }

  if (!synchronized || data.userId === props.userId)
    return

  const user = mappedUsers.value[data.userId]
  if (!overlayCursors[user.id]) {
    overlayCursors[user.id] = {
      name: user.name,
      color: user.color,
      left: '0',
      top: '0',
      lastAction: 0
    }
  }

  overlayCursors[user.id].left = Math.round(data.x * totalScale.value) + "px"
  overlayCursors[user.id].top = Math.round(data.y * totalScale.value) + "px"
  overlayCursors[user.id].lastAction = Date.now()
}

function receiveMouseDown(data: RemoteMouseData) {
  if ((!props.remoteControlActive && !props.draggingOver) || data.draw)
    drawOverlay.startStroke(data.userId, [data.x, data.y])
}

function receiveMouseUp(data: RemoteMouseData) {
  drawOverlay.endStroke(data.userId)
}

function clearMouseCursors(instant = false) {
  for (const id in overlayCursors) {
    if (instant || overlayCursors[id].lastAction < (Date.now() - 10000))
      delete overlayCursors[id]
  }
}

let lastWheel = 0
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || !props.inputEnabled)
    return

  if (lastWheel < (Date.now() - 200)) {
    console.log(e)
    currentMouseData.delta = e.deltaY
    lastWheel = Date.now()
    emit('send', { event: "mouse-wheel", data: currentMouseData, options: { receiveSelf: true } })
  }

  doZoom(e.deltaY)
}

let eventToSend: number | undefined
let lastMouseDown = 0
let moveHandler: ((event: MouseEvent) => void) | undefined
function onMouseUp() {
  if (!props.mouseEnabled || !props.inputEnabled)
    return

  if (moveHandler !== undefined) {
    document.removeEventListener('mousemove', moveHandler)
    moveHandler = undefined
  }
  if (eventToSend !== undefined) {
    clearTimeout(eventToSend)
    eventToSend = undefined
  }

  if (isMouseDown || isMouseDragging) {
    console.log("mouse-up")
    emit('send', { event: "mouse-up", data: { ...currentMouseData, draw: pressed.control }, options: { receiveSelf: true, volatile: true } })
  } else {
    console.log("mouse-leftclick")
    emit('send', { event: "mouse-leftclick", data: { ...lastMouseData, draw: pressed.control }, options: { receiveSelf: true, volatile: true } })
  }

  isMouseDown = false
  lastMouseDown = 0
}

function onMouseDown(e: MouseEvent) {
  if (!props.mouseEnabled || !props.inputEnabled)
    return

  console.log("mouse-down", e.which, lastMouseDown)
  if (e.which == 3) {
    isMouseDown = false
    lastMouseDown = 0
    console.log("mouse-rightclick")
    emit('send', { event: "mouse-click", data: currentMouseData, options: { receiveSelf: true, volatile: true } })
  } else if (lastMouseDown === 0) {
    isMouseDragging = false
    lastMouseDown = Date.now()
    isMouseDown = false

    // Store initial cursor position
    const initialX = e.clientX
    const initialY = e.clientY

    // Add mousemove handler to check distance
    moveHandler = (moveEvent) => {
      const deltaX = moveEvent.clientX - initialX
      const deltaY = moveEvent.clientY - initialY
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      
      if (distance > 5) {
        // Clear the delayed event since we're sending immediately
        clearTimeout(eventToSend)
        eventToSend = undefined
        isMouseDragging = true
        isMouseDown = true
        
        console.log("mouse-down (immediate due to movement)")
        emit('send', { event: "mouse-down", data: { ...lastMouseData, draw: pressed.control }, options: { receiveSelf: true, volatile: true } })
        
        // Remove this handler since we've triggered the event
        moveHandler && document.removeEventListener('mousemove', moveHandler)
        moveHandler = undefined
      }
    }
    
    document.addEventListener('mousemove', moveHandler)
    
    eventToSend = window.setTimeout(() => {
      isMouseDown = true
      console.log("mouse-down")
      emit('send', { event: "mouse-down", data: { ...lastMouseData, draw: pressed.control }, options: { receiveSelf: true, volatile: true } })
    }, 120)
  }

  lastMouseData = currentMouseData
}

let lastPosX = 0
let lastPosY = 0
let lastMove = 0
function onMouseMove(e: MouseEvent) {
  if (!props.mouseEnabled || !props.inputEnabled || !synchronized)
    return false

  emit('mouse-inside', true)

  const rect = overlayRef.value!.getBoundingClientRect()
  const x = e.pageX - rect.left
  const y = e.pageY - rect.top

  currentMouseData = {
    x: Math.round(x / (totalScale.value * (zoom.value?.scale ?? 1))),
    y: Math.round(y / (totalScale.value * (zoom.value?.scale ?? 1))),
    userId: props.userId,
    draw: pressed.control,
  }

  if ((lastMouseDown > 0 && lastMove < Date.now() - 10) || 
    (lastMove < Date.now() - 100) ||
    (lastMove < Date.now() - 50 && (Math.abs(lastPosX - x) < 3 || Math.abs(lastPosY - y) < 3))) {
    lastMove = Date.now()
    emit('send', { event: "mouse-move", data: currentMouseData, options: { receiveSelf: true, volatile: true } })
  }

  lastPosX = x
  lastPosY = y

  e.preventDefault()
  return false
}

function onMouseEnter() {
  if (!props.inputEnabled)
    return

  emit('mouse-inside', true)
}

function onMouseLeave() {
  if (!props.inputEnabled)
    return

  emit('mouse-inside', false)
  if (lastMouseDown > 0) {
    emit('send', { event: "mouse-up", data: currentMouseData, options: { receiveSelf: true, volatile: true } })
    clearTimeout(eventToSend)
    eventToSend = undefined
    lastMouseDown = 0
  }
}

let lastScaleInfo: ScaleInfo | undefined
function updateVideoScale(scaleInfo: ScaleInfo) {
  if (!lastScaleInfo || scaleInfo.x != lastScaleInfo.x || scaleInfo.y != lastScaleInfo.y || scaleInfo.scale != lastScaleInfo.scale || scaleInfo.width != lastScaleInfo.width || scaleInfo.height != lastScaleInfo.height) {
    console.debug('updateVideoScale', scaleInfo)
    emit('rescale', scaleInfo)
  }
  lastScaleInfo = scaleInfo
}

function calcScale() {
  const scaleX = overlayRef.value!.getBoundingClientRect().width / props.videoTransform.width
  const scaleY = overlayRef.value!.getBoundingClientRect().height / props.videoTransform.height

  videoScale.value = scaleX < scaleY ? scaleX : scaleY
  if (videoScale.value > 1) {
    videoScale.value = 1
  }

  emit('rescale', scaleInfo.value)
}

let lastDimensions: Dimensions
function reset(data: RemoteResetData) {
  isSharingScreen.value = data.isScreen

  const remoteScaleHeight = props.videoTransform.height / (data.dimensions.bottom - data.dimensions.top)
  const remoteScaleWidth = props.videoTransform.width / (data.dimensions.right - data.dimensions.left)
  remoteScale.value = remoteScaleHeight < remoteScaleWidth ? remoteScaleHeight : remoteScaleWidth

  // Speichern der Fensterabmessungen
  windowDimensions.width = data.dimensions.right - data.dimensions.left
  windowDimensions.height = data.dimensions.bottom - data.dimensions.top

  sharerToolbarBoundsStyle.value = (isSharingScreen.value && data.toolbarBounds) ? {
    left: totalScale.value * (data.toolbarBounds.x - data.dimensions.left) + "px",
    top: totalScale.value * (data.toolbarBounds.y - data.dimensions.top) + "px",
    width: totalScale.value * data.toolbarBounds.width + "px",
    height: totalScale.value * data.toolbarBounds.height + "px"
  } : undefined

  // Skalierungsinfos und Mauszeigerposition mit Remote-App synchronisiert
  synchronized = !!lastDimensions && lastDimensions.left == data.dimensions.left && lastDimensions.right == data.dimensions.right && lastDimensions.top == data.dimensions.top && lastDimensions.bottom == data.dimensions.bottom
  calcScale()
  if (synchronized)
    emit('synchronized')

  lastDimensions = data.dimensions
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onMouseLeave)
  window.addEventListener('resize', calcScale)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onMouseLeave)
  window.removeEventListener('resize', calcScale)
})

defineExpose({
  reset,
  receiveMouseLeftClick,
  receiveMouseMove,
  receiveMouseDown,
  receiveMouseUp,
})
</script>

<template>
  <div
    ref="overlay"
    class="stream-overlay"
    :style="overlayStyle"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mousedown="onMouseDown"
    @wheel="onWheel"
    @panzoomchange="onPanzoomChange"
    @contextmenu="() => false"
  >
    <div v-for="(cursor, cursorId) in overlayCursors" :key="cursorId" class="cursor" :style="{ left: cursor.left, top: cursor.top }">
      <img :src="CursorPng"/>
      <div v-if="cursorId !== userId && cursor.name" class="cursor-name" :style="{ border: `1px solid #${cursor.color}`, color: `#${cursor.color}` }"> {{ cursor.name }}</div>
    </div>
    <SignalContainer v-for="(signal, signalId) in signals" :key="signalId" :signal="signal" />
    <canvas ref="canvas" />
    <div v-if="inputEnabled && sharerToolbarBoundsStyle" class="sharer-toolbar-bounds" :style="sharerToolbarBoundsStyle"></div>
  </div>
</template>

<style>
.stream-overlay {
  margin: 0px;
  padding: 0px;
  z-index: 99;
  position: absolute;
}

.stream-overlay .cursor {
  transition: all 0.05s ease-out;
  pointer-events: none;
  float: left;
  width: 300px;
  position: absolute;
  z-index: 99;
}

.stream-overlay .cursor img {
  float: left;
  height: 25px;
  width: 25px;
}

.stream-overlay .cursor .cursor-name {
  float: left;
  width: auto;
  margin-left: 10px;
  margin-top: 10px;
  background: white;
  font-size: 12px;
  padding: 4px;
}

.stream-overlay canvas {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100;
  width: 100%;
  height: 100%;
}

.stream-overlay .sharer-toolbar-bounds {
  position: absolute;
  z-index: 100;
  background: repeating-linear-gradient(-45deg, #222, #333 15px, #aa0 15px, #cc0 20px);
}
</style>