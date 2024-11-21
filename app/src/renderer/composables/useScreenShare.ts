import { onBeforeUnmount, reactive, ref, markRaw, type Raw, type Ref, type Reactive } from "vue"
import { RoomEvent, Participant, RemoteParticipant, Track, Room } from "livekit-client"

import { joinRoom } from "../screenShare"
import { ScreenShareData } from "../types"

export type Screen = {
  participant: Participant
  track: Track
}

export type ScreenShare = Reactive<{
  room: Raw<Room>
  participants: Ref<Record<string, RemoteParticipant>>
}>

export type ScreenView = Reactive<{
  room: Raw<Room>
  participants: Ref<Record<string, RemoteParticipant>>
  sharingParticipant: Ref<RemoteParticipant | undefined>
  screen: Ref<Screen | undefined>
}>

export async function useScreenShare({ serverUrl, jwtToken }: ScreenShareData): Promise<ScreenShare> {
  try {
    const room = await joinRoom(serverUrl, jwtToken)
    const participants = ref<Record<string, RemoteParticipant>>({})
  
    onBeforeUnmount(() => room?.disconnect())

    room.remoteParticipants.forEach((participant, key) => {
      if (participant.trackPublications.size === 0)
        participants.value[key] = participant
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("Participant connected", participant.identity)
      participants.value[participant.identity] = participant
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

export async function useScreenView(data: ScreenShareData, onLeave?: () => void): Promise<ScreenView> {
  const { room, participants } = await useScreenShare(data)
  const screen = ref<Screen>()
  const sharingParticipant = ref<RemoteParticipant>()

  room.remoteParticipants.forEach((participant) => {
    if (participant.trackPublications.size === 0)
      return

    console.log("Sharing participant:", participant.identity)
    sharingParticipant.value = participant
    participant.trackPublications.forEach((publication) => {
      publication.setSubscribed(true)
      const track = publication.track
      if (track) {
        screen.value = { track, participant }
      }
    })
  })

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant !== sharingParticipant.value)
      return

    console.log("Sharing participant disconnected, leaving room")
    onLeave?.()
  })

  room.on(RoomEvent.TrackUnsubscribed, () => {
    console.log("Sharing participant's track has ended, leaving room")
    onLeave?.()
  })

  return reactive({ room: markRaw(room), participants, screen, sharingParticipant })
}