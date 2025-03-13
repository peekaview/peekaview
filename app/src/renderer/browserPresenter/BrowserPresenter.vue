<script setup lang="ts">
import { ref, onBeforeUnmount, useTemplateRef, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import StreamContainer from '../views/viewer/StreamContainer.vue'
import Clipboard from '../components/Clipboard.vue'
import { File, Size } from '../../interface'
import PresenterToolbar from '../components/PresenterToolbar.vue'
import { usePresenter, getStreamInBrowser, type Presenter } from '../composables/usePresenter'
import { notify, prompt, DialogOptions, NotifyOptions } from '../util'
import { parseCode } from '../../util'
import { useFileChunkRegistry } from '../../composables/useFileChunking'

import LoadingDarkGif from '../../assets/img/loading_dark.gif'
import { useRemoteHandlers } from '../composables/useRemoteHandlers'

const { t } = useI18n()

const windowDefaultSize = [400, 400] as const
const windowSelectSize = [720, 600] as const
const windowModalSize = [400, 550] as const

 // TODO: as of now those are for Chrome on KDE, check other OS's / browsers
const urlBarHeight = 36
const titleBarHeight = 268

const outerRef = useTemplateRef('outer')
const toolbarRef = useTemplateRef('toolbar')
const containerRef = useTemplateRef('container')

const presenter = ref<Presenter>()
const streamSize = ref<Size>({ width: 0, height: 0 })
const sizeFixed = ref(false)
const stream = ref<MediaStream>()

const pointerEnabled = ref(true)
const showClipboard = ref(false)
const clipboardFile = ref<File>({ content: 'data:text/plain;base64,' })
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

const userInputRequired = ref(true)

const { send, receive, onReceive } = useRemoteHandlers(presenter)

watch(() => presenter.value?.viewers.length, async (count) => {
  if (!count || count > 0)
    return

  const result = await resizeAndPrompt({
    text: t('share.allViewersLeft'),
  })

  if (result === '0')
    presenter.value?.stopSharing()
})

async function start() {
  userInputRequired.value = false
  const code = new URLSearchParams(window.location.search).get('data')
  if (!code)
    throw new Error('')
  
  const { email, token } = parseCode(code)
  presenter.value = usePresenter({
    email: email!,
    token: token!,
    pointerEnabled,
    remoteControlEnabled: false
  }, async (shareAudio) => {
    const unsize = fixSize(windowSelectSize)
    const s = await getStreamInBrowser(shareAudio)
    unsize()

    stream.value = s

    return s
  }, {
    onRequest: async (request) => {
      const result = await resizeAndPrompt({
        text: t('share.requestAccess.message', { name: request.name }),
        confirmButtonText: t('share.requestAccess.accept'),
        cancelButtonText: t('share.requestAccess.deny'),
        sound: 'ringtone',
      })

      return (result === '0')
    },
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
    onReset: (data) => containerRef.value?.reset(data),
    onStop: () => window.close(),
    onAllViewersLeft: async() => {
      const result = await resizeAndPrompt({
        text: t('share.allViewersLeft'),
      })

      return (result === '0')
    },
    onApiError: async (error) => {
      await resizeAndNotify({
        type: 'error',
        title: t('general.error'),
        text: t('share.requestError') + '\n\n' + error.message,
        confirmButtonText: t('general.ok'),
      })
    }
  })
  
  await presenter.value.startSession()
}

onReceive("mouse-leftclick", (data) => {
  containerRef.value?.receiveMouseLeftClick(data)
  if (data.tool === 'pointer') {
    freezeAndFocus()
  }
})

onReceive("mouse-move", (data) => {
  containerRef.value?.receiveMouseMove(data)
})

onReceive("mouse-down", (data) => {
  containerRef.value?.receiveMouseDown(data)
})

onReceive("mouse-up", (data) => {
  containerRef.value?.receiveMouseUp(data)
  if (data.tool === 'pointer') {
    freezeAndFocus()
  }
})

onReceive("file", (data) => {
  console.log("file", data)
  fileChunkRegistry.register(data)
})

onReceive("file-chunk", (data) => {
  fileChunkRegistry.receiveChunk(data)
})

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.moveTo(99999, 99999) // force to the bottom right corner, because the correct values cannot be determined in a multi monitor setup
})

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
}

function fitPreview() {
  if (!containerRef.value?.videoRef || sizeFixed.value)
    return

  const outerRect = outerRef.value!.getBoundingClientRect()
  const toolbarRect = toolbarRef.value!.$el.getBoundingClientRect()
  const videoRect = containerRef.value?.videoRef!.getBoundingClientRect()

  const deltaWidth = Math.round(outerRect.width - videoRect.width)
  const deltaHeight = Math.round(outerRect.height - videoRect.height - toolbarRect.height)
  if (deltaWidth > 0 || deltaHeight > 0)
    window.resizeTo(window.outerWidth - deltaWidth, window.outerHeight - deltaHeight)
}

let throttling = false
const shutterActive = ref(false)
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
    containerRef.value?.videoRef?.pause()
    shutterActive.value = false
    
    const unsize = fixSize([width, height], [0, 0])
    window.focus()
    window.setTimeout(() => {
      unsize(true)
      containerRef.value?.videoRef?.play()
    }, 3000)
  }, 150)
}

async function showInviteLink() {
  const url = `${import.meta.env.VITE_APP_URL}?view=${presenter.value?.viewCode}`
  const result = await resizeAndPrompt({
    type: 'info',
    title: t('toolbar.inviteLink'),
    html: `<code>${url}</code>`,
    confirmButtonText: t('toolbar.copyToClipboard'),
    cancelButtonText: t('general.close'),
  })

  if (result === '0')
    navigator.clipboard.writeText(url)
}

function fixSize(size: readonly [number, number], position?: readonly [number, number]) {
  if (sizeFixed.value)
    throw new Error('Window size is already fixed!')

  const x = window.screenX
  const y = window.screenY
  const width = window.outerWidth
  const height = window.outerHeight

  sizeFixed.value = true
  transform(size, position)

  return (toPrevious = false) => {
    sizeFixed.value = false
    if (toPrevious)
      transform([width, height], [x, Math.max(y, titleBarHeight)]) // timeout required to let resize finish
    else
      transform(windowDefaultSize, [99999, 99999]) // force to the bottom right corner, because the correct values cannot be determined in a multi monitor setup
  }
}

function transform(size: readonly [number, number], position?: readonly [number, number]) {
  window.resizeTo(...size)
  if (position)
    setTimeout(() => window.moveTo(...position), 300) // timeout required to let resize finish
}

let modalPromise: Promise<string> | Promise<void> | undefined
async function resizeAndPrompt(options: DialogOptions) {
  if (modalPromise) // TODO: fix, not safe in case a third modal is opened!
    await modalPromise

  modalPromise = prompt(options)
  const unsize = fixSize(windowModalSize)

  const result = await modalPromise
  modalPromise = undefined

  unsize()
  return result
}

async function resizeAndNotify(options: NotifyOptions) {
  if (modalPromise)
    await modalPromise

  modalPromise = notify(options)
  const unsize = fixSize(windowModalSize)

  await modalPromise
  modalPromise = undefined

  unsize()
}

function onStopSharing() {
  presenter.value?.stopSharing()
}

function onPauseSharing() {
  presenter.value?.pauseSharing()
}

function onResumeSharing() {
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
      :viewer-count="presenter.viewers.length"
      @toggle-pointer="pointerEnabled = $event"
      @toggle-clipboard="showClipboard = !showClipboard"
      @stop-sharing="onStopSharing()"
      @pause-sharing="onPauseSharing()"
      @resume-sharing="onResumeSharing()"
      @share-different-screen="presenter.presentSource()"
      @show-invite-link="showInviteLink"
    />
    <StreamContainer
      v-if="presenter?.screenShareData"
      ref="container"
      :stream="stream"
      :users="presenter.viewers"
      :user-id="presenter.screenShareData.user.id"
      :input-enabled="false"
      :pointer-enabled="pointerEnabled"
      :video-options="{ muted: true }"
      use-veil
      @send="send($event.event, $event.data, $event.options)"
      @on-stream-size-change="streamSize = $event"
    >
      <div v-if="shutterActive" class="shutter" />
    </StreamContainer>
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

.presenter-container .shutter {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  z-index: 1500;
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

.clipboard-container {
  position: absolute;
  z-index: 2000;
  top: 50px;
  left: 50px;
}
</style>
