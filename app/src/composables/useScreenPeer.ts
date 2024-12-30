import SimplePeer from 'simple-peer'
import { io, type Socket } from "socket.io-client"

import { TurnCredentials } from "../interface"

interface ScreenPeer {
  socket: Socket
  initPeer: (socketId: string, initiator: boolean, stream?: MediaStream) => SimplePeer.Instance
}

export type ScreenPeerData = {
  roomId: string
  turnCredentials: TurnCredentials
}

export type PeerRole = 'presenter' | 'viewer' | 'streamer'

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