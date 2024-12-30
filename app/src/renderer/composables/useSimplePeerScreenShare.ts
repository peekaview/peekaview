import {
  Reactive,
  reactive,
  Ref,
  ref,
  shallowRef,
  watch,
} from "vue"

import SimplePeer from 'simple-peer'

import { PeerRole, useScreenPeer } from "../../composables/useScreenPeer"

import { ScreenShareData } from "../types"
import { PeerData, RemoteData, RemoteEvent, TurnCredentials } from "src/interface"

interface ScreenPresentOptions {
  turnCredentials?: TurnCredentials
  remoteEnabled?: boolean
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
}

interface ScreenViewOptions {
  turnCredentials?: TurnCredentials
  videoElement?: HTMLVideoElement
  onRemote?: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
  onEnding?: () => void
}

export type ScreenPresent = Reactive<{
  participants: Ref<Record<string, ViewingParticipant>>
  addStream: (stream: MediaStream, shareAudio: boolean) => Promise<void>
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>, socketId?: string, exclude?: boolean) => void
  leave: () => void
}>

export type ScreenView = Reactive<{
  sharingParticipant: Ref<SharingParticipant | undefined>
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void
  leave: () => void
}>

export type ViewingParticipant = {
  name: string | undefined
}

export type SharingParticipant = {
  name: string | undefined
}

export async function useScreenPresent(screenShareData: ScreenShareData, options?: ScreenPresentOptions): Promise<ScreenPresent> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, 'presenter')
  const participants = ref<Record<string, ViewingParticipant>>({})
  const peers: Record<string, SimplePeer.Instance> = {}
  let streamerSocketId: string | undefined
  let stream: MediaStream | undefined

  socket.on('initReceive', ({ socketId, role }: { socketId: string, role: PeerRole }) => {
    switch (role) {
      case 'viewer':
        peers[socketId] = initPeer(socketId, true, stream)
    
        peers[socketId].on('connect', () => {
          peers[socketId].send(JSON.stringify({ type: 'identity', name: screenShareData.userName }))
          if (options?.remoteEnabled)
            sendRemote("enable", {}, socketId)
        })
        
        peers[socketId].on('data', (json) => {
          const data = JSON.parse(json) as PeerData
          console.log('peer on data', data)
          switch (data.type) {
            case 'remote':
              options?.onRemote?.(data.event, data.data)
              sendRemote(data.event, data.data, socketId, true)
              break
            case 'identity':
              participants.value[socketId] = { name: data.name }
              break
            case 'leave':
              close(socketId)
              break
          }
        })
        
        peers[socketId].on('close', () => close(socketId))
        break
      case 'streamer':
        streamerSocketId = socketId
        peers[streamerSocketId] = initPeer(socketId, true)
        peers[streamerSocketId].on('data', (json) => {
          const data = JSON.parse(json) as PeerData
          switch (data.type) {
            case 'remote':
              options?.onRemote?.(data.event, data.data)
              sendRemote(data.event, data.data, socketId, true)
              break
          }
        })
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
  const { socket, initPeer } = await useScreenPeer(screenShareData, 'viewer')
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
      if (sharingPeer)
        return

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
            options?.onRemote?.(data.event, data.data)
            break
          case 'identity':
            sharingParticipant.value = { name: data.name }
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
