<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { RemoteControlData } from '../types';

interface ScaleInfo {
  height: number
  width: number
  scale: number
  x: number
  y: number
}

interface MessageData {
  action: string
  scaleinfo?: ScaleInfo
}

const props = defineProps<{
  data?: RemoteControlData
}>()

const containerRef = useTemplateRef('container')
const containerStyle = ref<Record<string, string>>({
  overflow: 'hidden',
  width: '800px',
  height: '600px',
})
const iframeStyle = ref<Record<string, string>>({
  top: '0px',
  left: '0px',
  minWidth: '100vw',
  minHeight: '100vh',
  width: '100%',
  height: '100%',
})

watch(() => props.data, (data) => {
  if (!!data) {
    repaint()
  } else {
    containerStyle.value.overflow = 'hidden'
  }
}, { immediate: true })

const checkIfUrlAllowed = (_url: string, _optionalcompareurl: string | null = null): boolean => {
  return true
  // TODO: check if url is allowed
}

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

const handleMessage = (e: MessageEvent): void => {
  //console.log("handleMessage", e)
  if (checkIfUrlAllowed(e.origin) && e.data != undefined) {
    let data: MessageData
    try {
      data = JSON.parse(e.data)
    } catch (err) {
      data = { action: 'none' }
    }
    if (data.action == 'setscale' && data.scaleinfo) {
      const containerRect = containerRef.value!.getBoundingClientRect()
      const currentHeight = Math.round(containerRect.height)
      const currentWidth = Math.round(containerRect.width)

      //console.log("handleMessage", data.scaleinfo)

      let scaledowny = 1
      let scaledownx = 1
      let scaledown = 1
      if (data.scaleinfo.height > window.innerHeight) {
        scaledowny = window.innerHeight / data.scaleinfo.height
      }
      if (data.scaleinfo.width > window.innerWidth) {
        scaledownx = window.innerWidth / data.scaleinfo.width
      }
      if (scaledowny < scaledownx) {
        scaledown = scaledowny
      } else {
        scaledown = scaledownx
      }
      
      if (data.scaleinfo.height != currentHeight || data.scaleinfo.width != currentWidth) {
        containerStyle.value.height = data.scaleinfo.height * scaledown + 'px'
        containerStyle.value.width = data.scaleinfo.width * scaledown + 'px'
      }

      containerStyle.value.overflow = 'visible'
      const video = document.querySelector('video') as HTMLVideoElement
      video.style.transform = `scale(${data.scaleinfo.scale}) translate(${data.scaleinfo.x}px,${data.scaleinfo.y}px)`

      const videoRect = video.getBoundingClientRect()
      const obj = {
        action: 'videosize',
        sizeinfo: {
          x: Math.round(videoRect.left),
          y: Math.round(videoRect.top),
          fullwidth: Math.round(videoRect.right - videoRect.left),
          fullheight: Math.round(videoRect.bottom - videoRect.top),
          width: Math.round(containerRect.right - containerRect.left),
          height: Math.round(containerRect.bottom - containerRect.top)
        }
      }
      if (e.source) {
        (e.source as Window).postMessage(JSON.stringify(obj), '*')
      }
    }
  }
}

function repaint() {
  containerStyle.value.overflow = 'visible'
  iframeStyle.value = {
    top: '0px',
    left: '0px',
    minWidth: '100vw',
    minHeight: '100vh',
    width: '100%',
    height: '100%',
  }
}

onMounted(() => {
  denyLoadingInTopWindow()
  const cleanupZoom = disableBrowserZoom()
  window.addEventListener('message', handleMessage)
  window.addEventListener('resize', repaint)

  onUnmounted(() => {
    cleanupZoom()
    window.removeEventListener('message', handleMessage)
    window.removeEventListener('resize', repaint)
  })
})
</script>

<template>
  <div class="remote-control" ref="container" :style="containerStyle">
    <slot></slot>
    <iframe
      v-if="props.data"
      ref="iframe"
      :src="`/remote/index.html?hostname=${props.data.hostname}&roomid=${props.data.roomid}&color=${props.data.color}&username=${props.data.username}&userid=${props.data.userid}`"
      allow="clipboard-write"
      :style="iframeStyle"
    />
  </div>
</template>

<style scoped>
.remote-control {
  position: absolute;
  top: 0px;
  left: 0px;
  border: 1px solid #ccc;
  border-radius: 6px;
}

iframe {
  position: absolute;
  border: 0px;
  z-index: 9999;
}
</style>
