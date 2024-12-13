import {
  Reactive,
  reactive,
  Ref,
  ref,
  shallowRef,
  watch,
} from "vue"

import SimplePeer from 'simple-peer'
import { io, type Socket } from "socket.io-client"

import { ScreenShareData, TurnCredentials } from "../types"

interface ScreenPeer {
  socket: Socket
  initPeer: (socketId: string, initiator: boolean, stream?: MediaStream) => SimplePeer.Instance
}

interface ScreenPresentOptions {
  turnCredentials?: TurnCredentials
  remoteEnabled?: boolean
  onRemote?: (data: RemoteData) => void
}

interface ScreenViewOptions {
  turnCredentials?: TurnCredentials
  videoElement?: HTMLVideoElement
  onRemote?: (data: RemoteData) => void
  onEnding?: () => void
}

export type ScreenPresent = Reactive<{
  participants: Ref<Record<string, ViewingParticipant>>
  addStream: (stream: MediaStream, shareAudio: boolean) => Promise<void>
  sendRemote: (data: RemoteData, socketId?: string, exclude?: boolean) => void
  leave: () => void
}>

export type ScreenView = Reactive<{
  sharingParticipant: Ref<SharingParticipant | undefined>
  sendRemote: (data: RemoteData) => void
  leave: () => void
}>

export type PeerRole = 'presenter' | 'viewer' | 'streamer'

export type PeerData = {
  type: 'identity'
  name: string
} | {
  type: 'remote'
  remote: RemoteData
} | {
  type: 'leave' | 'close'
}

export type RemoteData = {
  enable?: boolean
}

export type ViewingParticipant = {
  name: string | undefined
}

export type SharingParticipant = {
  name: string | undefined
}

const rtcIceServer = JSON.parse(import.meta.env.VITE_RTC_ICE_SERVER) as RTCIceServer

async function useScreenPeer({ roomName }: ScreenShareData, role: PeerRole, turnCredentials?: TurnCredentials): Promise<ScreenPeer> {
  const socket = io(import.meta.env.VITE_RTC_CONTROL_SERVER)
  
  const initPeer = (socketId: string, initiator: boolean, stream?: MediaStream) => {
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            ...rtcIceServer,
            ...(turnCredentials ?? {}),
          }
        ]
      },
      offerOptions: {
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      }
    })

    peer.on('signal', (data) => {
      socket.emit('signal', {
        signal: data,
        socket_id: socketId
      })
    })

    peer.on("error", (err) => {
      console.error(err)
    })

    socket.on('signal', (data) => {
      if ((data.socket_id && socketId !== data.socket_id) || peer.destroyed)
        return

      peer.signal(data.signal)
    })

    return peer
  }

  socket.on("error", (err) => {
    console.error(err)
  })

  return new Promise((resolve) =>
    socket.on('connect', async () => {
      socket.emit('join', { roomId: roomName, role })

      resolve({ socket, initPeer })
    })
  )
}

export async function useScreenPresent(screenShareData: ScreenShareData, options?: ScreenPresentOptions): Promise<ScreenPresent> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, 'presenter', options?.turnCredentials)
  const participants = ref<Record<string, ViewingParticipant>>({})
  const peers: Record<string, SimplePeer.Instance> = {}
  let stream: MediaStream | undefined

  socket.on('initReceive', ({ socketId, role }) => {
    if (role !== 'viewer')
      return

    peers[socketId] = initPeer(socketId, true, stream)

    peers[socketId].on('connect', () => {
      peers[socketId].send(JSON.stringify({ type: 'identity', name: screenShareData.userName }))
      if (options?.remoteEnabled)
        peers[socketId].send(JSON.stringify({ type: 'remote', remote: { enable: true } }))
    })
    
    peers[socketId].on('data', (json) => {
      const data = JSON.parse(json) as PeerData
      switch (data.type) {
        case 'remote':
          options?.onRemote?.(data.remote)
          sendRemote(data.remote, socketId, true)
          break
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
    s.getVideoTracks().forEach(track => {
      const constraints = {
        width: { max: 2560 },
        height: { max: 1440 },
        frameRate: { max: 15 },
      };
      track.applyConstraints(constraints);
    });
    
    stream = s;
    for (const socketId in peers)
      peers[socketId].addStream(stream);
  }

  const sendRemote = (data: RemoteData, socketId?: string, exclude = false) => {
    let sendToPeers = { ...peers }
    if (socketId) {
      if (exclude)
        delete sendToPeers[socketId]
      else
        sendToPeers = peers[socketId] ? { socketId: peers[socketId] } : {}
    }

    for (const socketId in sendToPeers)
      sendToPeers[socketId].send(JSON.stringify({ type: 'remote', data }))
  }

  return reactive({ participants, addStream, sendRemote, leave })
}

export async function useScreenView(screenShareData: ScreenShareData, options?: ScreenViewOptions): Promise<ScreenView> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, 'viewer', options?.turnCredentials)
  const sharingParticipant = ref<SharingParticipant>()
  const stream = shallowRef<MediaStream>()
  let sharingPeer: SimplePeer.Instance | undefined

  watch(stream, (stream) => {
    if (!stream || !options?.videoElement)
      return

    options.videoElement.srcObject = stream
    setTimeout(() => {
      options!.videoElement!.play().catch(err => {
        console.error('Error playing video:', err)
      })
    }, 5000)
  })

  const close = () => {
    sharingPeer?.destroy()
    sharingPeer = undefined
    sharingParticipant.value = undefined
    stream.value = undefined

    options?.onEnding?.()
  }

  socket.on('presenterLeft', () => close())

  return new Promise<ScreenView>((resolve) => {
    socket.on('presenterId', (socketId) => {
      sharingPeer = initPeer(socketId, false)
      sharingPeer.on('connect', () => 
        sharingPeer!.send(JSON.stringify({ type: 'identity', name: screenShareData.userName }))
      )

      sharingPeer.on('stream', s => {
        stream.value = s
      })
      sharingPeer.on('data', (json) => {
        const data = JSON.parse(json) as PeerData
        switch (data.type) {
          case 'remote':
            options?.onRemote?.(data.remote)
            break
          case 'identity':
            sharingParticipant.value = { name: data.name }
            break
          case 'close':
            close()
            break
        }
      })

      const sendRemote = (data: RemoteData) => {
        sharingPeer?.send(JSON.stringify({ type: 'remote', data }))
      }

      const leave = () => {
        sharingPeer?.send(JSON.stringify({ type: 'leave' }))
        close()
      }

      resolve(reactive({ sharingParticipant, sendRemote, leave }))
    })
  })
}
