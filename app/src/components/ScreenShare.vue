<script setup lang="ts">
import { ref, computed, onMounted, reactive, onBeforeUnmount } from "vue"
import { Participant, RoomEvent, Track, type Room } from "livekit-client"
import { useI18n } from 'vue-i18n'

import TrackContainer from "./TrackContainer.vue"
import { joinRoom, publishTrack } from "../screenShare"

import type { ScreenShareData } from "../types"

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

const { t } = useI18n()

window.electronAPI?.onSendScreenSourceId((id) => {
  sharingRoom.value && shareLocalScreen(sharingRoom.value, id)
})

// Handle window closing
window.onbeforeunload = async (e: BeforeUnloadEvent) => {
  e.preventDefault() // Prevents immediate window closing
  e.returnValue = '' // Required for some browsers

  await sharingRoom.value?.disconnect()
  await window.electronAPI?.handleAppClosing()
}

onMounted(async () => {
  try {
    const room = await joinRoom(props.serverUrl, props.jwtToken)
    sharingRoom.value = room

    room.on(RoomEvent.Disconnected, () => {
      console.log("room was disconnected")
    })

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

    if (props.isSharer)
      shareLocalScreen(sharingRoom.value)
  } catch (error) {
    console.error("There was an error connecting to the room:", error.message)
  }
})

onBeforeUnmount(() => sharingRoom.value?.disconnect())

async function shareLocalScreen(room: Room, sourceId?: string, shareAudio = false) {
  console.log("shareLocalScreen")
  try {
    const screenTrack = await publishTrack(room, sourceId, shareAudio)
    console.debug('Screen track published:', screenTrack)

    // The local track will be added to the thumbnail bar via the TrackPublished event
  } catch (error) {
    console.error('Error publishing screen track:', error)
  }
}

const getParticipantName = (participant: Participant, isLocal: boolean) => {
  return participant.identity + (isLocal ? ` (${t('screenShare.localParticipant')})` : '')
}
</script>

<template>
  <div id="room">
    <div id="room-header">
      <h2 id="room-title">{{ t('screenShare.title') }}</h2>
    </div>
    <div id="room-content">
      <div id="thumbnail-bar">
        <div v-if="sharingRoom && !localScreen">
          <button class="btn btn-primary w-100" @click="shareLocalScreen(sharingRoom)">
            {{ t('screenShare.shareButton') }}
          </button>
        </div>
        <template v-for="screen in allScreens">
          <div 
            :id="`thumb-${screen.track.sid!}`" 
            class="thumbnail" 
            :class="{ focused: screen.track.sid === focusedScreenId }" 
            @click="focusedScreenId = screen.track.sid"
          >
            <div class="participant-name">
              <TrackContainer :track="screen.track" muted plays-inline />
              <p>{{ getParticipantName(screen.participant, screen === localScreen) }}</p>
            </div>
          </div>
        </template>
      </div>
      <div id="layout-container">
        <template v-for="screen in allScreens">
          <div 
            v-show="screen.track.sid === focusedScreenId" 
            :id="`camera-${screen.track.sid!}`" 
            class="video-container"
          >
            <div class="participant-data">
              <p>{{ getParticipantName(screen.participant, screen === localScreen) }}</p>
              <TrackContainer :track="screen.track" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style>
#room {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

#room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 1000px;
  padding: 0 20px;
  margin-bottom: 20px;
}

#room-title {
  font-size: 2em;
  font-weight: bold;
  margin: 0;
}

#layout-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 10px;
  justify-content: center;
  align-items: center;
  width: 100%;
  max-width: 1000px;
  height: 100%;
}

.video-container {
  position: relative;
  background: #3b3b3b;
  aspect-ratio: 16/9;
  border-radius: 6px;
  overflow: hidden;
}

.video-container video {
  width: 100%;
  height: 100%;
}

.video-container .participant-data {
  position: absolute;
  top: 0;
  left: 0;
}

.participant-data p {
  background: #f8f8f8;
  margin: 0;
  padding: 0 5px;
  color: #777777;
  font-weight: bold;
  border-bottom-right-radius: 4px;
}

#room-content {
  display: flex;
  width: 100%;
  height: calc(100vh - 100px); /* Adjust based on your header and footer heights */
}

#thumbnail-bar {
  width: 200px;
  height: 100%;
  overflow-y: auto;
  background-color: #f0f0f0;
  padding: 10px;
}

#layout-container {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 10px;
  justify-content: center;
  align-items: center;
  height: 100%;
  overflow-y: auto;
}

.thumbnail {
  width: 100%;
  margin-bottom: 10px;
  background-color: #fff;
  border: 2px solid transparent;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
  cursor: pointer;
}

.thumbnail.focused {
  border-color: blue;
}

.thumbnail video {
  width: 100%;
  aspect-ratio: 16/9;
  object-fit: cover;
}

.thumbnail .participant-name {
  padding: 5px;
  text-align: center;
  font-weight: bold;
  background-color: #f8f8f8;
  border-top: 1px solid #e0e0e0;
}

@media screen and (max-width: 768px) {
  #layout-container {
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  }
}
</style>