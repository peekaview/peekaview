import { computed, MaybeRef, ShallowRef, unref, watch } from 'vue'
import { hexToRgb } from '../util'

type Stroke = {
  from: [number, number]
  to: [number, number]
  color: string
  timestamp: number
  opacity: number
}

type DrawOverlayOptions = {
  scale?: MaybeRef<number>
  dimensions?: MaybeRef<[number, number] | undefined>
}

export function useDrawOverlay(canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>, options: DrawOverlayOptions = {}) {
  const drawing: Record<string, boolean> = {}
  const pointHistory: Record<string, Stroke[]> = {}
  const latestPoint: Record<string, [number, number]> = {}
  let paintcheckinterval: number

  const canvasContext = computed(() => canvasRef.value?.getContext("2d") ?? undefined)
  const scale = computed(() => unref(options.scale) ?? 1)
  const dimensions = computed(() => unref(options.dimensions) ?? (canvasRef.value ? [
    canvasRef.value.parentElement!.clientWidth ?? 0,
    canvasRef.value.parentElement!.clientHeight ?? 0
  ] : undefined))

  watch(() => [canvasRef.value, canvasContext.value, dimensions.value], () => refitDimensions(), { immediate: true })

  function refitDimensions() {
    window.electronAPI?.log('refitDimensions', dimensions.value, canvasRef.value)
    if (!dimensions.value || !canvasRef.value)
      return

    canvasRef.value.style.width = dimensions.value[0] + "px"
    canvasRef.value.style.height = dimensions.value[1] + "px"

    window.electronAPI?.log('refitDimensions canvas')

    if (!canvasContext.value)
      return

    canvasContext.value.canvas.width = dimensions.value[0]
    canvasContext.value.canvas.height = dimensions.value[1]

    window.electronAPI?.log('refitDimensions canvasContext')
  }

  function startStroke(id: string, point: [number, number]) {
    if (pointHistory[id] == undefined)
      pointHistory[id] = []
    
    drawing[id] = true
    latestPoint[id] = point
    window.electronAPI?.log('startStroke', id, point)

    if (paintcheckinterval === undefined) {
      paintcheckinterval = window.setInterval(() => {
        for (const key in pointHistory) {
          const strokes: Stroke[] = []
          for (const item of pointHistory[key]) {
            if (item.timestamp >= (Date.now() - 8000)) {
              strokes.push(item)
            }
            if (item.timestamp < (Date.now() - 8000) && item.timestamp > (Date.now() - 20000)) {
              item.opacity = item.opacity - 0.03
              strokes.push(item)
            }
          }
          pointHistory[key] = strokes
        }
        repaintStrokes()
      }, 50)
    }
  }

  function continueStroke(id: string, color: string, newPoint: [number, number]) {
    if (!drawing[id] || !latestPoint[id])
      return

    if (pointHistory[id] == undefined)
      pointHistory[id] = []

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

  function endStroke(id: string) {
    drawing[id] = false
    delete latestPoint[id]
  }

  function repaintStrokes() {
    if (!canvasContext.value)
      return

    for (const key in pointHistory) {
      canvasContext.value.clearRect(0, 0, canvasContext.value.canvas.width, canvasContext.value.canvas.height)
      for (const item of pointHistory[key]) {
        canvasContext.value.beginPath()
        canvasContext.value.moveTo(Math.round(item.from[0] * scale.value), Math.round(item.from[1] * scale.value))
        canvasContext.value.strokeStyle = "rgba(" + hexToRgb(item.color)!.r + ", " + hexToRgb(item.color)!.g + ", " + hexToRgb(item.color)!.b + ", " + item.opacity + ")"
        canvasContext.value.lineWidth = 5
        canvasContext.value.lineCap = "round"
        canvasContext.value.lineJoin = "round"
        canvasContext.value.lineTo(Math.round(item.to[0] * scale.value), Math.round(item.to[1] * scale.value))
        canvasContext.value.stroke()
      }
    }
  }

  return {
    startStroke,
    continueStroke,
    endStroke,
  }
}