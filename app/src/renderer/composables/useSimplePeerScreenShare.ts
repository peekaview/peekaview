import {
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue"

import SimplePeer from 'simple-peer'
import { io, type Socket } from "socket.io-client"

import { ScreenPresent, ScreenShareData, ScreenView, SharingParticipant, ViewingParticipant } from "../types"

interface ScreenPeer {
  socket: Socket
  initPeer: (socketId: string, initiator: boolean, stream?: MediaStream) => SimplePeer.Instance
}

interface ScreenViewOptions {
  videoElement?: HTMLVideoElement
  onRemote?: () => void
  onEnding?: () => void
}

async function useScreenPeer({ roomName }: ScreenShareData, isPresenter: boolean): Promise<ScreenPeer> {
  const socket = io("wss://c1.peekaview.de")
  
  const initPeer = (socketId: string, initiator: boolean, stream?: MediaStream) => {
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          /*{
            urls: 'turn:turn.speed.cloudflare.com:50000',
            username: '03f2f3316d7c596c2674ab7af813864819b23b401772cb58f490a307141657f1fd9bbe2abd8553936072e921fcd30f7269f731501de30ceb85163f9757b9620a',
            credential: 'aba9b169546eb6dcc7bfb1cdf34544cf95b5161d602e3b5fa7c8342b2e9802fb'
          }*/
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
      socket.emit('join', { roomId: roomName, isPresenter })

      resolve({ socket, initPeer })
    })
  )
}

export async function useScreenPresent(screenShareData: ScreenShareData, remote: boolean): Promise<ScreenPresent> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, true)
  const participants = ref<Record<string, ViewingParticipant>>({})
  const peers: Record<string, SimplePeer.Instance> = {}
  let stream: MediaStream | undefined

  socket.on('initReceive', (socketId) => {
    peers[socketId] = initPeer(socketId, true, stream)

    peers[socketId].on('connect', () => 
      peers[socketId].send(JSON.stringify({ type: 'identity', name: screenShareData.userName, remote }))
    )
    
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

  return reactive({ participants, addStream, leave })
}

export async function useScreenView(screenShareData: ScreenShareData, options?: ScreenViewOptions): Promise<ScreenView> {
  const { socket, initPeer } = await useScreenPeer(screenShareData, false)
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
        const data = JSON.parse(json)
        switch (data.type) {
          case 'remote':
            break
          case 'identity':
            sharingParticipant.value = { name: data.name }
            if (data.remote)
              options?.onRemote?.()
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

      resolve(reactive({ sharingParticipant, leave }))
    })
  })
}
