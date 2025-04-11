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

  watch(() => [canvasRef.value, canvasContext.value, unref(options.dimensions)], () => refitDimensions(), { immediate: true })

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
    console.log("refitDimensions", unref(options.dimensions), canvasRef.value?.parentElement?.clientWidth, canvasRef.value?.parentElement?.clientHeight)
    window.electronAPI?.log("refitDimensions", unref(options.dimensions), canvasRef.value?.parentElement?.clientWidth, canvasRef.value?.parentElement?.clientHeight)
    if (!canvasRef.value)
      return

    const width = unref(options.dimensions)?.[0] ?? canvasRef.value?.parentElement?.clientWidth
    const height = unref(options.dimensions)?.[1] ?? canvasRef.value?.parentElement?.clientHeight

    if (!width || !height)
      return

    canvasRef.value.style.width = width + "px"
    canvasRef.value.style.height = height + "px"

    if (!canvasContext.value)
      return

    canvasContext.value.canvas.width = width
    canvasContext.value.canvas.height = height
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
        canvasContext.value.lineWidth = 5 * scale.value
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
    refitDimensions,
    clear,
  }
}