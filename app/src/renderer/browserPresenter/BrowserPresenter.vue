<script setup lang="ts">
import { ref, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import StreamOverlay from '../views/viewer/StreamOverlay.vue'
import Clipboard from '../components/Clipboard.vue'
import { File, RemoteEvent, RemoteData, Rectangle, Size } from '../../interface'
import PresenterToolbar from '../components/PresenterToolbar.vue'
import { usePresenter, getStreamInBrowser, type Presenter } from '../composables/usePresenter'
import { prompt } from '../util'
import { useFileChunkRegistry } from '../../composables/useFileChunking'

import LoadingDarkGif from '../../assets/img/loading_dark.gif'

const { t } = useI18n()

const windowDefaultSize = [400, 400] as const
const windowSelectSize = [720, 600] as const
const windowModalSize = [400, 550] as const

const urlBarHeight = 36 // TODO: as of now this is Chrome on KDE, check other OS's / browsers

const outerRef = useTemplateRef('outer')
const toolbarRef = useTemplateRef('toolbar')
const videoRef = useTemplateRef('video')
const overlayRef = useTemplateRef('overlay')

const presenter = ref<Presenter>()
const lastWindowTransform = ref<Rectangle>()
const streamSize = ref<Size>({ width: 0, height: 0 })
const windowSizeFixed = ref(false)

const pointerEnabled = ref(true)
const showClipboard = ref(false)
const clipboardFile = ref<File>({ content: 'data:text/plain;base64,' })
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

const userInputRequired = ref(true)

async function start() {
  userInputRequired.value = false
  let params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')
  
  params = new URLSearchParams(atob(data))
  const email = params.get('email')!
  const token = params.get('token')!
  presenter.value = usePresenter({
    email,
    token,
    pointerEnabled,
    remoteControlEnabled: false
  }, t, async (shareAudio) => {
    windowSizeFixed.value = true
    window.resizeTo(...windowSelectSize)
    const stream = await getStreamInBrowser(shareAudio)
    windowSizeFixed.value = false
    window.resizeTo(...windowDefaultSize)

    videoRef.value!.srcObject = stream
    setTimeout(() => {
      videoRef.value!.play().catch(err => {
        console.error('Error playing video:', err)
      })
      updateVideoTransform()
    }, 2500)

    return stream
  }, {
    onStream: () => {
      showInviteLink()
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

const videoTransform = ref<Rectangle>({ x: 0, y: 0, width: 0, height: 0 })

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
  console.log("mouse-down", data)
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

window.addEventListener('resize', onResize)

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})

let resizeDebounceTimeout: number | null = null
function onResize() {
  if (resizeDebounceTimeout)
    clearTimeout(resizeDebounceTimeout)

  resizeDebounceTimeout = window.setTimeout(() => {
    resizeDebounceTimeout = null
    fitPreview()
  }, 200)

  updateVideoTransform()
}

function fitPreview() {
  if (!videoRef.value || windowSizeFixed.value)
    return

  const outerRect = outerRef.value!.getBoundingClientRect()
  const toolbarRect = toolbarRef.value!.$el.getBoundingClientRect()
  const videoRect = videoRef.value!.getBoundingClientRect()

  const deltaWidth = Math.round(outerRect.width - videoRect.width)
  const deltaHeight = Math.round(outerRect.height - videoRect.height - toolbarRect.height)
  if (deltaWidth > 0 || deltaHeight > 0)
    window.resizeTo(window.outerWidth - deltaWidth, window.outerHeight - deltaHeight)
}

function freezeAndFocus() {
  if (throttling)
    return

  const toolbarRect = toolbarRef.value!.$el.getBoundingClientRect()
  const width = streamSize.value.width
  const height = streamSize.value.height + toolbarRect.height + urlBarHeight
  if (width <= window.innerWidth && height <= window.innerHeight)
    return

  throttling = true
  window.setTimeout(() => throttling = false, 5000)

  shutterActive.value = true
  window.setTimeout(() => { // wait until shutter is streamed
    videoRef.value?.pause()
    shutterActive.value = false
    lastWindowTransform.value = {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    windowSizeFixed.value = true

    window.resizeTo(width, height)
    window.focus()
    window.setTimeout(() => {
      windowSizeFixed.value = false
      window.resizeTo(lastWindowTransform.value!.width, lastWindowTransform.value!.height)
      window.moveTo(lastWindowTransform.value!.x, lastWindowTransform.value!.y)
      videoRef.value?.play()
    }, 3000)
  }, 150)
}

async function showInviteLink() {
  windowSizeFixed.value = true
  window.resizeTo(...windowModalSize)
  const url = `${import.meta.env.VITE_APP_URL}?view=${presenter.value?.viewCode}`
  const result = await prompt({
    type: 'info',
    title: t('toolbar.inviteLink'),
    html: `<code>${url}</code>`,
    confirmButtonText: t('toolbar.copyToClipboard'),
    cancelButtonText: t('general.close'),
  })

  if (result === '0')
    navigator.clipboard.writeText(url)

  windowSizeFixed.value = false
  window.resizeTo(...windowDefaultSize)
}

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

function onStopSharing() {
  window.electronAPI?.stopSharing()
  presenter.value?.stopSharing()
}

function onPauseSharing() {
  window.electronAPI?.pauseSharing()
  presenter.value?.pauseSharing()
}

function onResumeSharing() {
  window.electronAPI?.resumeSharing()
  presenter.value?.resumeSharing()
}
</script>

<template>
  <div v-if="userInputRequired" class="input-container">
    <button class="btn btn-primary" @click="start">{{ $t('browserPresenter.start') }}</button>
  </div>
  <div v-else-if="!presenter" class="input-container">
    <img :src="LoadingDarkGif">
  </div>
  <div v-else ref="outer" class="presenter-container">
    <PresenterToolbar
      ref="toolbar"
      @toggle-pointer="pointerEnabled = $event"
      @toggle-clipboard="showClipboard = !showClipboard"
      @stop-sharing="onStopSharing()"
      @pause-sharing="onPauseSharing()"
      @resume-sharing="onResumeSharing()"
      @share-different-screen="presenter.presentSource()"
      @show-invite-link="showInviteLink"
    />
    <div class="preview-container">
      <video ref="video" muted />
      <div class="veil" />
      <StreamOverlay
        v-if="presenter?.screenShareData"
        ref="overlay"
        :users="presenter.viewers"
        :user-id="presenter.screenShareData.user.id"
        :video-transform="videoTransform"
        :input-enabled="false"
        :pointer-enabled="pointerEnabled"
        @on-stream-size-change="streamSize = $event"
        @send="send($event.event, $event.data, $event.options)"
      />
      <div v-if="shutterActive" class="shutter" />
    </div>
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile"/>
    </div>
  </div>
</template>

<style>
html {
  overflow: hidden;
}

#browser-presenter {
  background: repeating-conic-gradient(#b9b9b9 0% 25%, #acacac 0% 50%) 50% / 20px 20px;
  width: 100%;
  height: 100%;
}

.presenter-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
}

.presenter-container .toolbar {
  border-radius: 0;
  border: none;
  align-self: stretch;
}

video {
  max-width: 100%;
  max-height: 100%;
  filter: grayscale(50%);
}

.input-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.preview-container {
  position: relative;
  flex-grow: 1;
  min-height: 0;
}

.veil {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: #8884;
  z-index: 500;
}

.shutter {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  z-index: 1500;
}

.clipboard-container {
  position: absolute;
  z-index: 2000;
  top: 50px;
  left: 50px;
}
</style>
