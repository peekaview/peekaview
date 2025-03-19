<script setup lang="ts">
import { ref, onBeforeUnmount, useTemplateRef, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import StreamContainer from '../views/viewer/StreamContainer.vue'
import Clipboard from '../components/Clipboard.vue'
import { File, Size } from '../../interface'
import PresenterToolbar from '../components/PresenterToolbar.vue'
import { usePresenter, getStreamInBrowser, type Presenter } from '../composables/usePresenter'
import { notify, prompt, PromptOptions, NotifyOptions, getPlatform } from '../util'
import { parseCode, sleep } from '../../util'
import { useFileChunkRegistry } from '../../composables/useFileChunking'

import LoadingDarkGif from '../../assets/img/loading_dark.gif'
import { useRemoteHandlers } from '../composables/useRemoteHandlers'

const { t } = useI18n()

const platform = getPlatform()
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

const toolsEnabled = ref({ pointer: true, remoteControl: false })
const showClipboard = ref(false)
const clipboardFile = ref<File>({ content: 'data:text/plain;base64,' })
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)
watch(() => toolsEnabled.value.pointer, () => {
  containerRef.value?.clear()
})

const userInputRequired = ref(true)

const { send, receive, onReceive } = useRemoteHandlers(presenter)

async function start() {
  userInputRequired.value = false
  const code = new URLSearchParams(window.location.search).get('data')
  if (!code)
    throw new Error('')
  
  const { email, token } = parseCode(code)
  presenter.value = usePresenter({
    email: email!,
    token: token!,
    toolsEnabled,
  }, async (shareAudio) => {
    const unsize = await fixSize(windowSelectSize)
    const s = await getStreamInBrowser(shareAudio)
    unsize()

    stream.value = s

    return s
  }, {
    onRequest: async (_id, name) => {
      const result = await resizeAndPrompt({
        text: t('share.requestAccess', { name }),
        confirmButtonText: t('general.accept'),
        cancelButtonText: t('general.deny'),
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
        confirmButtonText: t('general.yes'),
        cancelButtonText: t('general.no'),
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
  window.setTimeout(async () => { // wait until shutter is streamed
    containerRef.value?.videoRef?.pause()
    shutterActive.value = false
    
    // TODO: what if someone freezes while a modal is open? fix!
    const unsize = await fixSize([width, height], [0, 0])
    window.focus()
    window.setTimeout(() => {
      unsize(true)
      containerRef.value?.videoRef?.play()
    }, 3000)
  }, 150)
}

async function showInviteLink() {
  const url = `${import.meta.env.VITE_APP_URL}/${presenter.value?.viewCode}`
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

async function fixSize(size: readonly [number, number], position?: readonly [number, number]) {
  if (sizeFixed.value)
    throw new Error('Window size is already fixed!')

  const x = window.screenX
  const y = window.screenY
  const width = window.outerWidth
  const height = window.outerHeight

  sizeFixed.value = true
  await transform(size, position)

  return async (toPrevious = false) => {
    sizeFixed.value = false
    if (toPrevious)
      await transform([width, height], [x, Math.max(y, titleBarHeight)]) // timeout required to let resize finish
    else
      await transform(windowDefaultSize, [99999, 99999]) // force to the bottom right corner, because the correct values cannot be determined in a multi monitor setup
  }
}

async function transform(size: readonly [number, number], position?: readonly [number, number]) {
  // on macOS, when the window is resized is first, it might mainly overlap into another window, thus move it to the top left corner beforehand
  if (position && platform === 'mac') { 
    const width = window.outerWidth
    const height = window.outerHeight

    // if one of the new sizes is more than the double of the current size, it is likely have more area in another window
    if (width < (size[0] / 2) || height < (size[1] / 2)) {
      window.moveTo(0, 0)
      await sleep(300) // let moving finish
    }
  }

  window.resizeTo(...size)
  if (position) {
    await sleep(300) // let resize finish
    window.moveTo(...position)
  }
}

const modalQueue: (Promise<string> | Promise<void>)[] = []
async function resizeAndPrompt(options: PromptOptions) {
  await Promise.all(modalQueue)

  const modalPromise = prompt(options)
  modalQueue.push(modalPromise)
  const unsize = await fixSize(windowModalSize)

  const result = await modalPromise

  unsize()
  return result
}

async function resizeAndNotify(options: NotifyOptions) {
  await Promise.all(modalQueue)

  const modalPromise = notify(options)
  modalQueue.push(modalPromise)
  const unsize = await fixSize(windowModalSize)

  await modalPromise

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
      @toggle-pointer="toolsEnabled.pointer = $event"
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
      :video-options="{ muted: true }"
      use-veil
      @send="send($event.event, $event.data, $event.options)"
      @on-stream-size-change="streamSize = $event"
    >
      <div v-if="shutterActive" class="shutter" />
    </StreamContainer>
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile" @close="showClipboard = false"/>
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

.clipboard {
  max-width: 350px;
}

.clipboard .clipboard-content {
  width: 300px;
  height: 100px;
}
</style>
