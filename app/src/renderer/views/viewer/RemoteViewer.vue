<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRef, useTemplateRef, watch } from "vue"

import SignalContainer from "./SignalContainer.vue"
import Clipboard from '../../components/Clipboard.vue'
import Toolbar from "../../components/Toolbar.vue"

import { useFileChunkRegistry, chunkFile } from "../../../composables/useFileChunking"
import { useDrawOverlay } from "../../composables/useDrawOverlay"
import { uuidv4 } from "../../../util.js"
import { isTouchEnabled } from "../../util.js"

import LoadingDarkGif from '../../../assets/img/loading_dark.gif'
import ClipboardTextOutlineSvg from '../../../assets/icons/clipboard-text-outline.svg'
import HelpSvg from '../../../assets/icons/help.svg'
import LogoutSvg from '../../../assets/icons/logout.svg'

import type { RemoteData, RemoteEvent, RemoteMouseData, RemoteResetData, File, UserData } from '../../../interface.d.ts'
import type { ScaleInfo, Signal, VideoTransform } from "../../types.js"
import { useKeyListeners } from "./useEventListeners"
import { usePanzoom } from "./usePanzoom"

type MouseMessage = {
  x: number
  y: number
  room?: string
  userId: string
  delta?: number
}

type Cursor = {
  name?: string
  color: string
  left: string
  top: string
  lastAction: number
}

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
}

const props = withDefaults(defineProps<{
  room: string
  inBrowser: boolean
  users: UserData[]
  userId: string
  hostname: string
  videoTransform?: VideoTransform
}>(), {
  users: () => [],
  videoTransform: () => ({ x: 0, y: 0, width: 0, height: 0, fullwidth: 0, fullheight: 0 }),
})

const emit = defineEmits<{
  (e: 'stop'): void
  (e: 'rescale', scaleinfo: ScaleInfo): void
  <T extends RemoteEvent>(e: 'send', data: { event: T, data: RemoteData<T>, volatile: boolean }): void
}>()

const overlayRef = useTemplateRef('overlay')

const receiveEvents: Partial<ReceiveEventHandlers> = {}

const mappedUsers = computed(() => {
  const users: Record<string, UserData> = {}
  for (const user of props.users)
    users[user.id] = user

  return users
})

// Skalierungsinfos
const videoScale = ref(1)
const remoteScale = ref(1)
const totalScale = computed(() => videoScale.value * remoteScale.value)
const windowDimensions = reactive({ width: 0, height: 0 })

// Screensharing oder Windowsharing aktiv?
const isSharingScreen = ref(true)
let lastResetData: RemoteResetData | undefined

// Maus-Overlays
const signals = reactive<Record<string, Signal>>({})
const overlayCursors = reactive<Record<string, Cursor>>({})
let cursorcheckinterval: number

// Remote-Funktionen
const mouseEnabled = ref(true)
const remoteControlActive = ref(false)
let mousedown = false
let dragdetected = false
let synchronized = false
const remoteClipboard = ref(false)

// Websocket-Message Object
let currentMouseData: RemoteMouseData = {
  x: 0,
  y: 0,
  userId: props.userId,
  draw: false
}
let lastMouseData: RemoteMouseData

// Drawing state
const canvasRef = useTemplateRef('canvas')
const drawOverlay = useDrawOverlay(canvasRef, {
  scale: totalScale,
  dimensions: computed(() => props.videoTransform ? [props.videoTransform!.fullwidth, props.videoTransform!.fullheight] : undefined),
  users: mappedUsers
})

const { pressed, onKeyDown, onKeyUp } = useKeyListeners(key => send('type', { key }, { receiveSelf: true }))
const { currentPan, currentPanScale, lastPan, zoom, doZoom, onPanzoomChange } = usePanzoom(overlayRef, toRef(pressed.space))

watch(() => [windowDimensions.width, windowDimensions.height, currentPan, currentPanScale.value], () => {
  updateVideoScale({
    x: currentPan.x,
    y: currentPan.y,
    scale: currentPanScale.value,
    width: windowDimensions.width,
    height: windowDimensions.height
  })
})

const overlayStyle = computed(() => {
  const style = {
    border: '1px solid blue',
    // Bei Screensharing sieht man den Remotemauszeiger, daher den eigenen durch ein feines Crosshair ersetzen
    cursor: isSharingScreen.value ? 'url(img/minicrosshair.png) 5 5, auto' : 'default',
    width: '0',
    height: '0',
    left: '0',
    top: '0',
  }
  if (props.videoTransform) {
    style.width = props.videoTransform.width + "px"
    style.height = props.videoTransform.height + "px"
    style.left = Math.round((props.videoTransform.x - 2) - (props.videoTransform.fullwidth / props.videoTransform.width * lastPan.x) + ((props.videoTransform.fullwidth - props.videoTransform.width) / 2)) + "px"
    style.top = Math.round((props.videoTransform.y - 2) - (props.videoTransform.fullwidth / props.videoTransform.width * lastPan.y) + ((props.videoTransform.fullheight - props.videoTransform.height) / 2)) + "px"
  }
  return style
})

const sizeInfoStyle = computed(() => props.videoTransform ? {
  width: props.videoTransform.fullwidth + "px",
  height: props.videoTransform.fullheight + "px",
  left: (props.videoTransform.x - 2) + "px",
  top: (props.videoTransform.y - 2) + "px"
}: {})

const sharerToolbarBoundsStyle = ref<Record<string, string> | undefined>()
const activeMessage = ref<string | undefined>()
const remoteControlMessage = ref<string>()
const draggingOver = ref(false)
const showClipboard = ref(true)
const clipboardFile = ref<File>()

const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

onReceive("getclipboard", (data) => {
  console.log("getclipboard", data)

  navigator.clipboard.writeText(data.text)
})

onReceive("mouse-leftclick", (data) => {
  if (!remoteControlActive.value && !data.draw)
    mouseSignal(data)
    
  drawOverlay.endStroke(data.userId)
})

onReceive("mouse-move", (data) => {
  if (!remoteControlActive.value || data.draw) {
    drawOverlay.continueStroke(data.userId, [data.x, data.y])
  }

  mouseMove(data)
})

onReceive("mouse-down", (data) => {
  if ((!remoteControlActive.value && !draggingOver.value) || data.draw)
    drawOverlay.startStroke(data.userId, [data.x, data.y])
})

onReceive("mouse-up", (data) => {
  drawOverlay.endStroke(data.userId)
})

onReceive("file", (data) => {
  console.log("file", data)
  fileChunkRegistry.register(data)
})

onReceive("file-chunk", (data) => {
  fileChunkRegistry.receiveChunk(data)
})

onReceive('reset', (data) => {
  isSharingScreen.value = data.isScreen

  const remoteScaleHeight = props.videoTransform.height / (data.dimensions.bottom - data.dimensions.top)
  const remoteScaleWidth = props.videoTransform.width / (data.dimensions.right - data.dimensions.left)
  remoteScale.value = remoteScaleHeight < remoteScaleWidth ? remoteScaleHeight : remoteScaleWidth

  // Speichern der Fensterabmessungen
  windowDimensions.width = data.dimensions.right - data.dimensions.left
  windowDimensions.height = data.dimensions.bottom - data.dimensions.top

  // Skalierungsinfos und Mauszeigerposition mit Remote-App synchronisiert
  synchronized = !!lastResetData && lastResetData.dimensions.left == data.dimensions.left && lastResetData.dimensions.right == data.dimensions.right && lastResetData.dimensions.top == data.dimensions.top && lastResetData.dimensions.bottom == data.dimensions.bottom
  calcScale()

  sharerToolbarBoundsStyle.value = (isSharingScreen.value && data.toolbarBounds) ? {
    left: totalScale.value * (data.toolbarBounds.x - data.dimensions.left) + "px",
    top: totalScale.value * (data.toolbarBounds.y - data.dimensions.top) + "px",
    width: totalScale.value * data.toolbarBounds.width + "px",
    height: totalScale.value * data.toolbarBounds.height + "px"
  } : undefined

  if (synchronized)
    hideMessage('mouseSync')

  // Maus-Zeigermodus aktiviert/deaktiviert
  if ((!lastResetData || mouseEnabled.value != data.mouseenabled) && activeMessage.value !== 'mouseSync') {
    mouseEnabled.value = data.mouseenabled
    activeMessage.value = 'remoteControl'
    remoteControlMessage.value = mouseEnabled.value ? 'Remote-Mauszeiger ist nun aktiviert' : 'Remote-Mauszeiger wurde deaktiviert'
    setTimeout(() => {
      hideMessage('remoteControl')
      remoteControlMessage.value = undefined
    }, 3000)
    if (!mouseEnabled.value) {
      clearMouseCursors()
    }
  }

  // Maus/Tastatursteuerung aktiviert/deaktiviert
  if ((!lastResetData || remoteControlActive.value != data.remotecontrol) && activeMessage.value !== 'remoteControl') {
    remoteControlActive.value = data.remotecontrol
    activeMessage.value = 'remoteControl'
    remoteControlMessage.value = remoteControlActive.value ? 'Fernzugriff ist jetzt aktiviert' : 'Fernzugriff wurde deaktiviert'
    setTimeout(() => {
      hideMessage('remoteControl')
      remoteControlMessage.value = undefined
    }, 3000)
  }
  lastResetData = data
})

onMounted(() => {
  document.body.addEventListener('contextmenu', onContextMenu)
  document.body.addEventListener('keydown', preventBrowserZoom, false)
  document.body.addEventListener("wheel", onWheel, { passive: false })
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('resize', calcScale)
  window.addEventListener('blur', handleMouseUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
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
  window.removeEventListener('resize', calcScale)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('copy', onCopy)
  window.removeEventListener('cut', onCut)
})

let lastPosX = 0
let lastPosY = 0
let lastMove = 0
function onOverlayMouseMove(e: MouseEvent) {
  if (!mouseEnabled.value || !synchronized) return false
  remoteClipboard.value = true

  const rect = overlayRef.value!.getBoundingClientRect()
  const x = e.pageX - rect.left
  const y = e.pageY - rect.top

  currentMouseData = {
    x: Math.round(x / (totalScale.value * (zoom.value?.scale ?? 1))),
    y: Math.round(y / (totalScale.value * (zoom.value?.scale ?? 1))),
    userId: props.userId,
    draw: pressed.control,
  }

  if ((lastMouseDown > 0 && lastMove < Date.now() - 10) || 
    (lastMove < Date.now() - 100) || 
    (lastMove < Date.now() - 50 && (Math.abs(lastPosX - x) < 3 || Math.abs(lastPosY - y) < 3))) {
    lastMove = Date.now()
    send("mouse-move", currentMouseData, { receiveSelf: true, volatile: true })
  }

  lastPosX = x
  lastPosY = y

  e.preventDefault()
  return false
}

let lastWheel = 0
function onOverlayWheel(e: WheelEvent) {
  if (e.ctrlKey) return

  if (lastWheel < (Date.now() - 200)) {
    console.log(e)
    currentMouseData.delta = e.deltaY
    lastWheel = Date.now()
    send("mouse-wheel", currentMouseData, { receiveSelf: true })
  }
}

function onOverlayMouseDown(e: MouseEvent) {
  if (!mouseEnabled.value)
    return

  if (e.which == 3)
    sendMouseClick()
  else
    sendMouseDown(e)

  lastMouseData = currentMouseData
}

// virtueller Mauszeiger
function mouseMove(data: MouseMessage) {
  // Mauszeiger erstellen (nur bei Windowsharing, beim Screensharing bleibt stattdessen der Remotemauszeiger sichtbar)
  if (!synchronized || isSharingScreen.value)
    return

  const user = mappedUsers.value[data.userId]
  if (!overlayCursors[user.id]) {
    overlayCursors[user.id] = {
      name: user.name,
      color: user.color,
      left: '0',
      top: '0',
      lastAction: 0
    }
    
    if (cursorcheckinterval === undefined) {
      cursorcheckinterval = window.setInterval(() => {
        clearMouseCursors()
      }, 1000)
    }
  }

  overlayCursors[user.id].left = Math.round(data.x * totalScale.value) + "px"
  overlayCursors[user.id].top = Math.round(data.y * totalScale.value) + "px"
  overlayCursors[user.id].lastAction = Date.now()
}

let eventToSend: number | undefined
let lastMouseDown = 0
let moveHandler: ((event: MouseEvent) => void) | undefined

function handleMouseUp() {
  if (lastMouseDown > 0) {
    send("mouse-up", currentMouseData, { receiveSelf: true, volatile: true })
    clearTimeout(eventToSend)
    eventToSend = undefined
    lastMouseDown = 0
  }
}

function sendMouseClick() {
  mousedown = false
  lastMouseDown = 0
  //lastclick = 0
  console.log("mouse-rightclick")
  send("mouse-click", currentMouseData, { receiveSelf: true, volatile: true })
}

function sendMouseDown(e: MouseEvent) {
  if (lastMouseDown !== 0)
    return
  
  dragdetected = false
  lastMouseDown = Date.now()
  mousedown = false

  // Store initial cursor position
  const initialX = e.clientX
  const initialY = e.clientY

  // Add mousemove handler to check distance
  moveHandler = (moveEvent) => {
    const deltaX = moveEvent.clientX - initialX
    const deltaY = moveEvent.clientY - initialY
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    
    if (distance > 5) {
      // Clear the delayed event since we're sending immediately
      clearTimeout(eventToSend)
      eventToSend = undefined
      dragdetected = true
      mousedown = true
      
      console.log("mouse-down (immediate due to movement)")
      send("mouse-down", { ...lastMouseData, draw: pressed.control }, { receiveSelf: true, volatile: true })
      
      // Remove this handler since we've triggered the event
      moveHandler && document.removeEventListener('mousemove', moveHandler)
      moveHandler = undefined
    }
  }
  
  document.addEventListener('mousemove', moveHandler)
  
  eventToSend = window.setTimeout(() => {
    mousedown = true
    console.log("mouse-down")
    send("mouse-down", { ...lastMouseData, draw: pressed.control }, { receiveSelf: true, volatile: true })
  }, 120)
}

function sendMouseUp() {
  if (moveHandler !== undefined) {
    document.removeEventListener('mousemove', moveHandler)
    moveHandler = undefined
  }
  if (eventToSend !== undefined) {
    clearTimeout(eventToSend)
    eventToSend = undefined
  }

  if (mousedown || dragdetected) {
    console.log("mouse-up")
    send("mouse-up", { ...currentMouseData, draw: pressed.control }, { receiveSelf: true, volatile: true })
  } else {
    console.log("mouse-leftclick")
    send("mouse-leftclick", { ...lastMouseData, draw: pressed.control }, { receiveSelf: true, volatile: true })
  }

  mousedown = false
  lastMouseDown = 0
}

function clearMouseCursors() {
  for (const id in overlayCursors) {
    if (overlayCursors[id].lastAction < (Date.now() - 10000))
      delete overlayCursors[id]
  }
}

// Signal einblenden bei Mausklick für 2000ms
function mouseSignal(data: MouseMessage) {
  if (!remoteControlActive.value && !isSharingScreen.value) {
    const user = mappedUsers.value[data.userId]
    signals[user.id] = {
      color: user.color,
      left: Math.round(data.x * totalScale.value - 150) + "px",
      top: Math.round(data.y * totalScale.value - 150) + "px"
    }

    setTimeout(() => {
      if (signals[user.id])
        delete signals[user.id]
    }, 2000)
  }
}

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

function onDrop(e: DragEvent) {
  // Prevent default behavior (Prevent file from being opened)
  e.preventDefault()

  console.log('File(s) dropped')
  draggingOver.value = false

  activeMessage.value = 'fileUpload'

  const items = e.dataTransfer?.items
  if (items) {
    // Use DataTransferItemList interface to access the file(s)
    Array.from(items).forEach(item => {
      // If dropped items aren't files, reject them
      if (item.kind === 'file')
        sendFile(item)
    })
  }/* else {
    // Use DataTransfer interface to access the file(s)
    [...ev.dataTransfer.files].forEach((file, i) => {
    console.log(`… file[${i}].name = ${file.name}`)
    })
  }*/
}

function onDragOver(e: DragEvent) {
  // Prevent default behavior (Prevent file from being opened)
  e.preventDefault()

  if (activeMessage.value === 'fileDrop')
    return
  
  console.log('File(s) in drop zone')
  draggingOver.value = true

  activeMessage.value = 'fileDrop'

  setTimeout(() => {
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

  const items = e.clipboardData.items
  for (let index in items) {
    const item = items[index]

    if (item.kind === 'string' && item.type.match('^text/plain')) {
      //alert('paste text')
      item.getAsString((clipText) => {
        send('paste', {
          text: clipText.replace(/\r/g, ""),
          time: Date.now()
        }, { receiveSelf: true })
      })
    } else if (item.kind === 'string' && item.type.match('^text/html')) {
      // Drag data item is HTML
      item.getAsString((clipText) => {
        send('paste', {
          text: clipText.replace(/\r/g, ""),
          time: Date.now()
        }, { receiveSelf: true })
      })
      //alert('paste html')
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

let lastScaleInfo: ScaleInfo | undefined
function updateVideoScale(scaleInfo: ScaleInfo) {
  if (!lastScaleInfo || scaleInfo.x != lastScaleInfo.x || scaleInfo.y != lastScaleInfo.y || scaleInfo.scale != lastScaleInfo.scale || scaleInfo.width != lastScaleInfo.width || scaleInfo.height != lastScaleInfo.height) {
    console.debug('updateVideoScale', scaleInfo)
    emit('rescale', scaleInfo)
  }
  lastScaleInfo = scaleInfo
}

function calcScale() {
  const scaleX = overlayRef.value!.getBoundingClientRect().width / props.videoTransform.width
  const scaleY = overlayRef.value!.getBoundingClientRect().height / props.videoTransform.height

  videoScale.value = scaleX < scaleY ? scaleX : scaleY
  if (videoScale.value > 1) {
    videoScale.value = 1
  }
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
  console.log("send", event, data, options)
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
  <div class="remote-viewer" @wheel="doZoom">
    <div
      ref="overlay"
      class="overlay"
      :style="overlayStyle"
      @mouseenter="remoteClipboard = true"
      @mouseleave="handleMouseUp"
      @mousemove="onOverlayMouseMove"
      @mouseup="mouseEnabled && sendMouseUp()"
      @mousedown="onOverlayMouseDown"
      @wheel="onOverlayWheel"
      @panzoomchange="onPanzoomChange"
      @contextmenu="() => false"
    >
      <div v-for="(cursor, cursorId) in overlayCursors" :key="cursorId" class="cursor">
        <div v-if="cursorId !== userId && cursor.name" class="cursor-name" :style="{ border: `1px solid #${cursor.color}`, color: `#${cursor.color}` }"> {{ cursor.name }}</div>
      </div>
      <SignalContainer v-for="(signal, signalId) in signals" :key="signalId" class="signal" :signal="signal" />
      <div v-if="sharerToolbarBoundsStyle" class="sharer-toolbar-bounds" :style="sharerToolbarBoundsStyle"></div>
      <canvas ref="canvas" />
    </div>
    <div class="size-info" :style="sizeInfoStyle"></div>
    <div v-if="activeMessage" class="message">
      <template v-if="activeMessage === 'mouseSync' || activeMessage === 'mouseHelp'">
        <template v-if="activeMessage === 'mouseSync'">
          <b>aktive Remotesitzung - Verbindung wird hergestellt</b>
          <img style="float: left; margin-right: 50px" :src="LoadingDarkGif">
        </template>
        <b v-else>Hilfe für die Maussteuerung</b>
        <br>
        <br>
        <template v-if="!isTouchEnabled()">
          STRG + MAUSRAD für Zoom
          <br>
          mittlere MAUSTASTE oder gedrückte Leertaste zum Verschieben
          <br>
          STRG gedrückt halten um zu zeichnen
          <br>
          STRG + C/STRG + V zum Einfügen von Texten/Dateien/Bildern
        </template>
      </template>
      <template v-else-if="activeMessage === 'fileDrop'">
        <b>Datei per Drag-and-Drop an alle Teilnehmer verteilen... (max 10MB)</b>
        <br>
        <br>
        Die Datei wird direkt an die Teilnehmer gesendet.
        <br>
        Wenn Sie eine Datei dauerhaft speichern wollen, verwenden Sie den Datei-Bereich oben.
      </template>
      <template v-if="activeMessage === 'fileUpload'">
        <b>Datei wird hochgeladen...</b>
        <br>
        <br>
        Es kann etwas dauern, bis alle Teilnehmer die Datei erhalten haben.
        <img style="float: left; margin-right: 50px" :src="LoadingDarkGif">
      </template>
      <template v-if="activeMessage === 'remoteControl' && remoteControlMessage">
        <b>{{ remoteControlMessage }}</b>
      </template>
    </div>
    <Toolbar class="main-toolbar" collapsible>
      <div class="btn btn-sm btn-secondary" :class="{ disabled: !clipboardFile }" title="Show clipboard" style="width: 30px" @click="showClipboard = !showClipboard">
        <ClipboardTextOutlineSvg />
      </div>
      <div class="btn btn-sm btn-secondary" title="Help" style="width: 30px" @click="toggleMessage('mouseHelp')">
        <HelpSvg />
      </div>
      <div class="btn btn-sm btn-secondary" title="Leave" style="width: 30px" @click="$emit('stop')">
        <LogoutSvg />
      </div>
    </Toolbar>
    <div class="clipboard-container">
      <Clipboard v-if="showClipboard" :data="clipboardFile"/>
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

  .remote-viewer .cursor {
    transition: all 0.05s ease-out;
    pointer-events: none;
    float: left;
    width: 300px;
    position: absolute;
    z-index: 99;
  }

  .remote-viewer .cursor img {
    height: 25px;
    width: 25px;
  }

  .remote-viewer .cursor .cursor-name {
    float: left;
    width: auto;
    margin-left: 10px;
    margin-top: 10px;
    background: white;
    font-size: 12px;
    padding: 4px;
  }

  .remote-viewer .overlay {
    margin: 0px;
    padding: 0px;
    z-index:99;
    position: absolute;
  }

  .remote-viewer .overlay canvas {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 100;
    width: 100%;
    height: 100%;
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

  .remote-viewer .cursorsignal {
    border-radius: 50%;
    width: 50px;
    background-color: red;
    height: 50px;
    position: absolute;
    opacity: 0;
    animation: scaleIn 1s infinite cubic-bezier(.36, .11, .89, .32);
  }

  .remote-viewer .sharer-toolbar-bounds {
    position: absolute;
    z-index: 100;
    background: repeating-linear-gradient(-45deg, #222, #333 15px, #aa0 15px, #cc0 20px);
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
  .remote-viewer textarea {
    width: 100%;
    height: 100%;
    max-height: 120px;
    max-width: 170px;
    font-size: 10px;
    font-family: sans-serif;
    background: black;
    color: white;
    border: none;
    outline: none;
    resize: none;
    overflow: auto;
    -webkit-box-shadow: none;
    -moz-box-shadow: none;
    box-shadow: none;
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

  @keyframes scaleIn {
    from {
      transform: scale(.5, .5);
      opacity: .2;
    }

    to {
      transform: scale(2.5, 2.5);
      opacity: 0;
    }
  }
</style>