<script setup lang="ts">
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import StreamOverlay from '../views/viewer/StreamOverlay.vue'
import Clipboard from '../components/Clipboard.vue'
import { ScaleInfo, VideoTransform } from '../types'
import { File, RemoteEvent, RemoteData } from '../../interface'
import PresenterToolbar from '../components/PresenterToolbar.vue'
import { usePresenter, type Presenter } from '../views/presenter/usePresenter'
import { prompt } from '../util'
import { useFileChunkRegistry } from '../../composables/useFileChunking'

const { t } = useI18n()

const windowDefaultSize = [400, 400] as const
const windowSelectSize = [720, 600] as const

const videoRef = useTemplateRef('video')
const containerRef = useTemplateRef('container')
const overlayRef = useTemplateRef('overlay')

const appUrl = ref(import.meta.env.VITE_APP_URL)
const presenter = ref<Presenter>()

const mouseEnabled = ref(true)
watch(mouseEnabled, (enabled) => {
  presenter.value?.sendRemote?.('mouse-control', { enabled })
})

const showClipboard = ref(true)
const clipboardFile = ref<File>()
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

onMounted(() => startPreview())

async function startPreview() {
  const params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')
  
  const { email, token } = JSON.parse(atob(data))
  presenter.value = usePresenter(email, token, {
    onBeforeScreenSelect: () => window.resizeTo(...windowSelectSize),
    onAfterScreenSelect: () => window.resizeTo(...windowDefaultSize),
    onStream: (stream) => {
      videoRef.value!.srcObject = stream
      setTimeout(() => {
        videoRef.value!.play().catch(err => {
          console.error('Error playing video:', err)
        })
      }, 2500)
    },
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
    },
    onReset: (data) => overlayRef.value?.reset(data),
    onStop: () => window.close(),
  })
  
  await presenter.value.startSession()
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

function rescale(scaleInfo: ScaleInfo) {
  const containerRect = containerRef.value!.getBoundingClientRect()
  const currentHeight = Math.round(containerRect.height)
  const currentWidth = Math.round(containerRect.width)

  let scaleDownY = 1
  let scaleDownX = 1
  if (scaleInfo.height > window.innerHeight)
    scaleDownY = window.innerHeight / scaleInfo.height
  if (scaleInfo.width > window.innerWidth)
    scaleDownX = window.innerWidth / scaleInfo.width

  let scaleDown = scaleDownY < scaleDownX ? scaleDownY : scaleDownX
  
  if (scaleInfo.height != currentHeight || scaleInfo.width != currentWidth) {
    containerStyle.value.height = scaleInfo.height * scaleDown + 'px'
    containerStyle.value.width = scaleInfo.width * scaleDown + 'px'
  }

  containerStyle.value.overflow = 'visible'
  videoStyle.value.transform = `scale(${scaleInfo.scale}) translate(${scaleInfo.x}px,${scaleInfo.y}px)`

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
  freezeAndFocus()
})

onReceive("mouse-move", (data) => {
  overlayRef.value?.receiveMouseMove(data)
})

onReceive("mouse-down", (data) => {
  overlayRef.value?.receiveMouseDown(data)
})

onReceive("file", (data) => {
  console.log("file", data)
  fileChunkRegistry.register(data)
})

onReceive("file-chunk", (data) => {
  fileChunkRegistry.receiveChunk(data)
})

let throttling = false
const shutterActive = ref(false)
onReceive("mouse-up", (data) => {
  overlayRef.value?.receiveMouseUp(data)
  freezeAndFocus()
})

function send<T extends RemoteEvent>(event: T, data: RemoteData<T>, options: SendOptions = {}) {
  presenter.value?.sendRemote?.(event, data)
  if (options.receiveSelf)
    receive(event, data)
}

function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
  receiveEvents[event]?.(data)
}

function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
  receiveEvents[event] = handler as ReceiveEventHandlers[T]
}

function freezeAndFocus() {
  if (throttling)
    return

  throttling = true
  window.setTimeout(() => throttling = false, 5000)

  shutterActive.value = true
  window.setTimeout(() => { // wait until shutter is streamed
    videoRef.value?.pause()
    shutterActive.value = false
    window.resizeTo(window.screen.width, window.screen.height)
    window.focus()
    window.setTimeout(() => {
      window.resizeTo(...windowDefaultSize)
      videoRef.value?.play()
    }, 3000)
  }, 150)
}

async function showInviteLink() {
  const url = `${appUrl.value}?view=${presenter.value?.viewCode}`
  const result = await prompt({
    type: 'info',
    title: 'Invite link',
    html: `<code>${url}</code>`,
    confirmButtonText: t('general.copyToClipboard'),
    cancelButtonText: t('general.close'),
  })

  if (result === '0')
    navigator.clipboard.writeText(url)
}
</script>

<template>
  <PresenterToolbar
    v-if="presenter"
    @toggle-mouse="mouseEnabled = $event"
    @toggle-clipboard="showClipboard = !showClipboard"
    @stop-sharing="presenter.stopSharing()"
    @pause-sharing="presenter.pauseSharing()"
    @resume-sharing="presenter.resumeSharing()"
    @share-different-screen="presenter.shareLocalScreen()"
    @show-invite-link="showInviteLink"
  />
  <div ref="container" class="preview-container">
    <video ref="video" muted />
    <div class="veil" />
    <StreamOverlay
      v-if="presenter?.screenShareData"
      ref="overlay"
      :input-enabled="false"
      :users="presenter.viewers"
      :user-id="presenter.screenShareData.user.id"
      :video-transform="videoTransform"
      :mouse-enabled="mouseEnabled"
      @rescale="rescale"
      @send="send($event.event, $event.data, $event.options)"
    />
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile"/>
    </div>
    <div v-if="shutterActive" class="shutter" />
  </div>
</template>

<style>
#presenter {
  width: 100%;
  height: 100%;
}

video {
  max-width: 100%;
  max-height: 100%;
  filter: grayscale(50%);
}

.veil {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: #8886;
  z-index: 1000;
}

.preview-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.clipboard-container {
  position: absolute;
  z-index: 300;
  top: 50px;
  left: 50px;
}

.shutter {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  z-index: 1001;
}
</style>
