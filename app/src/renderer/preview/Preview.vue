<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import StreamOverlay from '../views/viewer/StreamOverlay.vue'
import Toolbar from '../components/Toolbar.vue'
import { ScreenShareData, ScreenView, useScreenView } from '../composables/useSimplePeerScreenShare'
import { ScaleInfo, VideoTransform } from '../types'
import { RemoteEvent, RemoteData } from '../../interface'

const screenShareData = ref<ScreenShareData>()
const videoRef = useTemplateRef('video')
const containerRef = useTemplateRef('container')
const overlayRef = useTemplateRef('overlay')
const screenView = ref<ScreenView>()
const users = computed(() => screenView.value?.users ?? [])

async function startPreview() {
  const params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')
  
  screenShareData.value = JSON.parse(atob(data)) as ScreenShareData
  screenView.value = await useScreenView(screenShareData.value, {
    videoElement: videoRef.value ?? undefined,
    onRemote: (event, data) => {
      let parsedData = data
      if (typeof data === 'string' && event !== 'reset') {
        try {
          parsedData = JSON.parse(data)
        } catch (err) {
          console.error('Failed to parse remote control data:', err)
          return
        }
      }

      receive(event, parsedData)
    }
  })
}

const videoStyle = ref<Record<string, string>>({
  transform: 'scale(1) translate(0px,0px)',
})
const containerStyle = ref<Record<string, string>>({
  overflow: 'hidden',
  width: '800px',
  height: '600px',
})
const videoTransform = ref<VideoTransform>()

function rescale(scaleinfo: ScaleInfo) {
  const containerRect = containerRef.value!.getBoundingClientRect()
  const currentHeight = Math.round(containerRect.height)
  const currentWidth = Math.round(containerRect.width)

  let scaledowny = 1
  let scaledownx = 1
  if (scaleinfo.height > window.innerHeight)
    scaledowny = window.innerHeight / scaleinfo.height
  if (scaleinfo.width > window.innerWidth)
    scaledownx = window.innerWidth / scaleinfo.width

  let scaledown = scaledowny < scaledownx ? scaledowny : scaledownx
  
  if (scaleinfo.height != currentHeight || scaleinfo.width != currentWidth) {
    containerStyle.value.height = scaleinfo.height * scaledown + 'px'
    containerStyle.value.width = scaleinfo.width * scaledown + 'px'
  }

  containerStyle.value.overflow = 'visible'
  videoStyle.value.transform = `scale(${scaleinfo.scale}) translate(${scaleinfo.x}px,${scaleinfo.y}px)`

  nextTick(() => {  
    const containerRect = containerRef.value!.getBoundingClientRect()
    const videoRect = videoRef.value!.getBoundingClientRect()
    videoTransform.value = {
      x: Math.round(videoRect.left),
      y: Math.round(videoRect.top),
      fullwidth: Math.round(videoRect.right - videoRect.left),
      fullheight: Math.round(videoRect.bottom - videoRect.top),
      width: Math.round(containerRect.right - containerRect.left),
      height: Math.round(containerRect.bottom - containerRect.top)
    }
  })
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
}

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

const receiveEvents: Partial<ReceiveEventHandlers> = {}

onReceive("mouse-leftclick", (data) => {
  overlayRef.value?.receiveMouseLeftClick(data)
})

onReceive("mouse-move", (data) => {
  overlayRef.value?.receiveMouseMove(data)
})

onReceive("mouse-down", (data) => {
  overlayRef.value?.receiveMouseDown(data)
})

onReceive("mouse-up", (data) => {
  overlayRef.value?.receiveMouseUp(data)
})

onReceive('reset', (data) => {
  overlayRef.value?.reset(data)
})

function send<T extends RemoteEvent>(event: T, data: RemoteData<T>, options: SendOptions = {}) {
  screenView.value?.sendRemote(event, data)
  if (options.receiveSelf)
    receive(event, data)
}

function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
  receiveEvents[event]?.(data)
}

function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
  receiveEvents[event] = handler as ReceiveEventHandlers[T]
}
</script>

<template>
  <div>
    <Toolbar v-if="!screenView">
      <button class="btn btn-primary" @click="startPreview">Start Preview</button>
    </Toolbar>
    <div ref="container" class="preview-container">
      <video ref="video" muted />
      <StreamOverlay
        v-if="screenShareData && screenView"
        ref="overlay"
        :input-enabled="false"
        :users="users"
        :user-id="screenShareData.user.id"
        :video-transform="videoTransform"
        mouse-enabled
        @rescale="rescale"
        @send="send($event.event, $event.data, $event.options)"
      />
    </div>
  </div>
</template>

<style>
video {
  max-width: 100%;
  max-height: 100%;
}
</style>
