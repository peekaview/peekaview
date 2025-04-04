<script setup lang="ts">
import { ref, onBeforeUnmount, useTemplateRef, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

import StreamContainer from '../views/viewer/StreamContainer.vue'
import Clipboard from '../components/Clipboard.vue'
import { ContactData, File, Platform, Size } from '../../interface'
import PresenterToolbar from '../components/PresenterToolbar.vue'
import { usePresenter, getStreamInBrowser, type Presenter } from '../composables/usePresenter'
import { notify, prompt, PromptOptions, NotifyOptions, getPlatform } from '../util'
import { parseCode, sleep } from '../../util'
import { useFileChunkRegistry } from '../../composables/useFileChunking'

import LoadingDarkGif from '../../assets/img/loading_dark.gif'
import { useRemoteHandlers } from '../composables/useRemoteHandlers'

type WindowConfig = { minTransformTime: number, urlBarHeight: number, titleBarHeight: number }

 // TODO: as of now those are for Chrome on KDE, check other OS's / browsers
const defaultWindowConfig = { minTransformTime: 300, urlBarHeight: 36, titleBarHeight: 268 }
const windowConfigByOs: Partial<Record<Platform, WindowConfig>> = {
  linux: { minTransformTime: 250, urlBarHeight: 36, titleBarHeight: 268 },
  win: { minTransformTime: 250, urlBarHeight: 36, titleBarHeight: 268 },
  mac: { minTransformTime: 300, urlBarHeight: 36, titleBarHeight: 268 },
}

const windowDefaultSize = [480, 360] as const
const windowSelectSize = [720, 600] as const
const windowModalSize = [480, 600] as const

const { t } = useI18n()

const platform = getPlatform()
const windowConfig = {
  ...defaultWindowConfig,
  ...(windowConfigByOs[platform] ?? {}),
}

const outerRef = useTemplateRef('outer')
const toolbarRef = useTemplateRef('toolbar')
const containerRef = useTemplateRef('container')

const presenter = ref<Presenter>()
const streamSize = ref<Size>({ width: 0, height: 0 })
const sizeFixed = ref(false)
const stream = ref<MediaStream>()

const toolsEnabled = ref({ pointer: true, remoteControl: false })
const showClipboard = ref(false)
const clipboardFile = ref<File>()
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)
watch(() => toolsEnabled.value.pointer, () => {
  containerRef.value?.clear()
})

const userInputRequired = ref(true)

const { send, receive, onReceive } = useRemoteHandlers(presenter)

async function start() {
  userInputRequired.value = false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('data')
  if (!code)
    throw new Error('')
  
  const { email, token } = parseCode(code)
  const shareAudio = params.get('shareAudio') === 'true'
  const notify = params.get('notify')
  const contactToNotify = notify ? JSON.parse<ContactData>(notify) : undefined

  presenter.value = usePresenter({
    email: email!,
    token: token!,
    toolsEnabled,
  }, async () => {
    const unsize = await fixSize(windowSelectSize, 1)
    const s = await getStreamInBrowser(shareAudio)
    await unsize()

    stream.value = s

    return { stream: s, source: undefined }
  }, {
    notify: {
      contact: contactToNotify,
      getMessage: (name: string) => t('notifications.viewSharedScreen', { name }),
    },
    onRequest: async (request) => {
      const result = await resizeAndPrompt({
        type: 'info',
        text: t('share.requestAccess', { name: request.name }),
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
        type: 'info',
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

onReceive("text", (data) => {
  console.log("text", data)

  clipboardFile.value = {
    content: 'data:text/plain;base64,' + btoa(data.text),
    name: ''
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

  return [deltaWidth, deltaHeight]
}

let throttling = false
const shutterActive = ref(false)
function freezeAndFocus() {
  if (throttling)
    return

  const toolbarRect = toolbarRef.value!.$el.getBoundingClientRect()
  const width = streamSize.value.width
  const height = streamSize.value.height + toolbarRect.height + windowConfig.urlBarHeight
  if (width <= window.innerWidth && height <= window.innerHeight)
    return

  throttling = true
  window.setTimeout(() => throttling = false, 5000)

  shutterActive.value = true
  window.setTimeout(async () => { // wait until shutter is streamed
    containerRef.value?.videoRef?.pause()
    shutterActive.value = false
    
    // TODO: what if someone freezes while a modal is open? fix!
    const unsize = await fixSize([width, height], -1)
    window.focus()
    window.setTimeout(async () => {
      await unsize(true)
      containerRef.value?.videoRef?.play()
    }, 3000)
  }, 150)
}

async function showInviteLink() {
  const url = new URL(`${import.meta.env.VITE_APP_URL}/${presenter.value?.inviteCode}`)
  const result = await resizeAndPrompt({
    type: 'info',
    title: t('toolbar.inviteLink'),
    html: `<code>${url}</code>`,
    confirmButtonText: t('toolbar.copyToClipboard'),
    cancelButtonText: t('general.close'),
  })

  if (result === '0')
    navigator.clipboard.writeText(url.toString())
}

// OS-dependent findings on transforming windows:
//
// Linux KDE: A window cannot be resized beyond the boundaries of its current screen; instead, it is moved in top left direction until it fits.
// Also, the coordinate origin is not relative to the screen which the window has most of its area on, but absolute.
// Data about this screen's position is only obtainable through experimental browser features without baseline availability as of now.
//
// Windows: Resizing a window beyond the boundaries of its current screen is possible only into another screen, but when it's mainly overlapping into that,
// then moving it will use that's screen coordinate origin instead. Thus it needs to be moved first. On the other hand though, a window cannot be resized
// to overlap outside of any visible screen, but compared to Linux the according position adjustment does not seem to follow any comprehensible logic.
//
// Mac: So far the same as for Windows.
//
// The overall approach should be the following to avoid overlaps at all:
// If the window size is to be increased, then it should be moved beforehand. Generally applies when fixing to a size.
// If the window size is to be decreased, then it should be moved afterwards. Generally applies when unfixing off a size.
async function fixSize(size: readonly [number, number], cornerAlign = 0) {
  if (sizeFixed.value)
    throw new Error('Window size is already fixed!')

  const x = window.screenX
  const y = window.screenY
  const width = window.outerWidth
  const height = window.outerHeight

  sizeFixed.value = true

  const [left, top] = getAbsoluteScreenPosition()
  if (cornerAlign < 0)
    window.moveTo(left, top)
  else if (cornerAlign > 0)
    window.moveTo(window.screen.width + left - size[0], window.screen.height + top - size[1])

  await sleep(windowConfig.minTransformTime)
  window.resizeTo(...size)

  return async (toPrevious = false) => {
    if (toPrevious) {
      window.resizeTo(width, height)
      await sleep(windowConfig.minTransformTime)
      window.moveTo(x, Math.max(y, windowConfig.titleBarHeight))
      sizeFixed.value = false
    } else {
      window.resizeTo(...windowDefaultSize)
      await nextTick()
      fitPreview()
      await sleep(windowConfig.minTransformTime)
      // recall in case the current screen has changed
      const [left, top] = getAbsoluteScreenPosition()
      // decrease by 1 to avoid slight overlaps for some OS's
      window.moveTo(window.screen.width + left - window.outerWidth - 1, window.screen.height + top - window.outerHeight - 1)
    }
    sizeFixed.value = false
  }
}

function getAbsoluteScreenPosition() {
  // TODO: experimental features, check for baseline availability
  return [
    platform === 'linux' && window.screen.availLeft || 0,
    platform === 'linux' && window.screen.availTop || 0
  ]
}

const modalQueue: (Promise<string> | Promise<void>)[] = []
async function resizeAndPrompt(options: PromptOptions) {
  await Promise.all(modalQueue)

  const modalPromise = prompt(options)
  modalQueue.push(modalPromise)
  const unsize = await fixSize(windowModalSize, 1)

  const result = await modalPromise

  unsize()
  return result
}

async function resizeAndNotify(options: NotifyOptions) {
  await Promise.all(modalQueue)

  const modalPromise = notify(options)
  modalQueue.push(modalPromise)
  const unsize = await fixSize(windowModalSize, 1)

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
      :clipboard-enabled="!!clipboardFile"
      :viewers="presenter.viewers"
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
