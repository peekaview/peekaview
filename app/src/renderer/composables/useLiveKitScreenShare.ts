import {
  onBeforeUnmount,
  reactive,
  ref,
  markRaw,
  computed,
} from "vue"

import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  TrackPublishOptions,
  LocalTrackPublication,
} from "livekit-client"

import { ScreenPresent, ScreenShareData, ScreenView, SharingParticipant, ViewingParticipant } from "../types"

async function useRoomConnection({ serverUrl, jwtToken }: ScreenShareData) {
  try {
    const participants = ref<Record<string, ViewingParticipant>>({})

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h216, VideoPresets.h1080],
      },
    })

    if (!serverUrl.startsWith("http"))
      serverUrl = "https://" + serverUrl

    await room.connect(serverUrl, jwtToken)
  
    onBeforeUnmount(() => room?.disconnect())

    room.on(RoomEvent.Disconnected, (e) =>
      console.log("Room was disconnected", e)
    )

    room.remoteParticipants.forEach((participant, key) => {
      if (participant.trackPublications.size === 0)
        participants.value[key] = { name: participant.name }
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("Participant connected", participant.identity)
      participants.value[participant.identity] = { name: participant.name }
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log("Participant disconnected", participant.identity)
      delete participants.value[participant.identity]
    })

    return reactive({ room: markRaw(room), participants })
  } catch (error) {
    console.error("There was an error connecting to the room:", (error as Error).message)
    throw error
  }
}

export async function useScreenPresent(data: ScreenShareData): Promise<ScreenPresent> {
  const { room, participants } = await useRoomConnection(data)

  // Log connection state changes
  room.on(RoomEvent.ConnectionStateChanged, (state: any) => {
    console.debug('Room connection state changed:', state)
  })

  const addStream = (stream: MediaStream, shareAudio = false) => publishTrack(room, stream, shareAudio)

  return reactive({ participants, addStream })
}

export async function useScreenView(data: ScreenShareData, onEnding?: () => void): Promise<ScreenView> {
  const { room } = await useRoomConnection(data)
  const sharingParticipant = ref<SharingParticipant>()
  const track = ref<Track>()

  room.remoteParticipants.forEach((participant) => {
    if (participant.trackPublications.size === 0)
      return

    console.log("Sharing participant:", participant.identity)
    sharingParticipant.value = { name: participant.name }
    participant.trackPublications.forEach((publication) => {
      publication.setSubscribed(true)
      if (publication.track)
        track.value = publication.track
    })
  })

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant !== sharingParticipant.value)
      return

    console.log("Sharing participant disconnected, leaving room")
    onEnding?.()
  })

  room.on(RoomEvent.TrackUnsubscribed, () => {
    console.log("Sharing participant's track has ended, leaving room")
    onEnding?.()
  })

  const trackElement = computed(() => track.value?.attach())

  return reactive({ sharingParticipant, trackElement })
}

export async function publishTrack(room: Room, stream: MediaStream, shareAudio = false) {
  // Publish the video track to LiveKit
  console.log('Attempting to publish video track')
  const publishOptions: TrackPublishOptions = {
    //videoCodec: 'h264',
    //simulcast: false,
    source: Track.Source.ScreenShare,
    videoEncoding: {
      maxBitrate: 1500000,
      maxFramerate: 15,
    }
  }

  const screenTrack = stream.getVideoTracks()[0]
  const videoPublication = await room.localParticipant.publishTrack(screenTrack, publishOptions)
  console.log('Video track published successfully', screenTrack, videoPublication)

  // Monitor the publication state
  if (videoPublication instanceof LocalTrackPublication) {
    videoPublication.on('subscribed', () => {
      console.log('Video track subscribed')
    })
    videoPublication.on('unsubscribed', () => {
      console.log('Video track unsubscribed')
    })
  }

  if (shareAudio) {
    const audioTrack = stream.getAudioTracks()[0]
    if (audioTrack) {
      console.debug('Audio track obtained:', audioTrack.label)
      // Publish the audio track to LiveKit if it exists

      console.log('Attempting to publish audio track')
      try {
        const audioPublication = await room.localParticipant.publishTrack(audioTrack, {
          name: 'screen_audio',
          source: Track.Source.ScreenShareAudio,
        })
        console.debug('Audio track published successfully', audioTrack, audioPublication)
      } catch (audioError) {
        console.error('Error publishing audio track:', audioError)
        // Don't throw here, as video might still work without audio
      }
    } else {
      console.log('No audio track available')
    }
  }

  // Wait a bit to ensure the track is fully published
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Log the current state of the room
  console.debug('Current room state:', {
    room
  })
}