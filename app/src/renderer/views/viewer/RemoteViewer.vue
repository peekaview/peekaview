<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"

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

import type { RemoteData, RemoteEvent, File, UserData } from '../../../interface'
import type { ScaleInfo, VideoTransform } from "../../types.js"
import { useI18n } from "vue-i18n"

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
}

const props = withDefaults(defineProps<{
  room: string
  inApp: boolean
  users: UserData[]
  userId: string
  videoTransform?: VideoTransform
}>(), {
  users: () => [],
  videoTransform: () => ({ x: 0, y: 0, width: 0, height: 0, fullwidth: 0, fullheight: 0 }),
})

const emit = defineEmits<{
  (e: 'stop'): void
  (e: 'rescale', scaleinfo: ScaleInfo): void
  (e: 'freeze'): void
  (e: 'unfreeze'): void
  <T extends RemoteEvent>(e: 'send', data: { event: T, data: RemoteData<T>, volatile: boolean }): void
}>()

const { t } = useI18n()

const overlayRef = useTemplateRef<InstanceType<typeof StreamOverlay>>('overlay')

const receiveEvents: Partial<ReceiveEventHandlers> = {}

const hidden = ref(false)
const mouseEnabled = ref(true)
const remoteControlActive = ref(false)
const remoteClipboard = ref(false)

let remoteTimeout: number
watch(mouseEnabled, (enabled) => {
  if (activeMessage.value === 'init')
    return

  activeMessage.value = 'remote'
  remoteMessage.value = t(`viewer.messages.mouse${enabled ? 'En' : 'Dis'}abled`)
  clearTimeout(remoteTimeout)
  remoteTimeout = window.setTimeout(() => {
    hideMessage('remote')
    remoteMessage.value = undefined
  }, 3000)
})

watch(remoteControlActive, (active) => {
  if (activeMessage.value === 'remote')
    return
  
  activeMessage.value = 'remote'
  remoteMessage.value = t(`viewer.messages.remoteControl${active ? 'En' : 'Dis'}abled`)
  clearTimeout(remoteTimeout)
  remoteTimeout = window.setTimeout(() => {
    hideMessage('remote')
    remoteMessage.value = undefined
  }, 3000)
})

const sizeInfoStyle = computed(() => props.videoTransform ? {
  width: props.videoTransform.fullwidth + "px",
  height: props.videoTransform.fullheight + "px",
  left: (props.videoTransform.x - 2) + "px",
  top: (props.videoTransform.y - 2) + "px"
}: {})

const activeMessage = ref<string | undefined>('init')
const remoteMessage = ref<string>()
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

onReceive('mouse-control', (data) => {
  mouseEnabled.value = data.enabled
})

onReceive('remote-control', (data) => {
  remoteControlActive.value = data.enabled
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

onMounted(() => {
  document.body.addEventListener('contextmenu', onContextMenu)
  document.body.addEventListener('keydown', preventBrowserZoom)
  document.body.addEventListener("wheel", onWheel)
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('paste', onPaste)
  window.addEventListener('copy', onCopy)
  window.addEventListener('cut', onCut)
})

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

function onCopy() {
  if (remoteClipboard.value)
    send('copy', {
      room: props.room,
    }, { receiveSelf: true })
}

function onCut() {
  if (remoteClipboard.value)
    send('cut', {
      room: props.room,
    }, { receiveSelf: true })
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

  emit('freeze')
  window.setTimeout(() => {
    emit('unfreeze')
  }, 3500)
}

function toggleMessage(message: string) {
  activeMessage.value = activeMessage.value === message ? undefined : message
}

function hideMessage(message: string) {
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
  emit('send', { event, data, volatile: options.volatile ?? false })
  if (options.receiveSelf)
    receive(event, data)
}

function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
  receiveEvents[event]?.(data)
}

function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
  receiveEvents[event] = handler as ReceiveEventHandlers[T]
}

defineExpose({
  receive
})
</script>

<template>
  <div class="remote-viewer">
    <StreamOverlay
      ref="overlay"
      :input-enabled="!hidden"
      :users="users"
      :user-id="userId"
      :video-transform="videoTransform"
      :mouse-enabled="mouseEnabled"
      :remote-control-active="remoteControlActive"
      :dragging-over="draggingOver"
      @rescale="emit('rescale', $event)"
      @synchronized="hideMessage('init')"
      @interacted="freezeVideo"
      @mouse-inside="remoteClipboard = $event"
      @send="send($event.event, $event.data, $event.options)"
    >
    </StreamOverlay>
    <div class="size-info" :style="sizeInfoStyle"></div>
    <div v-if="activeMessage" class="message">
      <template v-if="activeMessage === 'init' || activeMessage === 'mouseHelp'">
        <template v-if="activeMessage === 'init'">
          <b>{{ $t('viewer.messages.establishing') }}</b>
          <img style="float: left; margin-right: 50px" :src="LoadingDarkGif">
        </template>
        <b v-else>{{ $t('viewer.messages.mouseHelp.title') }}</b>
        <br>
        <br>
        <template v-if="!isTouchEnabled()">
          {{ $t('viewer.messages.mouseHelp.zoom') }}
          <br>
          {{ $t('viewer.messages.mouseHelp.move') }}
          <br>
          {{ $t('viewer.messages.mouseHelp.draw') }}
          <br>
          {{ $t('viewer.messages.mouseHelp.copy') }}
        </template>
      </template>
      <template v-else-if="activeMessage === 'paused'">>
        <b>{{ $t('viewer.messages.paused.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.paused.description') }}
      </template>
      <template v-else-if="activeMessage === 'resumed'">>
        <b>{{ $t('viewer.messages.resumed.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.resumed.description') }}
      </template>
      <template v-else-if="activeMessage === 'hidden'">>
        <b>{{ $t('viewer.messages.hidden.title') }}</b>
        <br>
        <br>
        {{ $t('viewer.messages.hidden.description') }}
      </template>
      <template v-else-if="activeMessage === 'visible'">>
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
    <Toolbar class="main-toolbar" collapsible>
      <div class="btn btn-sm btn-secondary" :class="{ disabled: !clipboardFile }" title="Show clipboard" @click="showClipboard = !showClipboard">
        <ClipboardTextOutlineSvg />
      </div>
      <div class="btn btn-sm btn-secondary" title="Help" @click="toggleMessage('mouseHelp')">
        <HelpSvg />
      </div>
      <div class="btn btn-sm btn-secondary" title="Leave" @click="$emit('stop')">
        <LogoutSvg />
      </div>
    </Toolbar>
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile" />
    </div>
  </div>
</template>

<style>
  @font-face {
    font-family: 'Abel';
    font-style: normal;
    font-weight: 400;
    src: local('Abel Regular'), local('Abel-Regular'), url('../../../assets/fonts/abel-v10-latin-regular.woff2') format('woff2');
  }

  .remote-viewer .clipboard-container {
    position: absolute;
    bottom: 0;
    right: 0;
    z-index: 300;
  }

  .remote-viewer .main-toolbar {
    z-index: 2000;
    position: absolute;
    top: 0px;
    left: 50%;
  }

  .remote-viewer .size-info {
    padding: 0px;
    margin: 0px;
    position: absolute;
    z-index: 2
  }

  .remote-viewer .item {
    z-index: 100;
    padding: 5px;
  }

  .remote-viewer .item img {
    width: 150px;
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

  /* Common button styles */
  .remote-viewer .button, .remote-viewer .recordoverlayclosebutton {
    cursor: pointer;
    line-height: 10px;
    text-align: center;
    padding: 5px 0;
    border: 1px solid #404040;
    color: #aaa;
    font-family: Abel;
    font-size: 10px;
    background: #2a2a2a;
  }

  .remote-viewer .button:hover, .remote-viewer .recordoverlayclosebutton:hover {
    background: #404040 !important;
    border-color: #505050;
    color: #ddd;
  }

  /* Specialized buttons */
  .remote-viewer .dragbutton {
    float: right;
    padding: 3px 0;
    margin-right: 15px;
    width: 20px;
    user-select: none;
    -webkit-user-select: none;
    -webkit-app-region: drag;
  }

  /* Textarea styles */
  .remote-viewer .clipboard textarea {
    max-height: 120px;
    max-width: 170px;
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

  .remote-viewer .main-toolbar {
    cursor: default;
  }
</style>