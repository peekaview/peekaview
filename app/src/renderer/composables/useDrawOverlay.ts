import { computed, MaybeRef, ShallowRef, unref, watch } from 'vue'
import { hexToRgb } from '../../util'
import { UserData } from 'src/interface'

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
  users?: MaybeRef<Record<string, UserData>>
}

export function useDrawOverlay(canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>, options: DrawOverlayOptions = {}) {
  const drawing: Record<string, boolean> = {}
  const pointHistory: Record<string, Stroke[]> = {}
  const latestPoint: Record<string, [number, number]> = {}

  const canvasContext = computed(() => canvasRef.value?.getContext("2d") ?? undefined)
  const scale = computed(() => unref(options.scale) ?? 1)
  const dimensions = computed(() => unref(options.dimensions) ?? (canvasRef.value ? [
    canvasRef.value.parentElement!.clientWidth ?? 0,
    canvasRef.value.parentElement!.clientHeight ?? 0
  ] : undefined))

  watch(() => [canvasRef.value, canvasContext.value, dimensions.value], () => refitDimensions(), { immediate: true })

  let fadeInterval = setInterval(() => {
    const now = Date.now()
    const fadeThreshold = now - 8000
    const fadeTimeout = now - 20000

    for (const key in pointHistory) {
      const strokes: Stroke[] = []
      for (const item of pointHistory[key]) {
        if (item.timestamp < fadeTimeout)
          continue
        
        if (item.timestamp < fadeThreshold)
          item.opacity -= 0.03

        strokes.push(item)
      }
      pointHistory[key] = strokes
    }
    repaintStrokes()
  }, 50)

  function refitDimensions() {
    if (!dimensions.value || !canvasRef.value)
      return

    canvasRef.value.style.width = dimensions.value[0] + "px"
    canvasRef.value.style.height = dimensions.value[1] + "px"

    if (!canvasContext.value)
      return

    canvasContext.value.canvas.width = dimensions.value[0]
    canvasContext.value.canvas.height = dimensions.value[1]
  }

  function startStroke(id: string, point: [number, number]) {
    if (pointHistory[id] == undefined)
      pointHistory[id] = []
    
    drawing[id] = true
    latestPoint[id] = point
  }

  function continueStroke(id: string, newPoint: [number, number]) {
    if (!drawing[id] || !latestPoint[id])
      return

    if (pointHistory[id] == undefined)
      pointHistory[id] = []

    if (latestPoint[id][0] !== newPoint[0] || latestPoint[id][1] !== newPoint[1]) {
      pointHistory[id].push({
        color: unref(options.users)?.[id]?.color ?? "#000000",
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

    canvasContext.value.clearRect(0, 0, canvasContext.value.canvas.width, canvasContext.value.canvas.height)
    for (const key in pointHistory) {
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

  function clear() {
    clearInterval(fadeInterval)
  }

  return {
    startStroke,
    continueStroke,
    endStroke,
    clear,
  }
}