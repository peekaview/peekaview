import {
  computed,
  Reactive,
  reactive,
  Ref,
  ref,
  shallowRef,
  watch,
} from "vue"

import SimplePeer from 'simple-peer'
import { io, type Socket } from "socket.io-client"

import { PeerData, RemoteData, RemoteEvent, TurnCredentials, UserData } from "src/interface"

interface ScreenPresentOptions {
  turnCredentials?: TurnCredentials
  inBrowser?: boolean
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
}

interface ScreenViewOptions {
  turnCredentials?: TurnCredentials
  videoElement?: HTMLVideoElement
  role?: PeerRole
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
  onEnding?: () => void
}

export type ScreenPresent = Reactive<{
  participants: Ref<Record<string, UserData>>
  addStream: (stream: MediaStream, shareAudio: boolean) => Promise<void>
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>, socketId?: string, exclude?: boolean) => void
  leave: () => void
}>

export type ScreenView = Reactive<{
  sharingParticipant: Ref<UserData | undefined>
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
  leave: () => void
}>

interface ScreenPeer {
  socket: Socket
  initPeer: (socketId: string, initiator: boolean, stream?: MediaStream) => SimplePeer.Instance
}

export type ScreenShareData = ScreenPeerData & {
  user: UserData
  roomId: string
  roomName: string
  serverUrl: string
  controlServer: string
}

export type ScreenPeerData = {
  roomId: string
  turnCredentials: TurnCredentials
}

export type PeerRole = 'presenter' | 'viewer' | 'preview'

const rtcIceServer = JSON.parse(import.meta.env.VITE_RTC_ICE_SERVER) as RTCIceServer

export async function useScreenPeer({ roomId, turnCredentials }: ScreenPeerData, role: PeerRole, wrtc?: SimplePeer.Options["wrtc"]): Promise<ScreenPeer> {
  const socket = io(import.meta.env.VITE_RTC_CONTROL_SERVER)

  console.debug('Initializing peer with ICE servers:', rtcIceServer)
  console.debug('Turn credentials:', turnCredentials)
  
  const initPeer = (socketId: string, initiator: boolean, stream?: MediaStream) => {
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream,
      wrtc,
      config: {
        iceServers: [
          {
            ...rtcIceServer,
            ...(turnCredentials ?? {}),
          },
          {urls:['stun:stun.1und1.de:3478']},
          //{urls:['stun:stun.hosteurope.de:3478']},
        ]
      },
      channelConfig: {
        ordered: false,
        maxRetransmits: 0,
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
      socket.emit('join', { roomId, role })

      resolve({ socket, initPeer })
    })
  )
}

export async function useScreenPresent(screenShareData: ScreenShareData, options?: ScreenPresentOptions): Promise<ScreenPresent> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, 'presenter')
  const _participants = ref<Record<string, UserData>>({})
  const participants = computed(() => _participants.value) // make this one readonly
  const peers: Record<string, SimplePeer.Instance> = {}
  let previewPeer: SimplePeer.Instance | undefined
  let stream: MediaStream | undefined

  socket.on('initReceive', ({ socketId, role }: { socketId: string, role: PeerRole }) => {
    switch (role) {
      case 'viewer':
        peers[socketId] = initPeer(socketId, true, stream)
    
        peers[socketId].on('connect', () => {
          peers[socketId].send(JSON.stringify({ type: 'identity', user: screenShareData.user }))
          if (options?.inBrowser)
            sendRemote("browser", {}, socketId)
        })
        
        peers[socketId].on('data', (json) => {
          const data = JSON.parse(json) as PeerData
          switch (data.type) {
            case 'remote':
              options?.onRemote?.(data.event, data.data)
              sendRemote(data.event, data.data, socketId, true)
              break
            case 'identity':
              _participants.value[socketId] = data.user
              break
            case 'leave':
              close(socketId)
              break
          }
        })
        
        peers[socketId].on('close', () => close(socketId))
        break
      case 'preview':
        previewPeer = initPeer(socketId, true, stream)
        break
      default:
        console.error('Invalid role connected:', role, socketId)
        break
    }
  })

  socket.on('viewerLeft', data => close(data.socketId))

  const leave = () => {
    for (const socketId in peers) {
      if (stream)
        peers[socketId].removeStream(stream)

      try { 
        peers[socketId].send(JSON.stringify({ type: 'close' }))
      } catch (err) {
        console.error('Error sending close signal:', err)
      }
      close(socketId)
    }

    if (stream)
      previewPeer?.removeStream(stream)

    previewPeer?.destroy()
    previewPeer = undefined

    stream = undefined
  }

  const close = (socketId: string) => {
    peers[socketId]?.destroy()
    delete peers[socketId]
    delete _participants.value[socketId]
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

  const sendRemote = <T extends RemoteEvent>(event: T, data: RemoteData<T>, socketId?: string, exclude = false) => {
    send({ type: 'remote', event, data }, socketId, exclude)
  }

  const send = (data: any, socketId?: string, exclude = false) => {
    let sendToPeers = { ...peers }
    if (socketId) {
      if (exclude)
        delete sendToPeers[socketId]
      else
        sendToPeers = peers[socketId] ? { socketId: peers[socketId] } : {}
    }

    for (const socketId in sendToPeers)
      sendToPeers[socketId].send(JSON.stringify(data))
  }

  return reactive({ participants, addStream, sendRemote, leave })
}

export async function useScreenView(screenShareData: ScreenShareData, options?: ScreenViewOptions): Promise<ScreenView> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, options?.role ?? 'viewer')
  const _sharingParticipant = ref<UserData>()
  const sharingParticipant = computed(() => _sharingParticipant.value) // make this one readonly
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
    _sharingParticipant.value = undefined
    stream.value = undefined

    options?.onEnding?.()
  }

  socket.on('presenterLeft', () => close())

  return new Promise<ScreenView>((resolve) => {
    socket.on('presenterId', (socketId) => {
      if (sharingPeer)
        return

      sharingPeer = initPeer(socketId, false)
      sharingPeer.on('connect', () => 
        sharingPeer!.send(JSON.stringify({ type: 'identity', user: screenShareData.user }))
      )

      sharingPeer.on('stream', s => {
        stream.value = s
      })
      sharingPeer.on('data', (json) => {
        const data = JSON.parse(json) as PeerData
        switch (data.type) {
          case 'remote':
            options?.onRemote?.(data.event, data.data)
            break
          case 'identity':
            _sharingParticipant.value = data.user
            break
          case 'close':
            close()
            break
        }
      })
      sharingPeer.on('close', () => close())

      const sendRemote = <T extends RemoteEvent>(event: T, data: RemoteData<T>) => {
        sharingPeer?.send(JSON.stringify({ type: 'remote', event, data }))
      }

      const leave = () => {
        try { 
          sharingPeer?.send(JSON.stringify({ type: 'leave' }))
        } catch (err) {
          console.error('Error sending leave signal:', err)
        }
        close()
      }

      resolve(reactive({ sharingParticipant, sendRemote, leave }))
    })
  })
}
