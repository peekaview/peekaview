<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RemoteViewer from './RemoteViewer.vue'

import type { RemoteControlData, ScaleInfo, ScreenShareData, VideoTransform } from '../../types'
import { notify, stringToColor } from '../../util'
import { ScreenView, useScreenView } from '../../composables/useSimplePeerScreenShare'

const props = withDefaults(defineProps<{
  data?: ScreenShareData
}>(), {
  data: undefined
})

const emit = defineEmits<{
  (e: 'stop'): void
  (e: 'toggle-full-video', active: boolean): void
}>()

const { t } = useI18n()

const screenView = ref<ScreenView>()
const remoteControlData = ref<RemoteControlData>()
const remoteViewerRef = useTemplateRef('remoteViewer')
const trackRef = useTemplateRef('track')
const trackStyle = ref<Record<string, string>>({
  transform: 'scale(1) translate(0px,0px)',
})
const containerRef = useTemplateRef('container')
const containerStyle = ref<Record<string, string>>({
  overflow: 'hidden',
  width: '800px',
  height: '600px',
})
const viewerStyle = ref<Record<string, string>>({
  top: '0px',
  left: '0px',
  minWidth: '100vw',
  minHeight: '100vh',
  width: '100%',
  height: '100%',
})
const videoTransform = ref<VideoTransform>()

watch(() => props.data, async (screenShareData) => {
  if (!screenShareData) {
    containerStyle.value.overflow = 'hidden'
    screenView.value = undefined
    return
  }

  screenView.value = await useScreenView(screenShareData, {
    videoElement: trackRef.value ?? undefined,
    onRemote: (event, data) => {
      if (event === 'enable') {
        remoteControlData.value = {
          roomid: screenShareData.roomName,
          username: screenShareData.userName,
          userid: screenShareData.userName, //TODO: generate userid
          color: stringToColor(screenShareData.userName ?? 'Anonymous'),
          hostname: screenShareData.controlServer
        }
        emit('toggle-full-video', true)
        return
      }

      remoteViewerRef.value?.receive(event, event === 'reset' ? data : JSON.parse(data as string)) // TODO: make serialization consistent
    },
    onEnding: () => {
      notify({
        type: 'info',
        text: t('viewer.sharingEnded'),
        confirmButtonText: t('general.ok'),
      })
      screenView.value = undefined

      stop()
    }
  })
  repaint()
}, { flush: 'post', immediate: true })

onMounted(() => {
  denyLoadingInTopWindow()
  const cleanupZoom = disableBrowserZoom()
  window.addEventListener('resize', repaint)

  onUnmounted(() => {
    cleanupZoom()
    window.removeEventListener('resize', repaint)
  })
})

const denyLoadingInTopWindow = (): void => {
  if (window.self === window.top) {
    //window.location.href = 'about:blank';
  }
}

const disableBrowserZoom = (): () => void => {
  const handleKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
      e.preventDefault()
    }
  }

  const handleBrowserZoomWheel = (e: WheelEvent): void => {
    console.log("wheel")
    if (e.ctrlKey || e.metaKey)
      e.preventDefault()
  }

  document.addEventListener('keydown', handleKeydown, false)
  document.addEventListener("wheel", handleBrowserZoomWheel, { passive: false })

  return () => {
    document.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('wheel', handleBrowserZoomWheel)
  }
}

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
  trackStyle.value.transform = `scale(${scaleinfo.scale}) translate(${scaleinfo.x}px,${scaleinfo.y}px)`

  const videoRect = trackRef.value!.getBoundingClientRect()
  videoTransform.value = {
    x: Math.round(videoRect.left),
    y: Math.round(videoRect.top),
    fullwidth: Math.round(videoRect.right - videoRect.left),
    fullheight: Math.round(videoRect.bottom - videoRect.top),
    width: Math.round(containerRect.right - containerRect.left),
    height: Math.round(containerRect.bottom - containerRect.top)
  }
}

function repaint() {
  containerStyle.value.overflow = 'visible'
  viewerStyle.value = {
    top: '0px',
    left: '0px',
    minWidth: '100vw',
    minHeight: '100vh',
    width: '100%',
    height: '100%',
  }
}

function stop() {
  screenView.value?.leave()
  screenView.value = undefined

  emit('stop')
  emit('toggle-full-video', false)
}
</script>

<template>
  <div class="remote-control">
    <div ref="container" class="remote-container" :style="containerStyle">
      <video ref="track" playsinline autoplay :style="trackStyle" />
      <RemoteViewer
        ref="remoteViewer"
        v-if="remoteControlData"
        :room="remoteControlData?.roomid"
        :user="remoteControlData?.username"
        :id="remoteControlData?.userid"
        :color="remoteControlData?.color"
        :hostname="remoteControlData?.hostname"
        :video-transform="videoTransform"
        :style="viewerStyle"
        @rescale="rescale"
        @send="screenView?.sendRemote($event.event, $event.data)"
      />
      <slot />
    </div>

    <div class="btn-row">
      <button type="button" class="btn btn-secondary" @click="stop">
        {{ $t('viewer.stop') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.remote-control {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 0;
}

.remote-control video {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: fill;
}

.remote-container {
  position: absolute;
  top: 0px;
  left: 0px;
  border: 1px solid #ccc;
  border-radius: 6px;
}

.remote-viewer {
  position: absolute;
  border: 0px;
  z-index: 9999;
}
</style>
