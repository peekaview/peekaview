<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue"
import { useI18n } from 'vue-i18n'
import { Tooltip } from 'floating-vue'

import { notify, isTouchEnabled, getPlatform, getStoredItem, incrementRecentContacts } from '../../util'
import { ScreenView, useScreenView, ScreenShareData } from '../../composables/useSimplePeerScreenShare'
import { useRemoteHandlers } from "../../composables/useRemoteHandlers"

import StreamContainer from './StreamContainer.vue'
import Clipboard from '../../components/Clipboard.vue'
import Toolbar from "../../components/Toolbar.vue"

import { useFileChunkRegistry, chunkFile } from "../../../composables/useFileChunking"
import { usePanzoom } from './usePanzoom'

import LoadingDarkGif from '../../../assets/img/loading_dark.gif'
import ClipboardTextOutlineSvg from '../../../assets/icons/clipboard-text-outline.svg'
import HelpSvg from '../../../assets/icons/help.svg'
import LogoutSvg from '../../../assets/icons/logout.svg'
import MouseSvg from '../../../assets/icons/mouse.svg'
import PencilSvg from '../../../assets/icons/pencil.svg'

import type { File, StreamState, ViewerTool } from '../../../interface'

type Message = 'init' | 'sync' | 'help' | 'paused' | 'resumed' | 'hidden' | 'visible' | 'fileUpload' | 'fileDrop'

const ToolIcons: Record<ViewerTool, string> = {
  pointer: PencilSvg,
  remoteControl: MouseSvg,
}

const props = withDefaults(defineProps<{
  data?: ScreenShareData
}>(), {
  data: undefined,
})

const emit = defineEmits<{
  (e: 'stop'): void
}>()

const { t } = useI18n()

const containerRef = useTemplateRef<InstanceType<typeof StreamContainer>>('container')

const screenView = ref<ScreenView>()
const users = computed(() => Object.values(screenView.value?.participants ?? {}).map(p => p.user))
const stream = ref<MediaStream>()

watch(() => screenView.value?.participants, async (participants) => {
  const socketId = screenView.value?.presenterSocketId
  if (!participants || !socketId)
    return

  const presenter = participants[socketId]
  if (presenter)
    incrementRecentContacts([presenter.user])
}, { deep: true })

const streamState = ref<StreamState>('stopped')
let streamStateTimeout: number
watch(streamState, (state) => {
  switch (state) {
    case 'hidden':
      activeTool.value = undefined
      activeMessage.value = 'hidden'
      clearTimeout(streamStateTimeout)
      streamStateTimeout = window.setTimeout(() => hideMessage('hidden'), 5000)
      break
    case 'paused':
      activeTool.value = undefined
      activeMessage.value = 'paused'
      clearTimeout(streamStateTimeout)
      streamStateTimeout = window.setTimeout(() => hideMessage('paused'), 5000)
      break
    case 'active':
      activeTool.value = toolsEnabled.value[lastActiveTool.value] ? lastActiveTool.value : getNextEnabledTool()
      activeMessage.value = 'resumed'
      clearTimeout(streamStateTimeout)
      streamStateTimeout = window.setTimeout(() => hideMessage('resumed'), 3000)
      break
    case 'stopped':
      activeTool.value = undefined
      break
  }
})

const inputEnabled = computed(() => streamState.value === 'active')
const toolsEnabled = ref({
  pointer: true,
  remoteControl: false,
})
const remoteClipboard = ref(false)
const activeTool = ref<ViewerTool | undefined>('pointer')
const lastActiveTool = ref<ViewerTool>('pointer')
watch(activeTool, (tool) => {
  if (tool)
    lastActiveTool.value = tool
})

const activeMessage = ref<Message | undefined>('init')

watch(() => toolsEnabled.value.pointer, (enabled) => {
  toggleTool('pointer', enabled)
  if (!enabled)
    containerRef.value?.clear()
})

watch(() => toolsEnabled.value.remoteControl, (enabled) => {
  toggleTool('remoteControl', enabled)
})

let tooltipTimeout: number
const tooltipContent = ref<string | undefined>()
const tooltipTool = ref<ViewerTool | undefined>()
function toggleTool(tool: ViewerTool, enabled: boolean) {
  if (!enabled) {
    activeTool.value = getNextEnabledTool()
  }
  else if (!activeTool.value)
    activeTool.value = tool
  
  tooltipContent.value = t(`viewer.messages.${tool}${enabled ? 'En' : 'Dis'}abled`)
  tooltipTool.value = tool
  clearTimeout(tooltipTimeout)
  tooltipTimeout = window.setTimeout(() => {
    tooltipContent.value = undefined
    tooltipTool.value = undefined
  }, 10000)
}

function getNextEnabledTool() {
  for (let key in toolsEnabled.value) {
    if (toolsEnabled.value[key as ViewerTool])
      return key as ViewerTool
  }
  return undefined
}

const panzoomActive = ref(false)
const videoFill = ref(false)
const hideOverflow = ref(true)
const presenterInBrowser = ref(false)
const { currentPan, currentPanScale, zoom, doZoom, onPanzoomChange } = usePanzoom(computed(() => containerRef.value?.$el), panzoomActive, inputEnabled)
watch(() => [currentPan.x, currentPan.y, currentPanScale.value], () => {
  const participant = screenView.value?.presenterSocketId ? screenView.value.participants[screenView.value.presenterSocketId] : undefined
  videoFill.value = participant?.user.platform === 'mac'
  hideOverflow.value = false
}, { immediate: true })

const draggingOver = ref(false)
const showClipboard = ref(true)
const clipboardFile = ref<File>()
const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

const { send, receive, onReceive } = useRemoteHandlers(screenView)

onReceive("mouse-leftclick", (data) => {
  containerRef.value?.receiveMouseLeftClick(data)
})

onReceive("mouse-move", (data) => {
  containerRef.value?.receiveMouseMove(data)
})

onReceive("mouse-down", (data) => {
  if (!draggingOver.value)
    containerRef.value?.receiveMouseDown(data)
})

onReceive("mouse-up", (data) => {
  containerRef.value?.receiveMouseUp(data)
})

onReceive("text", (data) => {
  console.log("text", data)

  navigator.clipboard.writeText(data.text)
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

onReceive('reset', (data) => {
  console.log('reset', data)

  presenterInBrowser.value = data.inBrowser
  toolsEnabled.value = data.toolsEnabled
  streamState.value = data.streamState

  containerRef.value?.reset(data)
})

watch(() => props.data, async (screenShareData) => {
  if (!screenShareData) {
    hideOverflow.value = true
    screenView.value = undefined
    return
  }

  screenView.value = await useScreenView(screenShareData, {
    onStream: (s) => {
      stream.value = s
      stream.value.getVideoTracks()[0].onended = () => {
        stop()
      }
      hideMessage('init')
    },
    onRemote: (event, data) => {
      let parsedData = data
      if (typeof data === 'string' && event !== 'reset') { //TODO: align data format of 'reset' with other events
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
  hideOverflow.value = false
}, { flush: 'post', immediate: true })

document.addEventListener('contextmenu', onContextMenu)
document.addEventListener("wheel", onWheel as EventListener, false)
document.addEventListener('keydown', onKeydown, false)
window.addEventListener('resize', onResize)
window.addEventListener('drop', onDrop)
window.addEventListener('dragover', onDragOver as EventListener, false)
window.addEventListener('paste', onPaste)
window.addEventListener('copy', onCopy)
window.addEventListener('cut', onCut)

onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', onContextMenu)
  document.removeEventListener('wheel', onWheel as EventListener, false)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('dragover', onDragOver as EventListener, false)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('copy', onCopy)
  window.removeEventListener('cut', onCut)
})

function onResize() {
  hideOverflow.value = false
}

function onContextMenu(e: MouseEvent) {
  // disable context menu
  e.preventDefault()
}

function onKeydown(e: KeyboardEvent) {
  // prevent browser zoom
  if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
    e.preventDefault()
  }
}

function onWheel(e: WheelEvent) {
  // prevent browser zoom
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
  } else if (e.shiftKey) {
    // Use deltaY with normalization
    // Different browsers and input devices may report different deltaY values
    // Normalize to ensure consistent behavior
    const delta = e.deltaY || e.detail || (e as any).wheelDelta
    console.log("zoom delta:", delta)
    
    if (delta !== 0) {
      e.preventDefault()
      doZoom(getPlatform() === 'mac' ? -delta : delta)
    }
  }
}

async function onDrop(e: DragEvent) {
  // prevent file from being opened
  e.preventDefault()

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
  // prevent file from being opened
  e.preventDefault()

  if (activeMessage.value === 'fileDrop')
    return
  
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
    reader.onload = async (event) => {
      const chunks = chunkFile(event.target!.result as string)

      const id = (await getStoredItem('uuid'))!
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

function stop() {
  screenView.value?.leave()
  screenView.value = undefined

  emit('stop')
}
</script>

<template>
  <div ref="viewer" class="remote-viewer">
    <Toolbar class="main-toolbar" collapsible>
      <Tooltip
        v-for="(enabled, tool) in toolsEnabled"
        :key="tool"
        :triggers="[]"
        :shown="!!tooltipContent && tooltipTool === tool"
      >
        <div class="btn btn-sm btn-secondary" :class="{ active: activeTool === tool, disabled: !enabled || !inputEnabled }" :title="$t(`viewer.toolbar.${enabled && inputEnabled ? tool : `${tool}Disabled`}`)" @click="enabled && inputEnabled && (activeTool = tool)">
          <component :is="ToolIcons[tool]" />
        </div>
        <template #popper>
          {{ tooltipContent }}
        </template>
      </Tooltip>
      <div class="btn btn-sm btn-secondary" :class="{ active: showClipboard, disabled: !clipboardFile }" :title="$t(`viewer.toolbar.${clipboardFile ? 'showClipboard' : 'clipboardEmpty'}`)" @click="showClipboard = !showClipboard">
        <ClipboardTextOutlineSvg />
      </div>
      <div class="btn btn-sm btn-secondary" :class="{ active: activeMessage === 'help' }" :title="$t('viewer.toolbar.help')" @click="toggleMessage('help')">
        <HelpSvg />
      </div>
      <div class="btn btn-sm btn-secondary" :title="$t('viewer.toolbar.leave')" @click="stop">
        <LogoutSvg />
      </div>
    </Toolbar>
    <StreamContainer
      v-if="data"
      ref="container"
      :stream="stream"
      :users="[...users, data.user]"
      :user-id="data.user.id"
      :input-enabled="inputEnabled"
      :active-tool="activeTool"
      :zoom-scale="zoom?.scale"
      :freeze-on-interaction="presenterInBrowser"
      :video-options="{ playsinline: true, autoplay: true, fill: videoFill }"
      :style="{ overflow: hideOverflow ? 'hidden' : 'visible' }"
      @send="send($event.event, $event.data, $event.options)"
      @mouse-inside="remoteClipboard = $event"
      @panzoom-toggle="panzoomActive = $event"
      @panzoomchange="onPanzoomChange"
      @contextmenu="() => false"
    >
      <div v-if="streamState !== 'active'" class="text-overlay">
        <span>{{ $t(`viewer.streamState.${streamState}`) }}</span>
      </div>
    </StreamContainer>
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile" :initial-rows="12" collapsible invert-collapse-icons />
    </div>
    <div v-if="activeMessage" class="message">
      <template v-if="activeMessage === 'init' || activeMessage === 'help'">
        <template v-if="activeMessage === 'init'">
          <b>{{ $t('viewer.messages.init') }}</b>
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
      <template v-else>
        <b>{{ $t(`viewer.messages.${activeMessage}.title`) }}</b>
        <br>
        <br>
        {{ $t(`viewer.messages.${activeMessage}.description`) }}
        <img v-if="activeMessage === 'fileUpload'" style="float: left; margin-right: 50px" :src="LoadingDarkGif">
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

  .remote-viewer video {
    max-width: 100%;
    max-height: 100%;
  }

  .remote-viewer .main-toolbar {
    cursor: default;
    position: absolute;
    top: 0.125rem;
    right: 0.5rem;
    z-index: 3000;
  }

  .remote-viewer .text-overlay {
    display: flex;
    justify-content: center;
    align-items: center;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #0008;
  }

  .remote-viewer .text-overlay span {
    color: #ddd;
    background: #000;
    padding: 0.25em 0.5em;
    border-radius: 10px;
  }

  .remote-viewer .message {
    position: absolute;
    bottom: 0px;
    z-index: 3000;
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
</style>