<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from "vue"
import Panzoom, { PanzoomOptions, PanzoomEventDetail } from '@panzoom/panzoom'

import SignalContainer from "./SignalContainer.vue"
import Clipboard from '../../components/Clipboard.vue'
import Toolbar from "../../components/Toolbar.vue"

import { useFileChunkRegistry, chunkFile } from "../../../composables/useFileChunking"
import { useDrawOverlay } from "../../../composables/useDrawOverlay"
import { uuidv4 } from "../../../util.js"

import LoadingDarkGif from '../../../assets/img/loading_dark.gif'
import ClipboardTextOutlineSvg from '../../../assets/icons/clipboard-text-outline.svg'
import HelpSvg from '../../../assets/icons/help.svg'
import LogoutSvg from '../../../assets/icons/logout.svg'

import type { RemoteData, RemoteEvent, RemoteMouseData, RemoteResetData, File } from '../../../interface.d.ts'
import type { ScaleInfo, Signal, VideoTransform } from "../../types.js"

type Pan = {
  x: number
  y: number
}

type MouseMessage = {
  x: number
  y: number
  room?: string
  id: string
  name?: string
  color: string
  delta?: number
}

type Cursor = {
  name?: string
  color: string
  left: string
  top: string
  lastAction: number
}

const props = withDefaults(defineProps<{
  room: string
  user: string
  id: string
  color: string
  hostname: string
  videoTransform?: VideoTransform
}>(), {
  videoTransform: () => ({ x: 0, y: 0, width: 0, height: 0, fullwidth: 0, fullheight: 0 })
})

const emit = defineEmits<{
  (e: 'stop'): void
  (e: 'rescale', scaleinfo: ScaleInfo): void
  <T extends RemoteEvent>(e: 'send', data: { event: T, data: RemoteData<T>, volatile: boolean }): void
}>()

// gedrückte Keys
let controlpressed = false
let altpressed = false
let shiftpressed = false
let spacepressed = false
let synchronized = false
let remoteClipboard = false
let skip = false

// Skalierungsinfos
const videoScale = ref(1)   // Skalierung im Browser im Verhältnis zur Videogröße
const remoteScale = ref(1)  // Skalierung Remotedesktop im Verhältnis zur Videogröße
const totalScale = computed(() => videoScale.value * remoteScale.value)
const windowdimensions = { width: 0, height: 0 }     // initial

// Panzoom - Scale und Panning im Browser
let zoom: PanzoomEventDetail | undefined = undefined      // lokales Zoomlevel zwischenspeichern
let lastPanScale = 1
let lastPan: Pan = { x: 0, y: 0 }

// Mauszeiger
let x = 0
let y = 0
let lastMove = 0

// Screensharing oder Windowsharing aktiv?
let isSharingScreen = true
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

// Websocket-Message Object
let currentMouseData: RemoteMouseData = {
  x: 0,
  y: 0,
  id: props.id,
  name: props.user,
  color: props.color,
  draw: false
}

// Drawing state
const canvasRef = useTemplateRef('canvas')
const drawOverlay = useDrawOverlay(canvasRef, {
  scale: totalScale,
  dimensions: computed(() => props.videoTransform ? [props.videoTransform!.fullwidth, props.videoTransform!.fullheight] : undefined)
})

const overlayStyle = ref<Record<string, string>>({
  border: '0',
  width: '0px',
  height: '0px',
  left: '0px',
  top: '0px',
  cursor: 'default',
})

const sharerToolbarBoundsStyle = ref<Record<string, string> | undefined>()
const sizeInfoStyle = ref<Record<string, string>>({})
const activeMessage = ref<string | undefined>()
const remoteControlMessage = ref<string>()
const draggingOver = ref(false)
const showClipboard = ref(true)
const clipboardFile = ref<File>()

const fileChunkRegistry = useFileChunkRegistry(file => clipboardFile.value = file)
watch(clipboardFile, () => showClipboard.value = true)

const remoteViewerRef = useTemplateRef('remoteViewer')
const overlayRef = useTemplateRef('overlay')

onMounted(() => {
  document.body.addEventListener('contextmenu', onContextMenu)
  document.body.addEventListener('keydown', preventBrowserZoom, false)
  document.body.addEventListener("wheel", onWheel, { passive: false })
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragover', onDragOver)

  // allow panning and zooming for overlay element
  const options: PanzoomOptions = { canvas: true, maxScale: 3, minScale: 1 }
  if (!isTouchEnabled())
    options.handleStartEvent = event => {
      if ((event as MouseEvent).button !== 1 && !spacepressed) {
        throw "use middle button for panning"
      } else {
        event.stopPropagation()
        event.preventDefault()
      }
    }

  const panzoom = Panzoom(overlayRef.value!, options)

  // Mousewheel-Zoom
  remoteViewerRef.value?.addEventListener('wheel', (event: WheelEvent) => {
    if (!event.ctrlKey) return
    panzoom.zoom(panzoom.getScale() + (event.deltaY < 0 ? 0.1 : -0.1), { animate: true })
  })

  // Änderungen zoom/panning in Variable zwischenspeichern
  overlayRef.value!.addEventListener('panzoomchange', (event: any) => {
    zoom = event.detail
    console.log(zoom) // => { x: 0, y: 0, scale: 1 }
  })

  // alle 50ms werden die aktuellen Zoom-Infos an den Videoviewer gesendet
  setInterval(() => {
    const pan = panzoom.getPan()
    const panScale = panzoom.getScale()

    emit('rescale', {
      x: pan.x,
      y: pan.y,
      scale: panScale,
      width: windowdimensions.width,
      height: windowdimensions.height
    })

    if (pan.x != lastPan.x || pan.y != lastPan.y || panScale != lastPanScale) {
      lastPanScale = panScale
      lastPan = pan

      let reset = false
      if ((pan.x > 0 || pan.y > 0) && panScale <= 1) {
        pan.x = 0
        pan.y = 0
        reset = true
      }

      // Adjust child starting X/Y according the new scale for panning
      if (reset) {
        panzoom.pan(pan.x, pan.y, {
          animate: true
        })
        reset = false
      }

      emit('rescale', {
        x: pan.x,
        y: pan.y,
        scale: panScale,
        width: windowdimensions.width,
        height: windowdimensions.height
      })
    }
  }, 50)

  watch(() => props.videoTransform, (transform) => {
    if (!transform)
      return

      sizeInfoStyle.value = {
        width: transform.fullwidth + "px",
        height: transform.fullheight + "px",
        left: (transform.x - 2) + "px",
        top: (transform.y - 2) + "px"
      }

      overlayStyle.value!.width = (transform.width) + "px"
      overlayStyle.value!.height = (transform.height) + "px"
      overlayStyle.value!.left = Math.round((transform.x - 2) - (transform.fullwidth / transform.width * lastPan.x) + ((transform.fullwidth - transform.width) / 2)) + "px"
      overlayStyle.value!.top = Math.round((transform.y - 2) - (transform.fullwidth / transform.width * lastPan.y) + ((transform.fullheight - transform.height) / 2)) + "px"
  })

  // virtueller Mauszeiger
  function mouseMove(data: MouseMessage) {
    // Mauszeiger erstellen (nur bei Windowsharing, beim Screensharing bleibt stattdessen der Remotemauszeiger sichtbar)
    if (!synchronized || isSharingScreen)
      return

    if (!overlayCursors[data.id]) {
      overlayCursors[data.id] = {
        name: data.name,
        color: data.color,
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

    overlayCursors[data.id].left = Math.round(data.x * totalScale.value) + "px"
    overlayCursors[data.id].top = Math.round(data.y * totalScale.value) + "px"
    overlayCursors[data.id].lastAction = Date.now()
  }

  function clearMouseCursors() {
    for (const id in overlayCursors) {
      if (overlayCursors[id].lastAction < (Date.now() - 10000))
        delete overlayCursors[id]
    }
  }

  // Signal einblenden bei Mausklick für 2000ms
  function mouseSignal(data: MouseMessage) {
    if (!remoteControlActive.value && !isSharingScreen) {
      signals[data.id] = {
        color: data.color,
        left: Math.round(data.x * totalScale.value - 150) + "px",
        top: Math.round(data.y * totalScale.value - 150) + "px"
      }

      setTimeout(() => {
        if (signals[data.id])
          delete signals[data.id]
      }, 2000)
    }
  }

  window.addEventListener('resize', calcScale)

  onReceive("getclipboard", (data) => {
    console.log("getclipboard", data)

    navigator.clipboard.writeText(data.text)
  })

  onReceive("mouse-leftclick", (data) => {
    if (!remoteControlActive.value && !data.draw)
      mouseSignal(data)
      
    drawOverlay.endStroke(data.id)
  })

  onReceive("mouse-move", (data) => {
    if (!remoteControlActive.value || data.draw)
      drawOverlay.continueStroke(data.id, data.color, [data.x, data.y])

    mouseMove(data)
  })

  onReceive("mouse-down", (data) => {
    if ((!remoteControlActive.value && !draggingOver.value) || data.draw)
      drawOverlay.startStroke(data.id, [data.x, data.y])
  })

  onReceive("mouse-up", (data) => {
    drawOverlay.endStroke(data.id)
  })

  onReceive("file", (data) => {
    console.log("file", data)
    fileChunkRegistry.register(data)
  })

  onReceive("file-chunk", (data) => {
    fileChunkRegistry.receiveChunk(data)
  })

  onReceive('reset', (data) => {
    // Bei Screensharing sieht man den Remotemauszeige, daher den eigenen durch ein feines Crosshair ersetzen
    isSharingScreen = data.isScreen
    overlayStyle.value.cursor = isSharingScreen ? 'url(img/minicrosshair.png) 5 5, auto' : 'default'

    const remoteScaleHeight = props.videoTransform.height / (data.dimensions.bottom - data.dimensions.top)
    const remoteScaleWidth = props.videoTransform.width / (data.dimensions.right - data.dimensions.left)
    remoteScale.value = remoteScaleHeight < remoteScaleWidth ? remoteScaleHeight : remoteScaleWidth

    // Speichern der Fensterabmessungen
    windowdimensions.width = data.dimensions.right - data.dimensions.left
    windowdimensions.height = data.dimensions.bottom - data.dimensions.top

    // Skalierungsinfos und Mauszeigerposition mit Remote-App synchronisiert
    synchronized = !!lastResetData && lastResetData.dimensions.left == data.dimensions.left && lastResetData.dimensions.right == data.dimensions.right && lastResetData.dimensions.top == data.dimensions.top && lastResetData.dimensions.bottom == data.dimensions.bottom
    calcScale()

    sharerToolbarBoundsStyle.value = (isSharingScreen && data.toolbarBounds) ? {
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

  let lastPosX = 0
  let lastPosY = 0

  overlayRef.value!.addEventListener('mouseleave', handleMouseUp)
  window.addEventListener('blur', handleMouseUp)

  function handleMouseUp() {
    if (lastMouseDown > 0) {
      send("mouse-up", currentMouseData, { receiveSelf: true, volatile: true })
      clearTimeout(eventToSend)
      eventToSend = undefined
      lastMouseDown = 0
    }
  }

  overlayRef.value!.addEventListener('mouseenter', () => { 
    remoteClipboard = true 
  })

  overlayRef.value!.addEventListener('mousemove', (e) => {
    if (!mouseEnabled.value || !synchronized) return false
    remoteClipboard = true

    const rect = overlayRef.value!.getBoundingClientRect()
    x = e.pageX - rect.left
    y = e.pageY - rect.top

    currentMouseData = {
      x: Math.round(x / (totalScale.value * (zoom?.scale ?? 1))),
      y: Math.round(y / (totalScale.value * (zoom?.scale ?? 1))),
      id: props.id,
      name: props.user,
      color: props.color,
      draw: controlpressed,
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
  })

  let lastWheel = 0
  overlayRef.value!.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return

    if (lastWheel < (Date.now() - 200)) {
      console.log(e)
      currentMouseData.delta = e.deltaY
      lastWheel = Date.now()
      send("mouse-wheel", currentMouseData, { receiveSelf: true })
    }
  })

  //let ignoremouse = 0
  let lastMouseData: RemoteMouseData

  overlayRef.value!.addEventListener('mousedown', (e) => {
    if (!mouseEnabled.value) return
    //if ((ignoremouse < Date.now() - 100)) {
      if (e.which == 3) {
        sendMouseClick()
      } else {
        sendMouseDown(e)
      }
    /*} else {
      ignoremouse = Date.now()
    }*/
    lastMouseData = currentMouseData
  })

  overlayRef.value!.addEventListener('mouseup', () => {
    if (!mouseEnabled.value) return
    sendMouseUp()
  })

  let eventToSend: number | undefined
  let lastMouseDown = 0
  //const lastclick = 0
  //const mousepressed = {}
  let moveHandler: ((event: MouseEvent) => void) | undefined

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
        send("mouse-down", { ...lastMouseData, draw: controlpressed }, { receiveSelf: true, volatile: true })
        
        // Remove this handler since we've triggered the event
        moveHandler && document.removeEventListener('mousemove', moveHandler)
        moveHandler = undefined
      }
    }
    
    document.addEventListener('mousemove', moveHandler)
    
    eventToSend = window.setTimeout(() => {
      mousedown = true
      console.log("mouse-down")
      send("mouse-down", { ...lastMouseData, draw: controlpressed }, { receiveSelf: true, volatile: true })
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
      send("mouse-up", { ...currentMouseData, draw: controlpressed }, { receiveSelf: true, volatile: true })
    } else {
      console.log("mouse-leftclick")
      send("mouse-leftclick", { ...lastMouseData, draw: controlpressed }, { receiveSelf: true, volatile: true })
    }

    mousedown = false
    lastMouseDown = 0
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  overlayRef.value!.addEventListener('contextmenu', () => {
    return false
  })

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

function onKeyUp(e: KeyboardEvent) {
  if (e.key == 'Control' || e.key == 'Meta') {
    setTimeout(() => {
      controlpressed = false
    }, 100)
  }
  if (e.key == 'Shift') {
    shiftpressed = false
  }
  if (e.key == " " || e.code == "Space" || e.keyCode == 32) {
    setTimeout(() => {
      spacepressed = false
    }, 100)
  }
  if (e.key == 'Alt' || e.key == 'AltGraph') {
    setTimeout(() => {
      altpressed = false
    }, 100)
  }

  e.preventDefault()
  return false
}

function onKeyDown(e: KeyboardEvent) {
  console.log(e.keyCode)

  skip = false
  let keyToSend = e.key
  if (e.key == " " || e.code == "Space" || e.keyCode == 32) {
    spacepressed = true
  }
  if (e.key == 'Shift') {
    shiftpressed = true
  }
  if (e.key == 'Control' || e.key == 'Meta') {
    controlpressed = true
  }
  if (e.key == 'Alt' || e.key == 'AltGraph') {
    altpressed = true
  }
  if (e.key == 'Alt' || e.key == 'AltGraph' || e.key == 'Shift' || e.key == 'CapsLock') {
    skip = true
  }
  if (controlpressed && (e.key == 'Control' || e.key == 'Meta' || e.key == 'v' || e.key == 'c' || e.key == 'x')) {
    skip = true
  }
  if (controlpressed && e.key != 'v' && e.key != 'c' && e.key != 'x' && (e.key.length === 1 && e.key.toLowerCase().match(/[a-z]/i) || e.key == 'Enter')) {
    keyToSend = '_____strg+' + e.key.toLowerCase()
  }

  // Special keys ~,+,^,`,´ and how to detect them
  if (altpressed && e.keyCode == 78) {
    skip = false
    keyToSend = '~'
  }
  if (e.keyCode === 187) {  // Both ´ and + share keyCode 187
    if (e.code === 'Equal') {  // Physical key is always 'Equal'
      if (e.key === 'Dead') {
        // This is ´ (acute accent)
        skip = false
        if (shiftpressed) {
          keyToSend = '`'
        } else {
          keyToSend = '´'
        }
      } else if (e.key === '+') {
        // This is the + key
        skip = false
        keyToSend = '+'
      }
    }
  }
  if (e.keyCode == 192) {
    skip = false
    if (shiftpressed) {
      keyToSend = '°'
    }
    else {
      keyToSend = '^'
    }
  }
  
  if (!skip) {
    console.log(keyToSend)

    send('type', { key: keyToSend }, { receiveSelf: true })
    e.preventDefault()
  }
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
  if (remoteClipboard)
    send('copy', {
      room: props.room,
    }, { receiveSelf: true })
}

function onCut() {
  if (remoteClipboard)
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

    console.log(item)

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

function calcScale() {
  overlayStyle.value.border = '1px solid blue'
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

function isTouchEnabled() {
  if (window.matchMedia("(pointer: coarse)").matches) {
    return true
  }

  return false
  /*return ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints > 0)*/
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
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

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

const receiveEvents: Partial<ReceiveEventHandlers> = {}

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
  <div class="remote-viewer" ref="remoteViewer">
    <div class="overlay" ref="overlay" :style="overlayStyle">
      <div v-for="(cursor, cursorId) in overlayCursors" :key="cursorId" class="cursor">
        <div v-if="cursorId !== id && cursor.name" class="cursor-name" :style="{ border: `1px solid #${cursor.color}`, color: `#${cursor.color}` }"> {{ cursor.name }}</div>
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