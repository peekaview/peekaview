<script setup lang="ts">
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

import StreamOverlay from '../views/viewer/StreamOverlay.vue'
import { ScaleInfo, VideoTransform } from '../types'
import { RemoteEvent, RemoteData } from '../../interface'
import PresenterToolbar from '../components/PresenterToolbar.vue'
import { usePresenter, type Presenter } from '../views/presenter/usePresenter'
import { notify } from '../util'

const windowDefaultSize = [400, 400] as const
const windowSelectSize = [720, 600] as const

const appUrl = ref(import.meta.env.VITE_APP_URL)
const presenter = ref<Presenter>()
const videoRef = useTemplateRef('video')
const containerRef = useTemplateRef('container')
const overlayRef = useTemplateRef('overlay')

const mouseEnabled = ref(true)
watch(mouseEnabled, (enabled) => {
  presenter.value?.sendRemote?.('mouse-control', { enabled })
})

onMounted(() => startPreview())

async function startPreview() {
  const params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')
  
  const { email, token } = JSON.parse(atob(data))
  presenter.value = usePresenter(email, token, {
    onBeforeScreenSelect: () => window.resizeTo(...windowSelectSize),
    onAfterScreenSelect: () => window.resizeTo(...windowDefaultSize),
    onStream: (stream) => {
      videoRef.value!.srcObject = stream
      setTimeout(() => {
        videoRef.value!.play().catch(err => {
          console.error('Error playing video:', err)
        })
      }, 2500)
    },
    onRemote: (event, data) => {
      let parsedData = data
      if (typeof data === 'string' && event !== 'reset') {
        try {
          parsedData = JSON.parse(data)
        } catch (err) {
          console.error('Failed to parse remote control data:', err)
          return
        }
      }

      receive(event, parsedData)
    },
    onReset: (data) => overlayRef.value?.reset(data),
    onStop: () => window.close(),
  })
  await presenter.value.startSession()
}

const videoStyle = ref<Record<string, string>>({
  transform: 'scale(1) translate(0px,0px)',
})
const containerStyle = ref<Record<string, string>>({
  overflow: 'hidden',
  width: '800px',
  height: '600px',
})
const videoTransform = ref<VideoTransform>()

function rescale(scaleinfo: ScaleInfo) {
  const containerRect = containerRef.value!.getBoundingClientRect()
  const currentHeight = Math.round(containerRect.height)
  const currentWidth = Math.round(containerRect.width)

  let scaledowny = 1
  let scaledownx = 1
  if (scaleinfo.height > window.innerHeight)
    scaledowny = window.innerHeight / scaleinfo.height
  if (scaleinfo.width > window.innerWidth)
    scaledownx = window.innerWidth / scaleinfo.width

  let scaledown = scaledowny < scaledownx ? scaledowny : scaledownx
  
  if (scaleinfo.height != currentHeight || scaleinfo.width != currentWidth) {
    containerStyle.value.height = scaleinfo.height * scaledown + 'px'
    containerStyle.value.width = scaleinfo.width * scaledown + 'px'
  }

  containerStyle.value.overflow = 'visible'
  videoStyle.value.transform = `scale(${scaleinfo.scale}) translate(${scaleinfo.x}px,${scaleinfo.y}px)`

  nextTick(() => {  
    const containerRect = containerRef.value!.getBoundingClientRect()
    const videoRect = videoRef.value!.getBoundingClientRect()
    videoTransform.value = {
      x: Math.round(videoRect.left),
      y: Math.round(videoRect.top),
      fullwidth: Math.round(videoRect.right - videoRect.left),
      fullheight: Math.round(videoRect.bottom - videoRect.top),
      width: Math.round(containerRect.right - containerRect.left),
      height: Math.round(containerRect.bottom - containerRect.top)
    }
  })
}

type SendOptions = {
  volatile?: boolean
  receiveSelf?: boolean
}

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

const receiveEvents: Partial<ReceiveEventHandlers> = {}

onReceive("mouse-leftclick", (data) => {
  overlayRef.value?.receiveMouseLeftClick(data)
  freezeAndFocus()
})

onReceive("mouse-move", (data) => {
  overlayRef.value?.receiveMouseMove(data)
})

onReceive("mouse-down", (data) => {
  overlayRef.value?.receiveMouseDown(data)
})

let throttling = false
const shutterActive = ref(false)
onReceive("mouse-up", (data) => {
  overlayRef.value?.receiveMouseUp(data)
  freezeAndFocus()
})

function send<T extends RemoteEvent>(event: T, data: RemoteData<T>, options: SendOptions = {}) {
  presenter.value?.sendRemote?.(event, data)
  if (options.receiveSelf)
    receive(event, data)
}

function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
  receiveEvents[event]?.(data)
}

function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
  receiveEvents[event] = handler as ReceiveEventHandlers[T]
}

function freezeAndFocus() {
  if (throttling)
    return

  throttling = true
  window.setTimeout(() => throttling = false, 5000)

  shutterActive.value = true
  window.setTimeout(() => { // wait until shutter is streamed
    videoRef.value?.pause()
    shutterActive.value = false
    window.resizeTo(window.screen.width, window.screen.height)
    window.focus()
    window.setTimeout(() => {
      window.resizeTo(...windowDefaultSize)
      videoRef.value?.play()
    }, 3000)
  }, 150)
}

function showInviteLink() {
  notify({
    type: 'info',
    title: 'Invite link',
    html: `<code>${appUrl.value}?view=${presenter.value?.viewCode}</code>`,
  })
}
</script>

<template>
  <div>
    <PresenterToolbar
      v-if="presenter"
      @toggle-mouse="mouseEnabled = $event"
      @toggle-clipboard=""
      @stop-sharing="presenter.stopSharing()"
      @pause-sharing="presenter.pauseSharing()"
      @resume-sharing="presenter.resumeSharing()"
      @share-different-screen="presenter.shareLocalScreen()"
      @show-invite-link="showInviteLink"
    />
    <div ref="container" class="preview-container">
      <video ref="video" muted />
      <StreamOverlay
        v-if="presenter?.screenShareData"
        ref="overlay"
        :input-enabled="false"
        :users="presenter.viewers"
        :user-id="presenter.screenShareData.user.id"
        :video-transform="videoTransform"
        :mouse-enabled="mouseEnabled"
        @rescale="rescale"
        @send="send($event.event, $event.data, $event.options)"
      />
      <div v-if="shutterActive" class="shutter" />
    </div>
  </div>
</template>

<style>
video {
  max-width: 100%;
  max-height: 100%;
  filter: grayscale(100%);
}

.preview-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.shutter {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  z-index: 1000;
}
</style>
