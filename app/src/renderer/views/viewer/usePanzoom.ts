import { computed, reactive, ref, ShallowRef, watch } from "vue"
import Panzoom, { PanzoomEventDetail, PanzoomObject, PanzoomOptions } from "@panzoom/panzoom"

import { isTouchEnabled } from "../../util.js"

export function usePanzoom(el: Readonly<ShallowRef<HTMLElement | null>>, active = ref(false), inputEnabled = ref(true)) {
  const options: PanzoomOptions = { canvas: true, maxScale: 3, minScale: 1 }
  if (!isTouchEnabled())
    options.handleStartEvent = event => {
      if (!inputEnabled.value)
        throw "input disabled"
      if ((event as MouseEvent).button !== 1 && !active.value)
        throw "use shift + middle mouse button for panning"
      else {
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
  
  watch(() => [currentPan.x, currentPan.y, currentPanScale.value], () => {
    lastPan.x = currentPan.x
    lastPan.y = currentPan.y
    lastPanScale.value = currentPanScale.value
  
    if ((currentPan.x <= 0 && currentPan.y <= 0) || currentPanScale.value > 1)
      return
    
    console.log("reset pan")
    panzoom?.pan(0, 0, {
      animate: true
    })
  
    currentPan.x = 0
    currentPan.y = 0
  })

  const _zoom = ref<PanzoomEventDetail>()
  const zoom = computed(() => _zoom.value)
  function doZoom(delta: number) {
    if (!inputEnabled.value)
      return

    panzoom.zoom(panzoom.getScale() + (delta < 0 ? 0.1 : -0.1), { animate: true })
  }
  
  function onPanzoomChange(e: { detail: PanzoomEventDetail }) {
    if (!inputEnabled.value)
      return

    _zoom.value = e.detail
  }

  return { currentPan, currentPanScale, lastPan, lastPanScale, zoom, doZoom, onPanzoomChange }
}