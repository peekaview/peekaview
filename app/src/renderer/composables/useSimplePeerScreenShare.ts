import {
  computed,
  ComputedRef,
  Reactive,
  reactive,
  Ref,
  ref,
  shallowRef,
} from "vue"

import SimplePeer from 'simple-peer'
import { io, type Socket } from "socket.io-client"

import { PeerData, RemoteData, RemoteEvent, SendRemote, SendRemoteOptions, TurnCredentials, UserData } from "src/interface"

interface ScreenPresentOptions {
  turnCredentials?: TurnCredentials
  onRemote?: SendRemote
}

interface ScreenViewOptions {
  turnCredentials?: TurnCredentials
  role?: PeerRole
  onConnected?: () => void
  onStream?: (stream: MediaStream) => void
  onRemote?: SendRemote
  onEnding?: () => void
}

interface ScreenPeerOptions {
  wrtc?: SimplePeer.Options["wrtc"]
  stream?: Ref<MediaStream | undefined>
  roleHandlers?: Partial<Record<PeerRole, (socketId: string) => void>>
  onRemote?: SendRemote
}

export type ScreenPresent = Reactive<ScreenBase & {
  addStream: (stream: MediaStream) => Promise<void>
  cleanUpStream: () => Promise<void>
  leave: () => void
}>

export type ScreenView = Reactive<ScreenBase & {
  presenterSocketId: ComputedRef<string | undefined>
  leave: () => void
}>

interface ScreenPeer extends ScreenBase {
  socket: Socket
  initPeer: (socketId: string, initiator: boolean) => SimplePeer.Instance
  createParticipant: (socketId: string, initiator: boolean, onConnect?: () => void, onLeave?: () => void) => SimplePeer.Instance
  send: (data: any, socketIds?: string[] | undefined) => void
  dismiss: (socketId: string) => void
}

interface ScreenBase {
  participants: ComputedRef<Record<string, ScreenParticipant>>
  sendRemote: SendRemote
}

interface ScreenParticipant {
  peer: SimplePeer.Instance
  remoteToken?: string
  user: UserData
}

export type ScreenShareData = ScreenPeerData & {
  roomId: string
  roomName: string
  serverUrl: string
  controlServer: string
}

export type ScreenPeerData = {
  user: UserData
  roomId: string
  turnCredentials: TurnCredentials
}

export type PeerRole = 'presenter' | 'viewer'

let rtcIceServer: RTCIceServer = { urls: [] }
try {
  rtcIceServer = JSON.parse(import.meta.env.VITE_RTC_ICE_SERVER) as RTCIceServer
} catch (e) {}

export async function useScreenPeer({ user, roomId, turnCredentials }: ScreenPeerData, role: PeerRole, options?: ScreenPeerOptions): Promise<ScreenPeer> {
  const socket = io(import.meta.env.VITE_RTC_CONTROL_SERVER)
  const participants = ref<Record<string, ScreenParticipant>>({})

  console.debug('Initializing peer with ICE servers:', rtcIceServer)
  console.debug('Turn credentials:', turnCredentials)
  
  const initPeer = (socketId: string, initiator: boolean) => {
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: options?.stream?.value,
      wrtc: options?.wrtc,
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

  await new Promise<void>((resolve) =>
    socket.on('connect', () => resolve())
  )

  socket.emit('join', { roomId, role })

  socket.on('initReceive', ({ socketId, role }: { socketId: string, role: PeerRole }) => {
    if (options?.roleHandlers?.[role]) {
      options.roleHandlers[role](socketId)
      return
    }

    console.error('Invalid role connected:', role, socketId)
  })

  socket.on('peerIds', async (peerIds: string[]) => {
    for (const socketId of peerIds)
      createParticipant(socketId, false, () => {}, () => dismiss(socketId))
  })

  socket.on('peerLeft', socketId => dismiss(socketId))

  const createParticipant = (socketId: string, initiator: boolean, onConnect?: (peer: SimplePeer.Instance) => void, onLeave?: () => void) => {
    const newPeer = initPeer(socketId, initiator)
    
    newPeer.on('connect', () => {
      newPeer.send(JSON.stringify({ type: 'identity', user }))
      onConnect?.(newPeer)
    })
    
    newPeer.on('data', (json: string) => {
      const data = JSON.parse(json) as PeerData
      switch (data.type) {
        case 'remote':
          options?.onRemote?.(data.event, data.data)
          break
        case 'identity':
          participants.value[socketId] = {
            peer: newPeer,
            user: data.user
          }
          break
        case 'leave':
          onLeave?.()
          break
      }
    })
    
    newPeer.on('close', () => onLeave?.())

    return newPeer
  }

  const send = (data: any, socketIds?: string[] | undefined) => {
    let sendTo: ScreenParticipant[]
    if (!socketIds)
      sendTo = Object.values(participants.value)
    else
      sendTo = socketIds.map(socketId => participants.value[socketId]).filter(p => p)

    for (const socketId in sendTo)
      sendTo[socketId].peer.send(JSON.stringify(data))
  }

  const sendRemote = <T extends RemoteEvent>(event: T, data: RemoteData<T>, options?: SendRemoteOptions) => {
    send({ type: 'remote', event, data }, options?.socketIds)
  }

  const dismiss = (socketId: string) => {
    participants.value[socketId]?.peer.destroy()
    delete participants.value[socketId]
  }

  return {
    socket,
    participants: computed(() => participants.value),
    initPeer,
    createParticipant,
    send,
    sendRemote,
    dismiss
  }
}

export async function useScreenPresent(screenShareData: ScreenShareData, options?: ScreenPresentOptions): Promise<ScreenPresent> {
  const stream = shallowRef<MediaStream>()
  const { socket, participants, createParticipant, sendRemote, dismiss } = await useScreenPeer(screenShareData, 'presenter', {
    onRemote: options?.onRemote,
    stream,
    roleHandlers: { 
      viewer: (socketId) => {
        createParticipant(socketId, true, () => {}, () => dismiss(socketId))
      }
    },
  })

  const addStream = async (s: MediaStream) => {
    const videoConstraints = {
      width: { max: 2560 },
      height: { max: 1440 },
      frameRate: { max: 15 },
    }

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }

    s.getVideoTracks().forEach(track => {
      track.applyConstraints(videoConstraints)
    })

    s.getAudioTracks().forEach(track => {
      track.applyConstraints(audioConstraints)
    })
    
    stream.value = s;
    for (const socketId in participants.value)
      participants.value[socketId].peer.addStream(stream.value);
  }

  const cleanUpStream = async () => {
    if (stream.value) {
      for (const socketId in participants.value)
        participants.value[socketId].peer.removeStream(stream.value)
      stream.value = undefined
    }
  }

  const leave = () => {
    for (const socketId in participants.value) {
      if (stream.value)
        participants.value[socketId].peer.removeStream(stream.value)

      try { 
        participants.value[socketId].peer.send(JSON.stringify({ type: 'leave' }))
      } catch (err) {
        console.error('Error sending leave signal:', err)
      }
      dismiss(socketId)
    }

    socket.disconnect()
    stream.value = undefined
  }

  return reactive({
    participants,
    addStream,
    cleanUpStream,
    sendRemote,
    leave
  })
}

export async function useScreenView(screenShareData: ScreenShareData, options?: ScreenViewOptions): Promise<ScreenView> {
  const stream = shallowRef<MediaStream>()
  const presenterSocketId = ref<string | undefined>()
  const { socket, participants, createParticipant, sendRemote, dismiss } = await useScreenPeer(screenShareData, options?.role ?? 'viewer', {
    onRemote: options?.onRemote,
    roleHandlers: {
      viewer: (socketId) => {
        createParticipant(socketId, true, () => {}, () => dismiss(socketId))
      }
    },
  })

  const leave = () => {
    for (const socketId in participants.value) {
      try { 
        participants.value[socketId].peer.send(JSON.stringify({ type: 'leave' }))
      } catch (err) {
        console.error('Error sending leave signal:', err)
      }
    }

    close()
  }

  const close = () => {
    for (const socketId in participants.value)
      dismiss(socketId)

    socket.disconnect()
    stream.value = undefined
    options?.onEnding?.()
  }

  socket.on('presenterLeft', () => close())

  await new Promise<void>((resolve) => socket.on('presenterId', async (socketId: string) => {
    if (presenterSocketId.value)
      return

    presenterSocketId.value = socketId
    console.log('presenterSocketId', socketId)
    const presenterPeer = createParticipant(presenterSocketId.value, false, () => {}, () => close())

    presenterPeer.on('stream', s => {
      stream.value = s
      options?.onStream?.(s)
    })

    options?.onConnected?.()
    resolve()
  }))

  return reactive({
    presenterSocketId: computed(() => presenterSocketId.value),
    participants,
    sendRemote,
    leave
  })
}