<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, useTemplateRef, watch } from 'vue'

import Signal from "../../components/Signal.vue"
import Cursor from "../../components/Cursor.vue"

import { useDrawOverlay } from '../../composables/useDrawOverlay'
import { RemoteData, RemoteEvent, RemoteMouseData, RemoteResetData, UserData, ViewerTool, Rectangle, Size } from '../../../interface'
import { useKeyListeners } from './useEventListeners'
import { useOverlayCursors } from '../../composables/useOverlayCursors'
import { useOverlaySignals } from '../../composables/useOverlaySignals'
import { SendOptions } from '../../composables/useRemoteHandlers'

import MiniCrosshairPng from '../../../assets/img/minicrosshair.png'

type VideoOptions = {
  muted?: boolean
  playsinline?: boolean
  autoplay?: boolean
  fill?: boolean
}

const props = withDefaults(defineProps<{
  stream?: MediaStream
  inputEnabled?: boolean
  pointerEnabled: boolean
  activeTool?: ViewerTool | undefined
  users: UserData[]
  userId: string
  zoomScale?: number
  shutterActive?: boolean
  useVeil?: boolean
  videoOptions?: VideoOptions
  freezeOnInteraction?: boolean
}>(), {
  inputEnabled: true,
  activeTool: undefined,
  users: () => [],
  zoomScale: 1,
  shutterActive: false,
  useVeil: false,
  videoOptions: undefined,
  freezeOnInteraction: false,
})

const emit = defineEmits<{
  (e: 'mouse-inside', inside: boolean): void
  (e: 'on-stream-size-change', size: Size): void
  (e: 'panzoom-toggle', active: boolean): void
  <T extends RemoteEvent>(e: 'send', data: { event: T, data: RemoteData<T>, options: SendOptions }): void
}>()

watch(() => props.stream, (stream) => {
  if (!stream || !videoRef.value)
    return

  videoRef.value.srcObject = stream
  setTimeout(() => {
    videoRef.value!.play().catch(err => {
      console.error('Error playing video:', err)
    })
    updateVideoTransform()
  }, 2500)
})

const videoTransform = ref<Rectangle>({ x: 0, y: 0, width: 0, height: 0 })
const isSharingScreen = ref(true)
const mappedUsers = computed(() => {
  const users: Record<string, UserData> = {}
  for (const user of props.users)
    users[user.id] = user

  return users
})

const streamSize = ref<Size>({ width: 0, height: 0 })
watch(streamSize, () => emit('on-stream-size-change', streamSize.value))

const scale = computed(() => {
  if (!streamSize.value.height || !streamSize.value.width)
    return 1

  const height = videoTransform.value.height / streamSize.value.height
  const width = videoTransform.value.width / streamSize.value.width
  return height < width ? height : width
})

const overlayStyle = computed(() => ({
  cursor: isSharingScreen.value ? `url(${MiniCrosshairPng}) 5 5, auto` : 'default',
  width: videoTransform.value?.width ?? '0px',
  height: videoTransform.value?.height ?? '0px',
}))

const coverBounds = ref<Record<string, string>[]>()

const overlayRef = useTemplateRef('overlay')
const canvasRef = useTemplateRef('canvas')
const videoRef = useTemplateRef('video')
const drawOverlay = useDrawOverlay(canvasRef, {
  scale,
  dimensions: computed(() => videoTransform.value ? [videoTransform.value.width, videoTransform.value.height] : undefined),
  users: mappedUsers
})

const overlayCursors = useOverlayCursors(mappedUsers)
const overlaySignals = useOverlaySignals(mappedUsers)
window.setInterval(() => overlayCursors.clear(), 1000)
watch(() => props.pointerEnabled, () => {
  //overlayCursors.clear(true)
  overlaySignals.clear()
})

const { pressed, onKeyDown, onKeyUp } = useKeyListeners(key => emit('send', { event: "key-down", data: { key, tool: props.activeTool }, options: { receiveSelf: true, volatile: true } }), toRef(props.inputEnabled))
watch(() => pressed.shift, (shift) => {
  emit('panzoom-toggle', shift)
}, { immediate: true })

let currentMouseData: RemoteMouseData = {
  x: 0,
  y: 0,
  userId: props.userId,
  tool: props.activeTool
}
let lastMouseData: RemoteMouseData
watch(() => props.activeTool, () => {
  currentMouseData.tool = props.activeTool
})

let isMouseDown = false
let isMouseDragging = false

let freezeThrottling = false
function freezeVideo() { // prevent viewer from seeing the maximized browser preventer
  if (freezeThrottling || !props.freezeOnInteraction)
    return

  freezeThrottling = true
  window.setTimeout(() => freezeThrottling = false, 5000)

  videoRef.value?.pause()
  window.setTimeout(() => {
    videoRef.value?.play()
  }, 3500)
}

function receiveMouseLeftClick(data: RemoteMouseData) {
  drawOverlay.endStroke(data.userId)
  if (data.tool === 'pointer') {
    overlaySignals.send(data.userId, data.x, data.y)
    freezeVideo()
  }
}

function receiveMouseMove(data: RemoteMouseData) {
  if (data.tool === 'pointer')
    drawOverlay.continueStroke(data.userId, [data.x, data.y])

  if (data.userId !== props.userId)
    overlayCursors.move(data.userId, data.x, data.y)
}

function receiveMouseDown(data: RemoteMouseData) {
  if (data.tool === 'pointer')
    drawOverlay.startStroke(data.userId, [data.x, data.y])
}

function receiveMouseUp(data: RemoteMouseData) {
  drawOverlay.endStroke(data.userId)
  if (data.tool === 'pointer')
    freezeVideo()
}

let lastWheel = 0
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey || !e.shiftKey || !props.inputEnabled)
    return

  if (lastWheel < (Date.now() - 200)) {
    currentMouseData.delta = e.deltaY
    lastWheel = Date.now()
    emit('send', { event: "mouse-wheel", data: currentMouseData, options: { receiveSelf: true } })
  }
}

let eventToSend: number | undefined
let lastMouseDown = 0
let moveHandler: ((event: MouseEvent) => void) | undefined
function onMouseUp() {
  if (!props.inputEnabled)
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
    emit('send', { event: "mouse-up", data: { ...currentMouseData }, options: { receiveSelf: true, volatile: true } })
  } else {
    console.log("mouse-leftclick")
    emit('send', { event: "mouse-leftclick", data: { ...lastMouseData }, options: { receiveSelf: true, volatile: true } })
  }

  isMouseDown = false
  lastMouseDown = 0
}

function onMouseDown(e: MouseEvent) {
  if (!props.inputEnabled)
    return

  if (e.which == 3) {
    isMouseDown = false
    lastMouseDown = 0
    console.log("mouse-rightclick")
    emit('send', { event: "mouse-click", data: { ...currentMouseData }, options: { receiveSelf: true, volatile: true } })
  } else if (lastMouseDown === 0) {
    isMouseDragging = false
    lastMouseDown = Date.now()
    isMouseDown = false

    const initialX = e.clientX
    const initialY = e.clientY

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
        emit('send', { event: "mouse-down", data: { ...lastMouseData }, options: { receiveSelf: true, volatile: true } })
        
        // Remove this handler since we've triggered the event
        moveHandler && document.removeEventListener('mousemove', moveHandler)
        moveHandler = undefined
      }
    }
    
    document.addEventListener('mousemove', moveHandler)
    
    eventToSend = window.setTimeout(() => {
      isMouseDown = true
      console.log("mouse-down")
      emit('send', { event: "mouse-down", data: { ...lastMouseData }, options: { receiveSelf: true, volatile: true } })
    }, 120)
  }

  lastMouseData = currentMouseData
}

let lastPosX = 0
let lastPosY = 0
let lastMove = 0
function onMouseMove(e: MouseEvent) {
  if (!props.inputEnabled)
    return false

  emit('mouse-inside', true)

  const rect = overlayRef.value!.getBoundingClientRect()
  const x = e.pageX - rect.left
  const y = e.pageY - rect.top

  const totalScale = scale.value * (props.zoomScale ?? 1)
  currentMouseData = {
    x: Math.round(x / totalScale),
    y: Math.round(y / totalScale),
    userId: props.userId,
    tool: props.activeTool
  }

  if ((lastMouseDown > 0 && lastMove < Date.now() - 10) || 
    (lastMove < Date.now() - 100) ||
    (lastMove < Date.now() - 50 && (Math.abs(lastPosX - x) < 3 || Math.abs(lastPosY - y) < 3))) {
    lastMove = Date.now()
    emit('send', { event: "mouse-move", data: { ...currentMouseData }, options: { receiveSelf: true, volatile: true } })
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
    emit('send', { event: "mouse-up", data: { ...currentMouseData }, options: { receiveSelf: true, volatile: true } })
    clearTimeout(eventToSend)
    eventToSend = undefined
    lastMouseDown = 0
  }
}

function updateVideoTransform() {
  if (!videoRef.value)
    return

  const rect = videoRef.value.getBoundingClientRect()
  const x = Math.round(rect.left)
  const y = Math.round(rect.top)
  const width = Math.round(rect.right - rect.left)
  const height = Math.round(rect.bottom - rect.top)
  if (x === videoTransform.value.x && y === videoTransform.value.y && width === videoTransform.value.width && height === videoTransform.value.height)
    return

  videoTransform.value = { x, y, width, height }
}

function reset(data: RemoteResetData) {
  isSharingScreen.value = data.isScreen

  streamSize.value = {
    width: data.dimensions.right - data.dimensions.left,
    height: data.dimensions.bottom - data.dimensions.top
  }

  coverBounds.value = data.coverBounds.map(bound => ({
    left: scale.value * (bound.x - data.dimensions.left) + "px",
    top: scale.value * (bound.y - data.dimensions.top) + "px",
    width: scale.value * bound.width + "px",
    height: scale.value * bound.height + "px"
  }))
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onMouseLeave)
  window.addEventListener('resize', updateVideoTransform)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onMouseLeave)
  window.removeEventListener('resize', updateVideoTransform)
})

defineExpose({
  videoRef,
  reset,
  receiveMouseLeftClick,
  receiveMouseMove,
  receiveMouseDown,
  receiveMouseUp,
})
</script>

<template>
  <div class="stream-container">
    <video ref="video" :muted="videoOptions?.muted" :playsinline="videoOptions?.playsinline" :autoplay="videoOptions?.autoplay" :style="{ 'object-fit': videoOptions?.fill? 'fill' : 'cover' }"/>
    <div v-if="useVeil" class="veil" />
    <div
      ref="overlay"
      class="overlay"
      :style="overlayStyle"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mousedown="onMouseDown"
      @wheel="onWheel"
    >
      <canvas ref="canvas" />
      <Signal v-for="(signal, signalId) in overlaySignals.signals" :key="signalId" v-bind="signal" :scale="scale" />
      <Cursor
        v-for="(cursor, cursorId) in overlayCursors.cursors"
        :key="cursorId"
        v-bind="cursor"
        :scale="scale"
        :is-self="cursorId === userId"
      />
      <template v-if="isSharingScreen">
        <div v-for="bound in coverBounds" class="cover-bounds" :style="bound"></div>
      </template>
    </div>
    <div v-if="shutterActive" class="shutter" />
  </div>
</template>

<style>
.stream-container {
  position: relative;
  flex-grow: 1;
  min-height: 0;
}

.stream-container .veil {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: #8884;
  z-index: 500;
}

.stream-container .shutter {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  z-index: 1500;
}

.stream-container .overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
}

.stream-container .overlay canvas {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100;
  width: 100%;
  height: 100%;
}

.stream-container .overlay .cover-bounds {
  position: absolute;
  z-index: 1100;
  background: repeating-linear-gradient(-45deg, #222, #333 15px, #884 15px, #aa4 20px);
  filter: blur(2px);
}
</style>