<script setup lang="ts">
import { ref, computed, onMounted, reactive } from "vue"
import { Participant, RoomEvent, Track, type Room } from "livekit-client"

import { joinRoom, publishTrack } from "../screenShare"
import type { ScreenShareData } from "../types";

type Screen = {
  participant: Participant
  track: Track
}

const props = defineProps<ScreenShareData>()

const sharingRoom = ref<Room>()

const remoteScreens = reactive<Record<string, Screen>>({})
const localScreen = ref<Screen>()
const allScreens = computed(() => [...(localScreen.value ? [localScreen.value] : []), ...Object.values(remoteScreens)])
const focusedScreenId = ref<string>()

onMounted(async () => {
  try {
    const room = await joinRoom(props.serverUrl, props.jwtToken)
    sharingRoom.value = room

    console.log(sharingRoom.value)
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      console.debug("TrackSubscribed", track, participant)
      remoteScreens[track.sid!] = { track, participant }
      focusedScreenId.value = track.sid
    })
  
    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (track.kind === "video") {
        delete remoteScreens[track.sid!]
        if (focusedScreenId.value === track.sid)
          focusedScreenId.value = localScreen.value?.track.sid
      }
    })

    // Handle local participant's published tracks
    room.localParticipant.on(RoomEvent.LocalTrackPublished, (publication) => {
      console.debug("Local track published", publication)
      const track = publication.track
      if (track) {
        localScreen.value = { track, participant: room.localParticipant }
        focusedScreenId.value = track.sid
        
        if (!focusedScreenId.value)
          focusedScreenId.value = localScreen.value?.track.sid
      }
    })

    // Also subscribe to tracks published before participant joined
    room.remoteParticipants.forEach((participant) => {
      console.debug("Subscribing to existing tracks for:", participant)
      participant.trackPublications.forEach((publication) => {
        publication.setSubscribed(true)
        const track = publication.track
        if (track) {
          remoteScreens[track.sid!] = { track, participant }
          focusedScreenId.value = track.sid
        }
      })
    })
    
    handleScreenSharing(room)
  } catch (error) {
    console.error("There was an error connecting to the room:", error.message)
  }
})

async function handleScreenSharing(room: Room, sourceId?: string, shareAudio = false) {
  console.log("handleScreenSharing")
  try {
    const screenTrack = await publishTrack(room, sourceId, shareAudio)
    console.debug('Screen track published:', screenTrack)

    // The local track will be added to the thumbnail bar via the TrackPublished event
  } catch (error) {
    console.error('Error publishing screen track:', error)
  }
}
</script>

<template>
  <div id="room">
    <div id="room-header">
      <h2 id="room-title">{{ roomName }}</h2>
    </div>
    <div id="room-content">
      <div id="thumbnail-bar">
        <template v-for="screen in allScreens">
          <div :id="`thumb-${screen.track.sid!}`" class="thumbnail" :class="{ focused: screen.track.sid === focusedScreenId }" @click="focusedScreenId = screen.track.sid">
            <div class="participant-name">
              <Track :track="screen.track" muted plays-inline />
              <p>{{ screen.participant.identity + (screen === localScreen ? " (You)" : "") }}</p>
            </div>
          </div>
        </template>
      </div>
      <div id="layout-container">
        <template v-for="screen in allScreens">
          <div v-show="screen.track.sid === focusedScreenId" :id="`camera-${screen.track.sid!}`" class="video-container">
            <div class="participant-data">
              <p>{{ screen.participant.identity + (screen === localScreen ? " (You)" : "") }}</p>
              <Track :track="screen.track" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>