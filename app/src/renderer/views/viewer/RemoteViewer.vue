<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onUnmounted, onMounted, ref, useTemplateRef, watch } from "vue"
import { useI18n } from 'vue-i18n'

import { notify } from '../../util'
import { ScreenView, useScreenView, ScreenShareData } from '../../composables/useSimplePeerScreenShare'

import StreamOverlay from './StreamOverlay.vue'
import Clipboard from '../../components/Clipboard.vue'
import Toolbar from "../../components/Toolbar.vue"

import { useFileChunkRegistry, chunkFile } from "../../../composables/useFileChunking"
import { uuidv4 } from "../../../util.js"
import { isTouchEnabled } from "../../util.js"

import LoadingDarkGif from '../../../assets/img/loading_dark.gif'
import ClipboardTextOutlineSvg from '../../../assets/icons/clipboard-text-outline.svg'
import HelpSvg from '../../../assets/icons/help.svg'
import LogoutSvg from '../../../assets/icons/logout.svg'
import MouseSvg from '../../../assets/icons/mouse.svg'
import PencilSvg from '../../../assets/icons/pencil.svg'

import type { RemoteData, RemoteEvent, File, ViewerTool } from '../../../interface'
import type { ScaleInfo, VideoTransform } from "../../types.js"

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
}

type Message = 'init' | 'help' | 'paused' | 'resumed' | 'hidden' | 'visible' | 'remote' | 'fileUpload' | 'fileDrop'

const props = withDefaults(defineProps<{
  data?: ScreenShareData
}>(), {
  data: undefined,
})

const emit = defineEmits<{
  (e: 'stop'): void
}>()

const { t } = useI18n()

const overlayRef = useTemplateRef<InstanceType<typeof StreamOverlay>>('overlay')

const receiveEvents: Partial<ReceiveEventHandlers> = {}

const hidden = ref(false)
const pointerEnabled = ref(true)
const remoteControlEnabled = ref(false)
const remoteClipboard = ref(false)
const activeTool = ref<ViewerTool | undefined>('pointer')

const activeMessage = ref<Message | undefined>('init')
const remoteMessage = ref<string>()
let remoteTimeout: number
watch(pointerEnabled, (enabled) => {
  if (!enabled)
    activeTool.value = remoteControlEnabled.value ? 'remoteControl' : undefined
  else if (!activeTool.value)
    activeTool.value = 'pointer'

  activeMessage.value = 'remote'
  remoteMessage.value = t(`viewer.messages.pointer${enabled ? 'En' : 'Dis'}abled`)
  clearTimeout(remoteTimeout)
  remoteTimeout = window.setTimeout(() => {
    hideMessage('remote')
    remoteMessage.value = undefined
  }, 3000)
})

watch(remoteControlEnabled, (enabled) => {
  if (!enabled)
    activeTool.value = pointerEnabled.value ? 'pointer' : undefined
  else if (!activeTool.value)
    activeTool.value = 'remoteControl'
  
  activeMessage.value = 'remote'
  remoteMessage.value = t(`viewer.messages.remoteControl${enabled ? 'En' : 'Dis'}abled`)
  clearTimeout(remoteTimeout)
  remoteTimeout = window.setTimeout(() => {
    hideMessage('remote')
    remoteMessage.value = undefined
  }, 3000)
})

const draggingOver = ref(false)
const showClipboard = ref(true)
const clipboardFile = ref<File>()
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

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

onReceive("paste", (data) => {
  navigator.clipboard.writeText(data.text)
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

onReceive('pointer-enabled', (data) => {
  pointerEnabled.value = data.enabled
})

onReceive('remote-enabled', (data) => {
  remoteControlEnabled.value = data.enabled
})

let pauseTimeout: number
onReceive('pause', (data) => {
  clearTimeout(pauseTimeout)
  if (data.enabled) {
    activeMessage.value = 'paused'
    pauseTimeout = window.setTimeout(() => hideMessage('paused'), 5000)
  } else {
    activeMessage.value = 'resumed'
    pauseTimeout = window.setTimeout(() => hideMessage('resumed'), 3000)
  }
})

let hiddenTimeout: number
onReceive('hide', (data) => {
  console.log('hide', data)
  hidden.value = data.hidden
  clearTimeout(hiddenTimeout)
  if (data.hidden) {
    activeMessage.value = 'hidden'
    hiddenTimeout = window.setTimeout(() => hideMessage('hidden'), 5000)
  } else {
    activeMessage.value = 'visible'
    hiddenTimeout = window.setTimeout(() => hideMessage('visible'), 3000)
  }
})

onReceive('reset', (data) => {
  overlayRef.value?.reset(data)
})

document.body.addEventListener('contextmenu', onContextMenu)
document.body.addEventListener('keydown', preventBrowserZoom)
document.body.addEventListener("wheel", onWheel)
window.addEventListener('drop', onDrop)
window.addEventListener('dragover', onDragOver)
window.addEventListener('paste', onPaste)
window.addEventListener('copy', onCopy)
window.addEventListener('cut', onCut)

onBeforeUnmount(() => {
  document.body.removeEventListener('contextmenu', onContextMenu)
  document.body.removeEventListener('keydown', preventBrowserZoom)
  document.body.removeEventListener('wheel', onWheel)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('copy', onCopy)
  window.removeEventListener('cut', onCut)
})

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
}

// Disable Browser-Zoom
function preventBrowserZoom(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
    e.preventDefault()
  }
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey)
    e.preventDefault()
}

async function onDrop(e: DragEvent) {
  // Prevent default behavior (Prevent file from being opened)
  e.preventDefault()

  console.log('File(s) dropped')
  draggingOver.value = false

  const items = e.dataTransfer?.items
  if (!items)
    return

  activeMessage.value = 'fileUpload'
  for (let item of Array.from(items)) {
    if (item.kind === 'file')
      await sendFile(item)
  }

  hideMessage('fileUpload')
}

let fileDropTimeout: number
function onDragOver(e: DragEvent) {
  // Prevent default behavior (Prevent file from being opened)
  e.preventDefault()

  if (activeMessage.value === 'fileDrop')
    return
  
  console.log('File(s) in drop zone')
  draggingOver.value = true

  activeMessage.value = 'fileDrop'

  clearTimeout(fileDropTimeout)
  fileDropTimeout = window.setTimeout(() => {
    hideMessage('fileDrop')
  }, 5000)
}

function sendCopy(cut = false) {
  if (remoteClipboard.value)
    send('copy', {
      cut,
      tool: activeTool.value,
    }, { receiveSelf: true })
}

function onCopy() {
  sendCopy(false)
}

function onCut() {
  sendCopy(true)
}

async function onPaste(e: ClipboardEvent) {
  if (!e.clipboardData)
    return
  
  const textContent = e.clipboardData.getData('text')
  if (textContent) {
    send('text', {
      text: textContent.replace(/\r/g, ""),
      time: Date.now()
    }, { receiveSelf: true })
    return
  }

  const items = Array.from(e.clipboardData.items)
  for (let index in items) {
    const item = items[index]

    console.log('item', item)
    if (item.kind === 'string') {
      item.getAsString((clipText) => {
        send('text', {
          text: clipText.replace(/\r/g, ""),
          time: Date.now()
        }, { receiveSelf: true })
      })
    } else if (item.kind === 'file') {
      const blob = await sendFile(item)

      navigator.clipboard.write([
        new ClipboardItem({
          [item.type]: blob
        }),
      ])
    }
  }
}

let throttling = false
function freezeVideo() {
  if (throttling)
    return

  throttling = true
  window.setTimeout(() => throttling = false, 5000)

  videoRef.value?.pause()
  window.setTimeout(() => {
    videoRef.value?.play()
  }, 3500)
}

function toggleMessage(message: Message) {
  activeMessage.value = activeMessage.value === message ? undefined : message
}

function hideMessage(message: Message) {
  if (activeMessage.value === message)
    activeMessage.value = undefined
}

function sendFile(item: DataTransferItem, name?: string) {
  return new Promise<globalThis.File>((resolve, reject) => {
    const blob = item.getAsFile()!
    const reader = new FileReader()
    reader.onload = (event) => {
      const chunks = chunkFile(event.target!.result as string)

      const id = uuidv4()
      send('file', {
        id,
        name: name ?? blob.name,
        length: chunks.length
      }, { receiveSelf: true })

      for (let i = 0; i < chunks.length; i++) {
        send('file-chunk', {
          id,
          index: i,
          content: chunks[i],
        }, { receiveSelf: true })
      }

      resolve(blob)
    }
    reader.onerror = (e) => {
      console.error("Error reading file", e);
      reject(e)
    }
    reader.readAsDataURL(blob)
  })
}

function send<T extends RemoteEvent>(event: T, data: RemoteData<T>, options: SendOptions = {}) {
  screenView.value?.sendRemote(event, data)//, volatile: options.volatile ?? false)
  if (options.receiveSelf)
    receive(event, data)
}

function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
  receiveEvents[event]?.(data)
}

function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
  receiveEvents[event] = handler as ReceiveEventHandlers[T]
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

const inApp = ref(!!window.electronAPI)
const screenView = ref<ScreenView>()
const users = computed(() => Object.values(screenView.value?.participants ?? {}).map(p => p.user))
const videoRef = useTemplateRef('video')
const videoStyle = ref<Record<string, string>>({
  transform: 'scale(1) translate(0px,0px)',
})
const containerRef = useTemplateRef('container')
const containerStyle = ref<Record<string, string>>({
  overflow: 'hidden',
  width: '800px',
  height: '600px',
})
const videoTransform = ref<VideoTransform>({ x: 0, y: 0, width: 0, height: 0, fullwidth: 0, fullheight: 0 })

watch(() => props.data, async (screenShareData) => {
  if (!screenShareData) {
    containerStyle.value.overflow = 'hidden'
    screenView.value = undefined
    return
  }

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
          console.error('Failed to parse remote data:', err)
          return
        }
      }

      receive(event, parsedData)
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

  const participant = screenView.value?.presenterSocketId ? screenView.value.participants[screenView.value.presenterSocketId] : undefined
  videoStyle.value['object-fit'] = participant?.user.platform === 'mac' ? 'fill' : 'cover'

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
}

function stop() {
  screenView.value?.leave()
  screenView.value = undefined

  emit('stop')
}
</script>

<template>
  <div class="remote-viewer">
    <Toolbar class="main-toolbar" collapsible>
      <div class="btn btn-sm btn-secondary" :class="{ active: activeTool === 'pointer', disabled: !pointerEnabled }" :title="$t(`viewer.toolbar.${pointerEnabled ? 'pointer' : 'pointerDisabled'}`)" @click="pointerEnabled && (activeTool = 'pointer')">
        <PencilSvg />
      </div>
      <div class="btn btn-sm btn-secondary" :class="{ active: activeTool === 'remoteControl', disabled: !remoteControlEnabled }" :title="$t(`viewer.toolbar.${remoteControlEnabled ? 'remoteControl' : 'remoteControlDisabled'}`)" @click="remoteControlEnabled && (activeTool = 'remoteControl')">
        <MouseSvg />
      </div>
      <div class="btn btn-sm btn-secondary" :class="{ disabled: !clipboardFile }" :title="$t(`viewer.toolbar.${clipboardFile ? 'showClipboard' : 'clipboardEmpty'}`)" @click="showClipboard = !showClipboard">
        <ClipboardTextOutlineSvg />
      </div>
      <div class="btn btn-sm btn-secondary" :title="$t('viewer.toolbar.help')" @click="toggleMessage('help')">
        <HelpSvg />
      </div>
      <div class="btn btn-sm btn-secondary" :title="$t('viewer.toolbar.leave')" @click="$emit('stop')">
        <LogoutSvg />
      </div>
    </Toolbar>
    <div ref="container" class="remote-container" :style="containerStyle">
      <video ref="video" playsinline autoplay :style="videoStyle" />
      <StreamOverlay
        v-if="data"
        ref="overlay"
        :users="[...users, data.user]"
        :user-id="data.user.id"
        :video-transform="videoTransform"
        :input-enabled="!hidden"
        :pointer-enabled="pointerEnabled"
        :active-tool="activeTool"
        :dragging-over="draggingOver"
        @rescale="rescale"
        @synchronized="hideMessage('init')"
        @interacted="freezeVideo"
        @mouse-inside="remoteClipboard = $event"
        @send="send($event.event, $event.data, $event.options)"
      >
      </StreamOverlay>
    </div>
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile" :initial-rows="12" invert-collapse-icons />
    </div>
    <div v-if="activeMessage" class="message">
      <template v-if="activeMessage === 'init' || activeMessage === 'help'">
        <template v-if="activeMessage === 'init'">
          <b>{{ $t('viewer.messages.establishing') }}</b>
          <img style="float: left; margin-right: 50px" :src="LoadingDarkGif">
        </template>
        <template v-else-if="!isTouchEnabled()">
          <h4>{{ $t('viewer.messages.help.title') }}</h4>
          <br>
          <b>{{ $t('viewer.messages.help.general.title') }}</b>
          <ul>
            <li>{{ $t('viewer.messages.help.general.zoom') }}</li>
            <li>{{ $t('viewer.messages.help.general.move') }}</li>
            <li>{{ $t('viewer.messages.help.general.copy') }}</li>
          </ul>
          <b>{{ $t('viewer.messages.help.pointer.title') }}</b>
          <ul>
            <li>{{ $t('viewer.messages.help.pointer.draw') }}</li>
            <li>{{ $t('viewer.messages.help.pointer.signal') }}</li>
          </ul>
          <b>{{ $t('viewer.messages.help.remoteControl.title') }}</b>
          <br>
          {{ $t('viewer.messages.help.remoteControl.desc') }}
        </template>
      </template>
      <template v-else-if="activeMessage === 'paused'">
        <b>{{ $t('viewer.messages.paused.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.paused.description') }}
      </template>
      <template v-else-if="activeMessage === 'resumed'">
        <b>{{ $t('viewer.messages.resumed.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.resumed.description') }}
      </template>
      <template v-else-if="activeMessage === 'hidden'">
        <b>{{ $t('viewer.messages.hidden.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.hidden.description') }}
      </template>
      <template v-else-if="activeMessage === 'visible'">
        <b>{{ $t('viewer.messages.visible.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.visible.description') }}
      </template>
      <template v-else-if="activeMessage === 'fileDrop'">
        <b>{{ $t('viewer.messages.fileDrop.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.fileDrop.description') }}
      </template>
      <template v-else-if="activeMessage === 'fileUpload'">
        <b>{{ $t('viewer.messages.fileUpload.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.fileUpload.description') }}
        <img style="float: left; margin-right: 50px" :src="LoadingDarkGif">
      </template>
      <template v-else-if="activeMessage === 'remote' && remoteMessage">
        <b>{{ remoteMessage }}</b>
      </template>
    </div>
    <slot />
  </div>
</template>

<style>
  @font-face {
    font-family: 'Abel';
    font-style: normal;
    font-weight: 400;
    src: local('Abel Regular'), local('Abel-Regular'), url('../../../assets/fonts/abel-v10-latin-regular.woff2') format('woff2');
  }

  .remote-viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
  }

  .remote-viewer .remote-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .remote-viewer video {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
  }

  .remote-viewer .main-toolbar {
    cursor: default;
    position: relative;
    z-index:3000;
  }
  
  .remote-viewer .message {
    padding-left: 100px;
    position: absolute;
    bottom: 0px;
    z-index: 100;
    color: white;
    background: #000;
    padding: 20px;
    min-width: 500px;
    width: 100vw;
    opacity: 0.8;
    pointer-events: none;
  }

  .remote-viewer .clipboard-container {
    position: absolute;
    bottom: 0;
    right: 0;
    z-index: 2000;
  }

  .remote-viewer .clipboard {
    min-width: 15rem;
  }

  .remote-viewer textarea::-webkit-scrollbar {
    display: none;
  }

  /* Checkbox styles */
  .remote-viewer .checkbox-container {
    display: block;
    position: relative;
    padding-left: 5px;
    cursor: pointer;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }

  .remote-viewer .checkbox-container input {
    position: absolute;
    opacity: 0;
    cursor: pointer;
    height: 0;
    width: 0;
  }

  .remote-viewer .checkmark {
    position: absolute;
    top: 2px;
    left: 0;
    height: 15px;
    width: 15px;
    background-color: #eee;
  }

  .remote-viewer .checkbox-container:hover input ~ .checkmark {
    background-color: #ccc;
  }

  .remote-viewer .checkbox-container input:checked ~ .checkmark {
    background-color: #2196F3;
  }

  .remote-viewer .checkmark:after {
    content: "";
    position: absolute;
    display: none;
  }

  .remote-viewer .checkbox-container input:checked ~ .checkmark:after {
    display: block;
  }

  .remote-viewer .checkbox-container .checkmark:after {
    left: 3px;
    top: 0;
    width: 5px;
    height: 10px;
    border: solid white;
    border-width: 0 3px 3px 0;
    transform: rotate(45deg);
  }
</style>