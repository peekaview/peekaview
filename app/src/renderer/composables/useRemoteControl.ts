import { ref, onMounted, onUnmounted } from 'vue'

interface ScaleInfo {
  height: number
  width: number
  scale: number
  x: number
  y: number
}

interface MessageData {
  action: string
  scaleinfo?: ScaleInfo
}

export type RemoteControlReturn = ReturnType<typeof useRemoteControl>

export function useRemoteControl() {
  const lastOpenRemoteControl = ref<string | null>(null)

  const checkIfUrlAllowed = (_url: string, _optionalcompareurl: string | null = null): boolean => {
    return true
    // TODO: check if url is allowed
  }

  const denyLoadingInTopWindow = (): void => {
    if (window.self === window.top) {
      //window.location.href = 'about:blank';
    }
  }

  const disableBrowserZoom = (): () => void => {
    const handleKeydown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
        e.preventDefault()
      }
    }

    const handleBrowserZoomWheel = (e: WheelEvent): void => {
      console.log("wheel")
      if (e.ctrlKey || e.metaKey)
        e.preventDefault()
    }

    document.addEventListener('keydown', handleKeydown, false)
    document.addEventListener("wheel", handleBrowserZoomWheel, { passive: false })

    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('wheel', handleBrowserZoomWheel)
    }
  }

  const handleMessage = (e: MessageEvent): void => {
    //console.log("handleMessage", e)
    if (checkIfUrlAllowed(e.origin) && e.data != undefined) {
      let data: MessageData
      try {
        data = JSON.parse(e.data)
      } catch (err) {
        data = { action: 'none' }
      }
      if (data.action == 'setscale' && data.scaleinfo) {
        const wrapper = document.querySelector('div#remoteviewerwrapper') as HTMLDivElement
        const wrapperRect = wrapper.getBoundingClientRect()
        
        const currentHeight = Math.round(wrapperRect.height)
        const currentWidth = Math.round(wrapperRect.width)

        //console.log("handleMessage", data.scaleinfo)

        let scaledowny = 1
        let scaledownx = 1
        let scaledown = 1
        if (data.scaleinfo.height > window.innerHeight) {
          scaledowny = window.innerHeight / data.scaleinfo.height
        }
        if (data.scaleinfo.width > window.innerWidth) {
          scaledownx = window.innerWidth / data.scaleinfo.width
        }
        if (scaledowny < scaledownx) {
          scaledown = scaledowny
        } else {
          scaledown = scaledownx
        }
        
        if (data.scaleinfo.height != currentHeight || data.scaleinfo.width != currentWidth) {
          wrapper.style.height = data.scaleinfo.height * scaledown + 'px'
          wrapper.style.width = data.scaleinfo.width * scaledown + 'px'
        }

        wrapper.style.overflow = 'visible'
        const video = document.querySelector('video') as HTMLVideoElement
        video.style.transform = `scale(${data.scaleinfo.scale}) translate(${data.scaleinfo.x}px,${data.scaleinfo.y}px)`

        const obj = {
          action: 'videosize',
          sizeinfo: {
            x: Math.round(video.getBoundingClientRect().left),
            y: Math.round(video.getBoundingClientRect().top),
            fullwidth: Math.round(video.getBoundingClientRect().right - video.getBoundingClientRect().left),
            fullheight: Math.round(video.getBoundingClientRect().bottom - video.getBoundingClientRect().top),
            width: Math.round(wrapper.getBoundingClientRect().right - wrapper.getBoundingClientRect().left),
            height: Math.round(wrapper.getBoundingClientRect().bottom - wrapper.getBoundingClientRect().top)
          }
        }
        if (e.source) {
          (e.source as Window).postMessage(JSON.stringify(obj), '*')
        }
      }
    }
  }

  const openRemoteControl = (roomid: string, username: string, userid: string, color: string, hostname: string): void => {
    if (lastOpenRemoteControl.value === userid) return

    console.log("open remote control")
    lastOpenRemoteControl.value = userid

    let remoteviewer = window.document.querySelector('#remoteviewer')
    if (remoteviewer) {
      remoteviewer.remove()
    }

    let ifrm = document.createElement("iframe")
    ifrm.setAttribute("src", `./static/remoteviewer.html?hostname=${hostname}&roomid=${roomid}&color=${color}&username=${username}&userid=${userid}`)
    ifrm.style.cssText = "min-width: 100vw; min-height: 100vh; width: 100%; height: 100%; position: absolute; top: 0px; border: 0px; z-index:9999"
    ifrm.id = "remoteviewer"
    ifrm.allow = "clipboard-write"

    const wrapper = window.document.querySelector('#remoteviewerwrapper') as HTMLDivElement
    wrapper.appendChild(ifrm)
    repaintRemoteControl()
  }

  const closeRemoteControl = (): void => {
    lastOpenRemoteControl.value = null
    let remoteviewer = window.document.querySelector('#remoteviewer')
    if (remoteviewer) {
      console.log("close remote viewer")
      remoteviewer.remove()
      const wrapper = window.document.querySelector('#remoteviewerwrapper') as HTMLDivElement
      wrapper.style.overflow = 'hidden'
    }
  }

  const repaintRemoteControl = (): void => {
    let remoteviewer = window.document.querySelector('#remoteviewer') as HTMLIFrameElement | null
    if (remoteviewer) {
      const wrapper = document.querySelector('div#remoteviewerwrapper') as HTMLDivElement
      wrapper.style.overflow = 'visible'
      remoteviewer.style.top = '0px'
      remoteviewer.style.left = '0px'
      remoteviewer.style.minWidth = '100vw'
      remoteviewer.style.minHeight = '100vh'
      remoteviewer.style.width = '100%'
      remoteviewer.style.height = '100%'
    }
  }

  onMounted(() => {
    denyLoadingInTopWindow()
    const cleanupZoom = disableBrowserZoom()
    window.addEventListener('message', handleMessage)
    window.addEventListener('resize', repaintRemoteControl)

    onUnmounted(() => {
      cleanupZoom()
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('resize', repaintRemoteControl)
    })
  })

  return {
    openRemoteControl,
    closeRemoteControl,
    repaintRemoteControl
  }
}