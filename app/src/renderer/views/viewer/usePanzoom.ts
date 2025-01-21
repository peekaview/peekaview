import { computed, reactive, ref, ShallowRef, watch } from "vue"
import Panzoom, { PanzoomEventDetail, PanzoomObject, PanzoomOptions } from "@panzoom/panzoom"

import { isTouchEnabled } from "../../util.js"

export function usePanzoom(el: Readonly<ShallowRef<HTMLElement | null>>, ignore = ref(false)) {
  const options: PanzoomOptions = { canvas: true, maxScale: 3, minScale: 1 }
  if (!isTouchEnabled())
    options.handleStartEvent = event => {
      if ((event as MouseEvent).button !== 1 && !ignore.value) {
        throw "use middle button for panning"
      } else {
        event.stopPropagation()
        event.preventDefault()
      }
    }

  let panzoom: PanzoomObject
  let updateInterval: number

  watch(el, el => {
    if (!el) {
      panzoom?.destroy()
      clearInterval(updateInterval)
      return
    }

    panzoom = Panzoom(el, options)

    updateInterval = window.setInterval(() => {
      const { x, y } = panzoom.getPan()
      currentPan.x = x
      currentPan.y = y
      currentPanScale.value = panzoom.getScale()
    }, 50)
  })

  const currentPan = reactive({ x: 0, y: 0 })
  const currentPanScale = ref(1)
  const lastPan = reactive({ x: 0, y: 0 })
  const lastPanScale = ref(1)
  
  watch(() => [currentPan, currentPanScale.value], () => {
    lastPan.x = currentPan.x
    lastPan.y = currentPan.y
    lastPanScale.value = currentPanScale.value
  
    if ((currentPan.x <= 0 && currentPan.y <= 0) || currentPanScale.value > 1)
      return
  
    panzoom?.pan(0, 0, {
      animate: true
    })
  
    currentPan.x = 0
    currentPan.y = 0
  })

  const _zoom = ref<PanzoomEventDetail>()
  const zoom = computed(() => _zoom.value)
  function doZoom(e: WheelEvent) {
    if (!e.ctrlKey) return
    panzoom.zoom(panzoom.getScale() + (e.deltaY < 0 ? 0.1 : -0.1), { animate: true })
  }
  
  function onPanzoomChange(e: { detail: PanzoomEventDetail }) {
    _zoom.value = e.detail
  }

  return { currentPan, currentPanScale, lastPan, lastPanScale, zoom, doZoom, onPanzoomChange }
}