<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RemoteViewer from './RemoteViewer.vue'

import type { ScaleInfo, VideoTransform } from '../../types'
import { notify } from '../../util'
import { ScreenView, useScreenView, ScreenShareData } from '../../composables/useSimplePeerScreenShare'

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

const inApp = ref(!!window.electronAPI)
const screenView = ref<ScreenView>()
const users = computed(() => screenView.value?.users ?? [])
const remoteViewerRef = useTemplateRef('remoteViewer')
const videoRef = useTemplateRef('video')
const videoStyle = ref<Record<string, string>>({
  transform: 'scale(1) translate(0px,0px)',
  'object-fit': process.platform === 'darwin' ? 'fill' : 'cover',
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

  emit('toggle-full-video', true)
  screenView.value = await useScreenView(screenShareData, {
    videoElement: videoRef.value ?? undefined,
    onRemote: (event, data) => {
      if (event === 'browser')
        inApp.value = false

      let parsedData = data
      if (typeof data === 'string' && event !== 'reset') {
        try {
          parsedData = JSON.parse(data)
        } catch (err) {
          console.error('Failed to parse remote control data:', err)
          return
        }
      }

      remoteViewerRef.value?.receive(event, parsedData)
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
      <video ref="video" playsinline autoplay :style="videoStyle" />
      <RemoteViewer
        ref="remoteViewer"
        v-if="data"
        :in-app="inApp"
        :room="data.roomId"
        :user-id="data.user.id"
        :users="[...users, data.user]"
        :video-transform="videoTransform"
        :style="viewerStyle"
        @rescale="rescale"
        @send="screenView?.sendRemote($event.event, $event.data)"
        @stop="stop"
        @freeze="videoRef?.pause()"
        @unfreeze="videoRef?.play()"
      />
      <slot />
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
}

.remote-container {
  position: absolute;
  top: 0px;
  left: 0px;
}

.remote-viewer {
  position: absolute;
  border: 0px;
  z-index: 9999;
}
</style>
