import {
  computed,
  ComputedRef,
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
  inApp?: boolean
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
}

interface ScreenViewOptions {
  turnCredentials?: TurnCredentials
  videoElement?: HTMLVideoElement
  role?: PeerRole
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
  onEnding?: () => void
}

interface ScreenPeerOptions {
  wrtc?: SimplePeer.Options["wrtc"]
  stream?: Ref<MediaStream | undefined>
  roleHandlers?: Partial<Record<PeerRole, (socketId: string) => void>>
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
}

export type ScreenPresent = Reactive<ScreenBase & {
  addStream: (stream: MediaStream, shareAudio: boolean) => Promise<void>
  leave: () => void
}>

export type ScreenView = Reactive<ScreenBase & {
  presenterSocketId: Ref<string | undefined>
  leave: () => void
}>

interface ScreenPeer extends ScreenBase {
  socket: Socket
  participants: ComputedRef<Record<string, ScreenParticipant>>
  initPeer: (socketId: string, initiator: boolean) => SimplePeer.Instance
  createParticipant: (socketId: string, initiator: boolean, onConnect?: () => void, onLeave?: () => void) => SimplePeer.Instance
  send: (data: any, socketId?: string) => void
  dismiss: (socketId: string) => void
}

interface ScreenBase {
  users: ComputedRef<UserData[]>
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>, socketId?: string) => void
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

const rtcIceServer = JSON.parse(import.meta.env.VITE_RTC_ICE_SERVER) as RTCIceServer

export async function useScreenPeer({ user, roomId, turnCredentials }: ScreenPeerData, role: PeerRole, options?: ScreenPeerOptions): Promise<ScreenPeer> {
  const socket = io(import.meta.env.VITE_RTC_CONTROL_SERVER)
  const participants = ref<Record<string, ScreenParticipant>>({})
  const users = computed(() => Object.values(participants.value).map(p => p.user))

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

  const send = (data: any, socketId?: string) => {
    const sendTo = !socketId ? participants.value : participants.value[socketId] ? { [socketId]: participants.value[socketId] } : {}
    for (const socketId in sendTo)
      sendTo[socketId].peer.send(JSON.stringify(data))
  }

  const sendRemote = <T extends RemoteEvent>(event: T, data: RemoteData<T>, socketId?: string) => {
    send({ type: 'remote', event, data }, socketId)
  }

  const dismiss = (socketId: string) => {
    participants.value[socketId]?.peer.destroy()
    delete participants.value[socketId]
  }

  return {
    socket,
    participants: computed(() => participants.value),
    users,
    initPeer,
    createParticipant,
    send,
    sendRemote,
    dismiss
  }
}

export async function useScreenPresent(screenShareData: ScreenShareData, options?: ScreenPresentOptions): Promise<ScreenPresent> {
  const stream = shallowRef<MediaStream>()
  const { participants, users, createParticipant, sendRemote, dismiss } = await useScreenPeer(screenShareData, 'presenter', {
    onRemote: options?.onRemote,
    stream,
    roleHandlers: {
      viewer: (socketId) => {
        createParticipant(socketId, true, () => !options?.inApp && sendRemote("browser", {}, socketId), () => dismiss(socketId))
      }
    },
  })

  const addStream = async (s: MediaStream, _shareAudio = false) => {
    s.getVideoTracks().forEach(track => {
      const constraints = {
        width: { max: 2560 },
        height: { max: 1440 },
        frameRate: { max: 15 },
      };
      track.applyConstraints(constraints);
    });
    
    stream.value = s;
    for (const socketId in participants.value)
      participants.value[socketId].peer.addStream(stream.value);
  }

  const leave = () => {
    for (const socketId in participants.value) {
      if (stream.value)
        participants.value[socketId].peer.removeStream(stream.value)

      try { 
        participants.value[socketId].peer.send(JSON.stringify({ type: 'leave' }))
      } catch (err) {
        console.error('Error sending close signal:', err)
      }
      dismiss(socketId)
    }

    stream.value = undefined
  }

  return reactive({
    users,
    addStream,
    sendRemote,
    leave
  })
}

export async function useScreenView(screenShareData: ScreenShareData, options?: ScreenViewOptions): Promise<ScreenView> {
  const stream = shallowRef<MediaStream>()
  const presenterSocketId = ref<string | undefined>()
  const { socket, participants, users, createParticipant, sendRemote, dismiss } = await useScreenPeer(screenShareData, options?.role ?? 'viewer', {
    onRemote: options?.onRemote,
    roleHandlers: {
      viewer: (socketId) => {
        createParticipant(socketId, true, () => {}, () => dismiss(socketId))
      }
    },
  })

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

  const leave = () => {
    for (const socketId in participants.value) {
      try { 
        participants.value[socketId].peer.send(JSON.stringify({ type: 'leave' }))
      } catch (err) {
        console.error('Error sending close signal:', err)
      }
    }

    close()
  }

  const close = () => {
    for (const socketId in participants.value)
      dismiss(socketId)

    stream.value = undefined
    options?.onEnding?.()
  }

  socket.on('presenterLeft', () => close())

  await new Promise<void>((resolve) => socket.on('presenterId', async (socketId: string) => {
    if (presenterSocketId.value)
      return

    presenterSocketId.value = socketId
    const presenterPeer = createParticipant(presenterSocketId.value, false, () => {}, () => close())

    presenterPeer.on('stream', s => {
      stream.value = s
    })

    resolve()
  }))

  return reactive({
    presenterSocketId: computed(() => presenterSocketId.value),
    users,
    sendRemote,
    leave
  })
}