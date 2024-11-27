import {
  onBeforeUnmount,
  reactive,
  ref,
} from "vue"

import SimplePeer from 'simple-peer'

import { ScreenShare, ScreenShareData, ScreenView, SharingParticipant, ViewingParticipant } from "../types"

async function usePeer({ serverUrl, roomName }: ScreenShareData, isPresenter: boolean) {
  const ws = new WebSocket(serverUrl)
  const participants = ref<Record<string, ViewingParticipant>>({})

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join',
      room: roomName,
      isPresenter
    }))
  }

  const peer = new SimplePeer({
    initiator: isPresenter,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    }
  })

  peer.on('signal', data => {
    ws.send(JSON.stringify({
      type: 'signal',
      room: roomName,
      data
    }));
  });
  
  onBeforeUnmount(() => peer.destroy())

  ws.onmessage = async (message) => {
    const data = JSON.parse(message.data)
    switch (data.type) {
      case 'signal': {
        peer.signal(data.data)
        break
      }
      case 'end': {
        // TODO
        break
      }
    }
  }

  return { peer, participants }
}

export async function useScreenShare(data: ScreenShareData): Promise<ScreenShare> {
  const { peer, participants } = await usePeer(data, true)

  const addStream = async (stream: MediaStream, _shareAudio = false) => peer.addStream(stream)

  return reactive({ participants, addStream })
}

export async function useScreenView(data: ScreenShareData, onLeave?: () => void): Promise<ScreenView> {
  const { peer, participants } = await usePeer(data, false)
  const sharingParticipant = ref<SharingParticipant>()
  let stream: MediaStream

  peer.on('stream', s => stream = s)

  peer.on('close', () => { // TODO: check if this is correct
    onLeave?.()
  })

  const getTrackElement = () => {
    if (!stream)
      return undefined
    
    const trackElement = document.createElement('video')
    trackElement.srcObject = stream
    return trackElement
  }

  return reactive({ participants, sharingParticipant, getTrackElement })
}