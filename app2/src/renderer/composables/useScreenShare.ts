import { onBeforeUnmount, reactive, ref, markRaw } from "vue"
import { RoomEvent, Participant, Track } from "livekit-client"

import { joinRoom } from "../screenShare"
import { ScreenShareData } from "../types"

export type Screen = {
  participant: Participant
  track: Track
}

export type ScreenShare = ReturnType<typeof useScreenShare>
export type ScreenView = ReturnType<typeof useScreenView>

export async function useScreenShare({ serverUrl, jwtToken }: ScreenShareData) {
  try {
    const room = await joinRoom(serverUrl, jwtToken)
    const participants = ref(new Map<string, Participant>())
  
    onBeforeUnmount(() => room?.disconnect())

    room.remoteParticipants.forEach((participant, key) => {
      if (participant.trackPublications.size === 0)
        participants.value.set(key, participant)
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("Participant connected", participant.identity)
      participants.value.set(participant.identity, participant)
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log("Participant disconnected", participant.identity)
      participants.value.delete(participant.identity)
    })

    return reactive({ room: markRaw(room), participants })
  } catch (error) {
    console.error("There was an error connecting to the room:", error.message)
    throw error
  }
}

export async function useScreenView(data: ScreenShareData, onLeave?: () => void) {
  const { room, participants } = await useScreenShare(data)
  const screen = ref<Screen>()
  const sharingParticipant = ref<Participant>()

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

  console.log("screenview", { room, participants, screen, sharingParticipant })

  return reactive({ room: markRaw(room), participants, screen, sharingParticipant })
}