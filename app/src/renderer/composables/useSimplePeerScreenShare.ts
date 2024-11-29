import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  shallowRef,
} from "vue"

import SimplePeer from 'simple-peer'
import { io, type Socket } from "socket.io-client"

import { ScreenPresent, ScreenShareData, ScreenView, SharingParticipant, ViewingParticipant } from "../types"

interface ScreenPeer {
  socket: Socket
  initPeer: (socketId: string, initiator: boolean, stream?: MediaStream) => SimplePeer.Instance
}

async function useScreenPeer({ serverUrl, roomName }: ScreenShareData, isPresenter: boolean): Promise<ScreenPeer> {
  const socket = io("wss://c1.peekaview.de")
  
  const initPeer = (socketId: string, initiator: boolean, stream?: MediaStream) => {
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: 'turn:turn.speed.cloudflare.com:50000',
            username: '03f2f3316d7c596c2674ab7af813864819b23b401772cb58f490a307141657f1fd9bbe2abd8553936072e921fcd30f7269f731501de30ceb85163f9757b9620a',
            credential: 'aba9b169546eb6dcc7bfb1cdf34544cf95b5161d602e3b5fa7c8342b2e9802fb'
          }
        ]
      }
    })

    peer.on('signal', (data) => {
      socket.emit('signal', {
        signal: data,
        socket_id: socketId
      })
    })

    peer.on("error", (err) => {
      console.error(err);
    });

    socket.on('signal', (data) => {
      if ((data.socket_id && socketId !== data.socket_id) || peer.destroyed)
        return

      peer.signal(data.signal)
    })

    onBeforeUnmount(() => peer?.destroy())

    return peer
  }

  socket.on("error", (err) => {
    console.error(err)
  })

  return new Promise((resolve) =>
    socket.on('connect', async () => {
      socket.emit('join', { roomId: roomName, isPresenter })

      resolve({ socket, initPeer })
    })
  )
}

export async function useScreenPresent(screenShareData: ScreenShareData): Promise<ScreenPresent> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, true)
  const participants = ref<Record<string, ViewingParticipant>>({})
  const peers: Record<string, SimplePeer.Instance> = {}
  let stream: MediaStream | undefined

  socket.on('initReceive', (socketId) => {
    peers[socketId] = initPeer(socketId, true, stream)

    peers[socketId].on('connect', () => {
      //peers[socketId].send(JSON.stringify({ type: 'identity', name: screenShareData.userName }))
    })
    
    peers[socketId].on('data', (json) => {
      const data = JSON.parse(json)
      switch (data.type) {
        case 'identity':
          participants.value[socketId] = { name: data.name }
          break
        case 'leave':
          close(socketId)
          break
      }
    })
  })

  socket.on('viewerLeft', data => close(data.socketId))

  const leave = () => {
    for (const socketId in peers) {
      if (stream)
        peers[socketId].removeStream(stream)

      peers[socketId].send(JSON.stringify({ type: 'close' }))
      close(socketId)
    }

    stream = undefined
  }

  const close = (socketId: string) => {
    peers[socketId]?.destroy()
    delete peers[socketId]
    delete participants.value[socketId]
  }

  const addStream = async (s: MediaStream, _shareAudio = false) => {
    stream = s
    for (const socketId in peers)
      peers[socketId].addStream(stream)
  }

  return reactive({ participants, addStream, leave })
}

export async function useScreenView(screenShareData: ScreenShareData, onEnding?: () => void): Promise<ScreenView> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, false)
  const sharingParticipant = ref<SharingParticipant>()
  const stream = shallowRef<MediaStream>()
  let sharingPeer: SimplePeer.Instance | undefined

  const trackElement = computed(() => {
    console.log('trackElement', stream.value)
    if (!stream.value)
      return undefined
    
    const trackElement = document.createElement('video')
    trackElement.srcObject = stream.value
    trackElement.autoplay = true
    trackElement.playsInline = true
    trackElement.muted = true

    // Wait for metadata to load before attempting to play
    trackElement.addEventListener('loadedmetadata', () => {
      const attemptPlay = async () => {
        try {
          await trackElement.play()
        } catch (err) {
          console.warn('Autoplay failed:', err)
          // Retry once after a short delay
          setTimeout(attemptPlay, 100)
        }
      }
      attemptPlay()
    })
    
    return trackElement
  })

  const close = () => {
    sharingPeer?.destroy()
    sharingPeer = undefined
    sharingParticipant.value = undefined
    stream.value = undefined

    onEnding?.()
  }

  socket.on('presenterLeft', () => close())

  return new Promise<ScreenView>((resolve) => {
    socket.on('presenterId', (socketId) => {
      console.log('presenterId', socketId)
      sharingPeer = initPeer(socketId, false)
      sharingPeer.on('connect', () => 
        sharingPeer!.send(JSON.stringify({ type: 'identity', name: screenShareData.userName }))
      )
      sharingPeer.on('stream', s => {
        console.log('Received stream:', s.getTracks())
        stream.value = s
      })
      sharingPeer.on('data', (json) => {
        const data = JSON.parse(json)
        switch (data.type) {
          case 'identity':
            sharingParticipant.value = { name: data.name }
            break
          case 'close':
            close()
            break
        }
      })

      const leave = () => {
        sharingPeer?.send(JSON.stringify({ type: 'leave' }))
        close()
      }

      resolve(reactive({ sharingParticipant, trackElement, leave }))
    })
  })
}
