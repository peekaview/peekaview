<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"
import { io, type Socket } from "socket.io-client"
import Panzoom, { PanzoomOptions, PanzoomEventDetail } from '@panzoom/panzoom'

import type { RemoteData, RemoteEvent, RemotePasteFileData, RemoteResetData } from '../../../interface.d.ts'
import { b64DecodeUnicode, hexToRgb } from "../../util.js";
import { ScaleInfo, VideoTransform } from "../../types.js";

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

type Stroke = {
  from: [number, number]
  to: [number, number]
  color: string
  timestamp: number
  opacity: number
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
  (e: 'rescale', scaleinfo: ScaleInfo): void
  <T extends RemoteEvent>(e: 'send', data: { event: T, data: RemoteData<T>, volatile: boolean }): void
}>()

document.addEventListener('contextmenu', event => {
  event.preventDefault()
})

let socket: Socket

// gedrückte Keys
let controlpressed = false
let altpressed = false
let shiftpressed = false
let spacepressed = false
let synchronized = false
let remoteClipboard = false
let skip = false

// Skalierungsinfos
let scale = 1      // Skalierung im Browser im Verhältnis zur Videogröße
let remotescale = 1  // Skalierung Remotedesktop im Verhältnis zur Videogröße
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
let screensharing = true
let lastmessage: RemoteResetData | undefined

// Maus-Overlays
const signals: Record<string, HTMLDivElement> = {}
const overlayCursor: Record<string, HTMLElement | undefined> = {}
const overlayCursorLastAction: Record<string, number> = {}
let cursorcheckinterval: number

// Remote-Funktionen
let mouseenabled = true
let remotecontrol = false
let mousedown = false
let dragdetected = false

// Websocket-Message Object
let obj: MouseMessage = {
  x: 0,
  y: 0,
  room: props.room,
  id: props.id,
  name: props.user,
  color: props.color
}

// fileTransfer aktiv?
let fileTransfer = false

// Messages
const mouseSyncEl = document.createElement('div')
mouseSyncEl.id = 'mousesync'
mouseSyncEl.classList.add('message')
mouseSyncEl.style.cssText = 'opacity: 0.8 z-index: 1001 pointer-events: none'
mouseSyncEl.innerHTML = '<b>aktive Remotesitzung - Verbindung wird hergestellt</b><img style="float: left margin-right: 50px" src="../img/loading_dark.gif"><br><br>' + (!isTouchEnabled() ? 'STRG + MAUSRAD für Zoom<br>mittlere MAUSTASTE oder gedrückte Leertaste zum Verschieben<br>STRG gedrückt halten um zu zeichnen<br>STRG + C/STRG + V zum Einfügen von Texten/Dateien/Bildern' : '')

const msgmousehelp = document.createElement('div')
msgmousehelp.id = 'mousehelp'
msgmousehelp.classList.add('message')
msgmousehelp.style.cssText = 'opacity: 0.8 z-index: 1001 pointer-events: none'
msgmousehelp.innerHTML = '<b>Hilfe für die Maussteuerung</b><br><br>' + (!isTouchEnabled() ? 'STRG + MAUSRAD für Zoom<br>mittlere MAUSTASTE oder gedrückte Leertaste zum Verschieben<br>STRG gedrückt halten um zu zeichnen<br>STRG + C/STRG + V zum Einfügen von Texten/Dateien/Bildern' : '')

const msgfiledrop = document.createElement('div')
msgfiledrop.id = 'filedrop'
msgfiledrop.classList.add('message')
msgfiledrop.style.cssText = 'padding-left: 100px position: absolute z-index: 1002 color: white background: #000 opacity: 0.8 padding:20px min-width: 500px width: 100vw pointer-events: none'
msgfiledrop.innerHTML = '<b>Datei per Drag-and-Drop an alle Teilnehmer verteilen... (max 10MB)</b><br><br>Die Datei wird direkt an die Teilnehmer gesendet.<br>Wenn Sie eine Datei dauerhaft speichern wollen, verwenden Sie den Datei-Bereich oben.'

const msgfileupload = document.createElement('div')
msgfileupload.id = 'transfer'
msgfileupload.classList.add('message')
msgfileupload.style.cssText = 'padding-left: 100px position: absolute z-index: 1003 color: white background: #000 opacity: 0.8 padding:20px min-width: 500px width: 100vw pointer-events: none'
msgfileupload.innerHTML = '<b>Datei wird hochgeladen...</b><br><br>Es kann etwas dauern, bis alle Teilnehmer die Datei erhalten haben.<img style="float: left margin-right: 50px" src="../img/loading_dark.gif">'

const msgremotecontrol = document.createElement('div')
msgremotecontrol.id = 'remotecontrol'
msgremotecontrol.classList.add('message')
msgremotecontrol.style.cssText = 'padding-left: 100px position: absolute z-index: 1004 color: white background: #000 opacity: 0.8 padding:20px min-width: 500px width: 100vw pointer-events: none'
msgremotecontrol.innerHTML = '<b>Maus/Tastatursteuerung wurde aktiviert</b>'

// Drawing state
const drawing: Record<string, boolean> = {}       // Benutzer malt gerade? 
const drawCanvas: Record<string, HTMLCanvasElement> = {}    // Canvas der Benutzer
const pointHistory: Record<string, Stroke[]> = {}    // Punktarrays der Benutzer
const latestPoint: Record<string, [number, number] | undefined> = {}     // jeweils letzter Punkt
let paintcheckinterval: number  // Repaint-Intervall

// Add this near other state declarations (around line 40-50)
const tmpPointHistory: Record<string, Stroke[]> = {}

// Disable Browser-Zoom
//(() => {
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
    e.preventDefault()
  }
}, false)

const handleWheel = (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey)
    e.preventDefault()
}
document.addEventListener("wheel", handleWheel, { passive: false })
//})()

const overlayStyle = ref<Record<string, string>>({
  border: '0',
  width: '0px',
  height: '0px',
  left: '0px',
  top: '0px',
})

const remoteViewerRef = useTemplateRef('remoteViewer')
const overlayRef = useTemplateRef('overlay')
const containerRef = useTemplateRef('container')

onMounted(() => {
  // get the color for a user
  //fetch("https://" + document.location.hostname.replace('ps-', '') + "/api/clientapi.php?action=color&user=" + user).then(response => response.text()).then(response => { color = response })

  socket = io('wss://' + props.hostname, {
    transports: ['websocket', 'polling'],
    withCredentials: true
  })

  onBeforeUnmount(() => {
    socket.disconnect()
    socket.close()
  })

  const sizeInfoEl = document.createElement('div')
  sizeInfoEl.id = 'sizeinfo'
  sizeInfoEl.style.cssText = ''

  console.log("connect to controlserver:", props.hostname)
  socket.emit("join", { roomId: props.room, isPresenter: false })

  document.body.appendChild(mouseSyncEl)  // display syncmessage
  document.body.appendChild(sizeInfoEl)    // show rectangular with sizeinfo

  // allow panning and zooming for #overlay element
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
    if (event.deltaY < 0) {
      panzoom.zoom(panzoom.getScale() + 0.1, { animate: true })
    } else {
      panzoom.zoom(panzoom.getScale() - 0.1, { animate: true })
    }
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

      const sizeInfoEl = document.querySelector("#sizeinfo") as HTMLDivElement
      sizeInfoEl.style.width = transform.fullwidth + "px"
      sizeInfoEl.style.height = transform.fullheight + "px"
      sizeInfoEl.style.left = (transform.x - 2) + "px"
      sizeInfoEl.style.top = (transform.y - 2) + "px"

      // Canvas anpassen
      Object.keys(drawCanvas).forEach(key => {
        drawCanvas[key].style.width = transform.fullwidth + "px"
        drawCanvas[key].style.height = transform.fullheight + "px"
        const drawCanvascontext = drawCanvas[key].getContext("2d")!
        if (transform.fullwidth != drawCanvascontext.canvas.width) {
          drawCanvascontext.canvas.width = transform.fullwidth
          drawCanvascontext.canvas.height = transform.fullheight
        }
      })

      overlayStyle.value!.width = (transform.width) + "px"
      overlayStyle.value!.height = (transform.height) + "px"
      overlayStyle.value!.left = Math.round((transform.x - 2) - (transform.fullwidth / transform.width * lastPan.x) + ((transform.fullwidth - transform.width) / 2)) + "px"
      overlayStyle.value!.top = Math.round((transform.y - 2) - (transform.fullwidth / transform.width * lastPan.y) + ((transform.fullheight - transform.height) / 2)) + "px"
  })

  // virtueller Mauszeiger
  function mouseMove(data: MouseMessage) {
    // Mauszeiger erstellen (nur bei Windowsharing, beim Screensharing bleibt stattdessen der Remotemauszeiger sichtbar)
    if (!synchronized || screensharing)
      return

    if (overlayCursor[data.id] == undefined) {
      const cursor = document.createElement('div')
      cursor.classList.add('cursor')
      if (props.id != data.id)
        cursor.innerHTML = '<img src="img/cursor.png" />'
      else
        cursor.innerHTML = '<div class="cursor-name" style="border: 1px solid #' + data.color + ';color: #' + data.color + ';">' + data.name + '</div>'
      overlayCursor[data.id] = cursor
      overlayRef.value!.appendChild(overlayCursor[data.id]!)

      // Mauszeiger nach 10 Sekunden Inaktivität ausblenden
      if (cursorcheckinterval === undefined) {
        cursorcheckinterval = window.setInterval(() => {
          clearMouseCursors()
        }, 1000)
      }
    }

    // Positionierung
    overlayCursorLastAction[data.id] = Date.now()
    overlayCursor[data.id]!.style.left = Math.round(data.x * (scale * remotescale)) + "px"
    overlayCursor[data.id]!.style.top = Math.round(data.y * (scale * remotescale)) + "px"
  }

  function clearMouseCursors() {
    // this.overlayCursorLastAction[id]
    Object.entries(overlayCursor).forEach(([key, value]) => {
      if (overlayCursorLastAction[key] != undefined && overlayCursorLastAction[key] < (Date.now() - 10000)) {
        console.log("remove cursor " + key)
        if (value != null) {
          value.remove()
          delete overlayCursor[key]
          delete overlayCursorLastAction[key]
        }
      }
    })
  }

  // virtuelles Clipboard, Filesharing via Websockets
  // Todo, in eigene JS auslagern, da mehr oder weniger baugleich mit Filesharing in meetzi-App
  function pasteFile(data: RemotePasteFileData) {
    const clipboardContainerEl = document.querySelector('#clipboardcontainer')
    if (clipboardContainerEl !== null)
      clipboardContainerEl.remove()

    const clipboarddiv = document.createElement('div')
    clipboarddiv.style.cssText = 'position: absolute right:0px bottom:0px'
    clipboarddiv.id = 'clipboardcontainer'
    clipboarddiv.innerHTML = '<div class="button" onClick="document.querySelector(\'#clipboardcontainer\').remove()" style="margin-bottom: 5px">Clipboard schliessen</div><div class="button copybutton" id="copybutton">Kopieren</div><div class="button downloadbutton" id="downloadbutton">Download</div><div id="clipboardarea"></div>'
    document.body.append(clipboarddiv)

    const clipboardAreaEl = document.getElementById('clipboardarea') as HTMLDivElement
    const extensionImageEl = document.querySelector("#extensionimage") as HTMLImageElement
    const downloadButtonEl = document.querySelector("#downloadbutton") as HTMLButtonElement
    const copyButtonEl = document.querySelector("#copybutton") as HTMLButtonElement
    
    const datestring = (new Date().toLocaleString().replaceAll('/', '-').replaceAll(', ', '_').replaceAll(':', '-'))

    document.querySelectorAll('#transfer').forEach((message) => { message.remove() })
    if (data.filecontent.startsWith('data:application/octet-stream')) {
      try {
        b64DecodeUnicode(data.filecontent.replace('data:application/octet-streambase64,', ''))
      } catch (e) {
        data.filecontent = data.filecontent.replace('data:application/octet-stream', 'data:application/bin')
      }
    }

    if (data.filecontent.startsWith('data:image/')) {
      let filetype = data.filecontent.split('data:')[1].split('base64,')[0]
      let extension = filetype.split('/')[1]

      // Wenns ein Bild ist, aber mime-Extension Sonderzeichen enthält, dann ists irgendein komisches Format und wir nehmen png als Default
      if (extension.includes('.') || extension.includes('-')) {
        extension = 'png'
      }
      // Wenn per Drag&Drop kommt, ist der Filename bekannt, dann darauf die Extension bestimmen
      if (data.filename !== undefined) {
        extension = data.filename.split('.').pop() ?? extension
      }

      const div = document.createElement('div')
      div.innerHTML = '<center><img id="extensionimage" src="' + data.filecontent + '" style="max-height:150px max-width:150px opacity: 0.8"></center>'
      clipboardAreaEl.append(div)

      // Klick aufs Bild = Download
      extensionImageEl.onclick = () => downloadButtonEl.click()

      downloadButtonEl.onclick = () => {
        const downloadLink = document.createElement('a')
        document.body.appendChild(downloadLink)
        downloadLink.href = data.filecontent
        downloadLink.target = '_self'
        downloadLink.download = data.filename ?? 'download_' + datestring + '.' + extension
        downloadLink.click()
      }

      copyButtonEl.style.display = 'inline'
      copyButtonEl.onclick = () => {
        const canvas = document.createElement('canvas')
        canvas.width = extensionImageEl.naturalWidth
        canvas.height = extensionImageEl.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(extensionImageEl, 0, 0)
        canvas.toBlob(async (blob) => {
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob!.type]: blob!
            })
          ])
          console.log('Copied')
        })
      }


      clipboardAreaEl.append(div)
    }
    else if (data.filecontent.startsWith('data:application/octet-stream') || data.filecontent.startsWith('data:text/') || data.filecontent.startsWith('data:application/json')) {
      let filetype = data.filecontent.split('data:')[1].split('base64,')[0]
      //let b64data = data.filecontent.split('base64,')[1]
      let extension = filetype.split('/')[1]

      const div = document.createElement('div')
      let decoded = ''
      if (data.filecontent.startsWith('data:application/octet-stream')) {
        decoded = b64DecodeUnicode(data.filecontent.replace('data:application/octet-streambase64,', ''))
      } else {
        decoded = atob(data.filecontent.split('base64,')[1])
      }
      if (decoded.includes('<?php')) {
        extension = 'php'
      }
      if (extension.includes('.') || extension.includes('-')) {
        extension = 'txt'
      }

      if (data.filename != undefined) {
        extension = data.filename.split('.').pop() ?? extension
      }

      div.style.cssText = 'background-image: url(icons/' + extension + '.svg) background-repeat: no-repeat background-position-x: right'

      const textareaEl = document.createElement('textarea')
      textareaEl.id = 'filecontent'
      textareaEl.value = decoded

      div.append(textareaEl)

      clipboardAreaEl.append(div)

      downloadButtonEl.onclick = () => {
        const downloadLink = document.createElement('a')
        document.body.appendChild(downloadLink)
        downloadLink.href = data.filecontent
        downloadLink.target = '_self'
        if (data.filename != undefined) {
          downloadLink.download = data.filename
        } else {
          downloadLink.download = 'download_' + datestring + '.' + extension
        }
        downloadLink.click()
      }

      copyButtonEl.style.display = 'inline'
      copyButtonEl.onclick = () => {
        //document.querySelector("textarea").select()
        navigator.clipboard.writeText(textareaEl.value)

        //document.execCommand('copy')
      }

    }
    else if (data.filecontent.startsWith('data:application/')) {
      let filetype = data.filecontent.split('data:')[1].split('base64,')[0]
      let extension = filetype.split('/')[1]

      extension = extension.replace('x-msdownload', 'exe')
      extension = extension.replace('x-zip-compressed', 'zip')

      if (extension.includes('.') || extension.includes('-')) {
        extension = 'bin'
      }

      if (data.filename != undefined) {
        extension = data.filename.split('.').pop() ?? extension
      }

      const div = document.createElement('div')
      div.innerHTML = '<center><img id="extensionimage" src="icons/' + extension + '.svg" style="max-height:150px"></center>'
      clipboardAreaEl.append(div)

      extensionImageEl.onclick = () => downloadButtonEl.click()

      downloadButtonEl.onclick = () => {
        const downloadLink = document.createElement('a')
        document.body.appendChild(downloadLink)
        downloadLink.href = data.filecontent
        downloadLink.target = '_self'
        if (data.filename != undefined) {
          downloadLink.download = data.filename
        } else {
          downloadLink.download = 'download_' + datestring + '.' + extension
        }
        downloadLink.click()
      }
    }
  }

  function startStroke(id: string, point: [number, number]) {
    // Initialize point history if needed
    if (pointHistory[id] == undefined) {
      pointHistory[id] = []
    }
    
    drawing[id] = true
    latestPoint[id] = point

    if (paintcheckinterval === undefined) {
      paintcheckinterval = window.setInterval(() => {
        Object.keys(pointHistory).forEach(key => {
          tmpPointHistory[key] = []
          pointHistory[key].forEach((item) => {
            if (item.timestamp >= (Date.now() - 8000)) {
              tmpPointHistory[key].push(item)
            }
            if (item.timestamp < (Date.now() - 8000) && item.timestamp > (Date.now() - 20000)) {
              item.opacity = item.opacity - 0.03
              tmpPointHistory[key].push(item)
            }
          })
          pointHistory[key] = tmpPointHistory[key]
        })
        repaintStrokes()
      }, 50)
    }
  }

  function continueStroke(id: string, color: string, newPoint: [number, number]) {
    if (!drawing[id] || !latestPoint[id]) {
      return
    }

    if (pointHistory[id] == undefined) {
      pointHistory[id] = []
    }

    // Only add point if it's different from the last point
    if (latestPoint[id][0] !== newPoint[0] || latestPoint[id][1] !== newPoint[1]) {
      pointHistory[id].push({
        color,
        from: latestPoint[id],
        to: newPoint,
        timestamp: Date.now(),
        opacity: 1.0
      })
      latestPoint[id] = newPoint
      repaintStrokes()
    }
  }

  function repaintStrokes() {
    Object.keys(pointHistory).forEach(key => {
      //console.log("stroke for "+key)
      // add a canvas for the user strokes
      if (drawCanvas[key] == undefined) {
        //console.log("canvas for "+key)
        drawCanvas[key] = document.createElement('canvas')
        drawCanvas[key].id = 'canvas_' + key
        drawCanvas[key].style.cssText = 'position: absolute'
        overlayRef.value!.appendChild(drawCanvas[key])
      }

      const drawCanvascontext = drawCanvas[key].getContext("2d")!
      drawCanvascontext.clearRect(0, 0, drawCanvas[key].width, drawCanvas[key].height)
      pointHistory[key].forEach((item) => {
        //console.log(item)
        if (item.from != undefined) {
          drawCanvascontext.beginPath()
          drawCanvascontext.moveTo(Math.round(item.from[0] * (scale * remotescale)), Math.round(item.from[1] * (scale * remotescale)))
          drawCanvascontext.strokeStyle = "rgba(" + hexToRgb(item.color)!.r + ", " + hexToRgb(item.color)!.g + ", " + hexToRgb(item.color)!.b + ", " + item.opacity + ")"
          drawCanvascontext.lineWidth = 5
          drawCanvascontext.lineCap = "round"
          drawCanvascontext.lineJoin = "round"
          drawCanvascontext.lineTo(Math.round(item.to[0] * (scale * remotescale)), Math.round(item.to[1] * (scale * remotescale)))
          drawCanvascontext.stroke()
        }
      })
    })
  }

  // Signal einblenden bei Mausklick für 2000ms
  function mouseSignal(obj: MouseMessage) {
    if (!remotecontrol && !screensharing) {
      if (signals[obj.id] != undefined) {
        signals[obj.id].remove()
      }

      signals[obj.id] = containerRef.value!.cloneNode(true) as HTMLDivElement
      signals[obj.id].id = 'signal_' + obj.id
      overlayRef.value!.appendChild(signals[obj.id])

      signals[obj.id].style.left = Math.round(obj.x * (scale * remotescale) - 150) + "px"
      signals[obj.id].style.top = Math.round(obj.y * (scale * remotescale) - 150) + "px"

      signals[obj.id].style.display = "flex"
      signals[obj.id].style.pointerEvents = "none"

      try {
        document.querySelectorAll('#signal_' + obj.id + ' .cursorsignal').forEach((item) => {
          (item as HTMLDivElement).style.backgroundColor = '#' + obj.color
        })
      } catch (e) { }

      setTimeout(() => {
        if (signals[obj.id] != undefined) {
          signals[obj.id].remove()
        }
      }, 2000)
    }
  }

  window.onresize = () => calcScale()

  function calcScale() {
    overlayStyle.value.border = '1px solid blue'
    const scale1 = overlayRef.value!.getBoundingClientRect().width / props.videoTransform.width
    const scale2 = overlayRef.value!.getBoundingClientRect().height / props.videoTransform.height

    scale = scale1 < scale2 ? scale1 : scale2
    if (scale > 1) {
      scale = 1
    }
  }

  onReceive("getclipboard", (data) => {
    console.log("getclipboard", data)

    navigator.clipboard.writeText(data.text)
  })

  onReceive("mouse-leftclick", (data) => {
    if (!remotecontrol) {
      mouseSignal(data)
    }
    drawing[data.id] = false;
  })

  onReceive("paint-mouse-leftclick", (data) => {
    /*if (drawing[data.id] != undefined && drawing[data.id]) {
      continueStroke(data.id, data.color, [data.x, data.y])
    }*/
    drawing[data.id] = false;
  })

  onReceive("mouse-move", (data) => {
    if (!remotecontrol && drawing[data.id] != undefined && drawing[data.id]) {
      continueStroke(data.id, data.color, [data.x, data.y])
    }

    mouseMove(data)
  })

  onReceive("paint-mouse-move", (data) => {
    if (drawing[data.id]) {
      continueStroke(data.id, data.color, [data.x, data.y])
    }
    mouseMove(data)
  })

  /*onReceive("rectangle", (data) => {
    //createRectangle(data)
  })*/

  onReceive("mouse-down", (data) => {
    console.log("mouse-down", data)

    if (!fileTransfer && (drawing[data.id] == undefined || !drawing[data.id])) {
      startStroke(data.id, [data.x, data.y])
    }
    //createRectangle(data)
  })

  onReceive("paint-mouse-down", (data) => {
    if (drawing[data.id] == undefined || !drawing[data.id]) {
      startStroke(data.id, [data.x, data.y])
    }
  })

  onReceive("mouse-up", (data) => {
    //mousepressed[data.id] = false
    console.log("mouse-up", data)

    drawing[data.id] = false
    //finishRectangle(data)
  })

  onReceive("paint-mouse-up", (data) => {
    drawing[data.id] = false
    latestPoint[data.id] = undefined
  })

  onReceive("pastefile", (data) => {
    console.log("pastefile", data)
    pasteFile(data)
  })

  onReceive('reset', (data) => {
    // Bei Screensharing sieht man den Remotemauszeige, daher den eigenen durch ein feines Crosshair ersetzen
    if (data.iscreen) {
      overlayStyle.value.cursor = 'url(img/minicrosshair.png) 5 5, auto'
      screensharing = true
    } else {
      overlayStyle.value.cursor = 'default'
      screensharing = false
    }

    /*if (((message.dimensions.right - message.dimensions.left) - 0) * message.scalefactor > props.videoTransform.width) {
      remotescale = (props.videoTransform.width / ((message.dimensions.right - message.dimensions.left) - 0))
    } else {*/
    //remotescale = message.scalefactor
    const remotescaleheight = (props.videoTransform.height / ((data.dimensions.bottom - data.dimensions.top) - 0))
    const remotescalewidth = (props.videoTransform.width / ((data.dimensions.right - data.dimensions.left) - 0))
    if (remotescaleheight < remotescalewidth) {
      remotescale = remotescaleheight
    } else {
      remotescale = remotescalewidth
    }
    //}

    // Speichern der Fensterabmessungen
    windowdimensions.width = data.dimensions.right - data.dimensions.left
    windowdimensions.height = data.dimensions.bottom - data.dimensions.top

    // Skalierungsinfos und Mauszeigerposition mit Remote-App synchronisiert
    if (!lastmessage || lastmessage.dimensions.left != data.dimensions.left || lastmessage.dimensions.right != data.dimensions.right || lastmessage.dimensions.top != data.dimensions.top || lastmessage.dimensions.bottom != data.dimensions.bottom) {
      synchronized = false
      calcScale()
    } else {
      synchronized = true
    }

    if (synchronized && mouseSyncEl !== undefined) {
      mouseSyncEl.remove()
    }

    // Maus-Zeigermodus aktiviert/deaktiviert
    if ((!lastmessage || mouseenabled != data.mouseenabled) && mouseSyncEl == null) {
      msgremotecontrol.innerHTML = data.mouseenabled ? '<b>Remote-Mauszeiger ist nun aktiviert</b>' : '<b>Remote-Mauszeiger wurde deaktiviert</b>'
      const messageEls = document.querySelectorAll('.message')
      messageEls.forEach((message) => { message.remove() })
      document.body.appendChild(msgremotecontrol)
      setTimeout(() => {
        messageEls.forEach((message) => { message.remove() })
      }, 3000)
      mouseenabled = data.mouseenabled
      if (!mouseenabled) {
        clearMouseCursors()
      }
    }

    // Maus/Tastatursteuerung aktiviert/deaktiviert
    if ((!lastmessage || remotecontrol != data.remotecontrol) && mouseSyncEl == null) {
      msgremotecontrol.innerHTML = data.remotecontrol ? '<b>Fernzugriff ist jetzt aktiviert</b>' : '<b>Fernzugriff wurde deaktiviert</b>'
      document.querySelectorAll('.message').forEach((message) => { message.remove() })
      document.body.appendChild(msgremotecontrol)
      setTimeout(() => {
        document.querySelectorAll('.message').forEach((message) => { message.remove() })
      }, 3000)
      remotecontrol = data.remotecontrol
    }
    lastmessage = data
  })

  let lastPosX = 0
  let lastPosY = 0

  overlayRef.value!.addEventListener('mouseleave', handleMouseUp)
  window.addEventListener('blur', handleMouseUp)

  function handleMouseUp() {
    if (lastMouseDown > 0) {
      send("mouse-up", obj, true)
      clearTimeout(eventToSend)
      eventToSend = undefined
      lastMouseDown = 0
    }
  }

  overlayRef.value!.addEventListener('mouseenter', () => { 
    remoteClipboard = true 
  })

  overlayRef.value!.addEventListener('mousemove', (e) => {
    if (!mouseenabled) return false
    if (!synchronized) return false
    remoteClipboard = true

    const rect = overlayRef.value!.getBoundingClientRect()
    x = e.pageX - rect.left
    y = e.pageY - rect.top

    obj = {
      x: Math.round(x / (scale * remotescale * zoom!.scale)),
      y: Math.round(y / (scale * remotescale * zoom!.scale)),
      room: props.room,
      id: props.id,
      name: props.user,
      color: props.color
    }

    if ((lastMouseDown > 0 && lastMove < Date.now() - 10) || 
      (lastMove < Date.now() - 100) || 
      (lastMove < Date.now() - 50 && (Math.abs(lastPosX - x) < 3 || Math.abs(lastPosY - y) < 3))) {
      lastMove = Date.now()
      send(controlpressed ? "paint-mouse-move" : "mouse-move", obj, true)
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
      obj.delta = e.deltaY
      lastWheel = Date.now()
      send("mouse-wheel", obj)
    }
  })

  //let ignoremouse = 0
  let lastObj: MouseMessage

  overlayRef.value!.addEventListener('mousedown', (e) => {
    if (!mouseenabled) return
    //if ((ignoremouse < Date.now() - 100)) {
      if (e.which == 3) {
        sendMouseClick()
      } else {
        sendMouseDown(e)
      }
    /*} else {
      ignoremouse = Date.now()
    }*/
    lastObj = obj
  })

  overlayRef.value!.addEventListener('mouseup', () => {
    if (!mouseenabled) return
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
    send("mouse-click", obj, true)
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
        send(controlpressed ? "paint-mouse-down" : "mouse-down", lastObj, true)
        
        // Remove this handler since we've triggered the event
        moveHandler && document.removeEventListener('mousemove', moveHandler)
        moveHandler = undefined
      }
    }
    
    document.addEventListener('mousemove', moveHandler)
    
    eventToSend = window.setTimeout(() => {
      mousedown = true
      console.log("mouse-down")
      send(controlpressed ? "paint-mouse-down" : "mouse-down", lastObj, true)
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
      send(controlpressed ? "paint-mouse-up" : "mouse-up", obj, true)
    } else {
      console.log("mouse-leftclick")
      send(controlpressed ? "paint-mouse-leftclick" : "mouse-leftclick", lastObj, true)
    }

    mousedown = false
    lastMouseDown = 0
  }

  window.addEventListener('keydown', (e) => {
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

      send('type', {
        socketid: socket.id!,
        key: keyToSend,
        room: props.room,
        name: props.user,
        color: props.color
      })
      e.preventDefault()
    }
  })

  window.addEventListener('keyup', (e) => {
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
  })

  overlayRef.value!.addEventListener('contextmenu', () => {
    return false
  })

  document.body.ondrop = (ev) => {
    console.log('File(s) dropped')
    fileTransfer = false

    // Prevent default behavior (Prevent file from being opened)
    ev.preventDefault()

    document.querySelectorAll('.message').forEach((message) => { message.remove() })
    document.body.appendChild(msgfileupload)

    const items = ev.dataTransfer?.items
    if (items) {
      // Use DataTransferItemList interface to access the file(s)
      Array.from(items).forEach(item => {
        // If dropped items aren't files, reject them
        if (item.kind === 'file') {
          const blob = item.getAsFile()!
          const reader = new FileReader()
          reader.onload = (event) => {
            send('pastefile', {
              filecontent: event.target!.result as string,
              filename: blob.name,
              room: props.room,
              name: props.user,
              color: props.color
            })
          } // data url!
          reader.readAsDataURL(blob)

          //const file = item.getAsFile()
          //console.log(`… file[${i}].name = ${file.name}`)
        }
      })
    }/* else {
      // Use DataTransfer interface to access the file(s)
      [...ev.dataTransfer.files].forEach((file, i) => {
      console.log(`… file[${i}].name = ${file.name}`)
      })
    }*/
  }

  document.body.ondragover = (ev) => {
    if (document.querySelector('#filedrop') == null) {
      console.log('File(s) in drop zone')
      fileTransfer = true


      document.querySelectorAll('.message').forEach((message) => { message.remove() })
      document.body.appendChild(msgfiledrop)

      setTimeout(() => {
        document.querySelectorAll('#filedrop').forEach((message) => { message.remove() })
      }, 5000)
    }

    // Prevent default behavior (Prevent file from being opened)
    ev.preventDefault()
  }

  window.addEventListener('paste', (e) => {
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
            room: props.room,
            name: props.user,
            color: props.color,
            time: Date.now()
          })
        })
      } else if (item.kind === 'string' && item.type.match('^text/html')) {
        // Drag data item is HTML
        item.getAsString((clipText) => {
          send('paste', {
            text: clipText.replace(/\r/g, ""),
            room: props.room,
            name: props.user,
            color: props.color,
            time: Date.now()
          })
        })
        //alert('paste html')
      } else if (item.kind === 'file') {
        const blob = item.getAsFile()!
        const reader = new FileReader()
        reader.onload = (event) => {
          send('pastefile', {
            filecontent: event.target!.result as string,
            room: props.room,
            name: props.user,
            color: props.color
          })

          const obj2: Record<string, Blob> = {}
          obj2[item.type] = blob

          navigator.clipboard.write([
            new ClipboardItem(obj2),
          ])

          //downloadBase64File(event.target.result,'config.php')
        } // data url!
        reader.readAsDataURL(blob)
      }

    }
  })

  window.addEventListener('copy', () => {
    if (remoteClipboard)
      send('copy', {
        room: props.room,
        socketid: socket.id!,
      })
  })

  window.addEventListener('cut', () => {
    if (remoteClipboard)
      send('cut', {
        room: props.room,
        socketid: socket.id!,
      })
  })

  // Add this near the other event listeners
  overlayRef.value!.addEventListener('mousemove', (e) => {
    // Get the vertical position of the mouse relative to the overlay
    const mouseY = e.clientY
    
    // Define a threshold for the "top" area (e.g., top 50 pixels)
    const topThreshold = 3
    
    if (mouseY <= topThreshold) {
      // Show help message when mouse is near top
      if (!document.body.contains(msgmousehelp)) {
        document.body.appendChild(msgmousehelp)
      }
    } else {
      // Hide help message when mouse moves away
      if (document.body.contains(msgmousehelp)) {
        msgmousehelp.remove()
      }
    }
  })

  // Also hide the help message when mouse leaves the overlay
  overlayRef.value!.addEventListener('mouseleave', () => {
    if (document.body.contains(msgmousehelp)) {
      msgmousehelp.remove()
    }
  })
})

function isTouchEnabled() {
  if (window.matchMedia("(pointer: coarse)").matches) {
    return true
  }

  return false
  /*return ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints > 0)*/
}

function send<T extends RemoteEvent>(event: T, data: RemoteData<T>, volatile = false) {
  if (volatile)
    socket.volatile.emit(event, JSON.stringify(data))
  else
    socket.emit(event, JSON.stringify(data))

  //emit('send', { event, data, volatile })
}

const receiveEvents: Partial<Record<RemoteEvent, (data: RemoteData<RemoteEvent>) => void>> = {}

function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
  receiveEvents[event]?.(data)
}

function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
  socket.on<RemoteEvent>(event, data => 
    handler(event === 'reset' ? data : JSON.parse(data)) // TODO: make serialization consistent
  )
  //receiveEvents[event] = handler
}

defineExpose({
  receive
})
</script>

<template>
  <div class="remote-viewer" ref="remoteViewer">
    <div id="overlay" ref="overlay" :style="overlayStyle"></div>
    <div id="container" class="container" ref="container">
      <div class="cursorsignal" style="animation-delay: -1s"></div>
      <div class="cursorsignal" style="animation-delay: -0.5s"></div>
      <div class="cursorsignal" style="animation-delay: 0s"></div>
    </div>
  </div>
</template>

<style>
  @font-face {
    font-family: 'Abel';
    font-style: normal;
    font-weight: 400;
    src: local('Abel Regular'), local('Abel-Regular'), url('../fonts/abel-v10-latin-regular.woff2') format('woff2');
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

  .remote-viewer #overlay {
      margin: 0px; padding: 0px; z-index:99; position:absolute; top: 0px; left: 0px; width: 400px; height: 400px;
  }

  .remote-viewer #sizeinfo {
      padding: 0px; margin: 0px; border: 1px solid black; position: absolute; z-index:2
  }

  .remote-viewer #container, .remote-viewer .container {
      width: 300px;
      height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      display: none;
      position: absolute;
      z-index: 200;
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

  .remote-viewer .item {
      z-index: 100;
      padding: 5px;
  }

  .remote-viewer .item img {
      width: 150px;
  }

  .remote-viewer .message {
      padding-left: 100px; position: absolute; z-index: 100; color: white; background: #000; padding:20px; min-width: 500px; width: 100vw
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

  .remote-viewer .copybutton, .remote-viewer .downloadbutton {
      position: absolute;
      z-index: 10;
      width: calc(100% - 17px);
      margin-top: 5px;
  }

  .remote-viewer .copybutton {
      display: none;
      bottom: 40px;
  }

  .remote-viewer .downloadbutton {
      display: inline;
      bottom: 10px;
  }

  /* Container styles */
  .remote-viewer .container {
      user-select: none;
      -webkit-user-select: none;
      clear: both;
      padding-top: 5px;
  }

  .remote-viewer #clipboardcontainer {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 160px;
      height: 200px;
      padding: 5px;
      border-radius: 5px;
      background: #1a1a1a;
      z-index: 300;
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
  .remote-viewer .checkboxcontainer {
      display: block;
      position: relative;
      padding-left: 5px;
      cursor: pointer;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
  }

  .remote-viewer .checkboxcontainer input {
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

  .remote-viewer .checkboxcontainer:hover input ~ .checkmark {
      background-color: #ccc;
  }

  .remote-viewer .checkboxcontainer input:checked ~ .checkmark {
      background-color: #2196F3;
  }

  .remote-viewer .checkmark:after {
      content: "";
      position: absolute;
      display: none;
  }

  .remote-viewer .checkboxcontainer input:checked ~ .checkmark:after {
      display: block;
  }

  .remote-viewer .checkboxcontainer .checkmark:after {
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