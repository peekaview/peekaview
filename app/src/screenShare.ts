import { Room, Track, TrackPublishOptions, LocalTrackPublication, RoomEvent, VideoPresets } from 'livekit-client'

export async function publishTrack(room: Room, sourceId?: string, shareAudio = false) {
  console.debug('Starting publishTrack with sourceId:', sourceId)
  let screenStream: MediaStream

  if (window.electronAPI) {
    console.log('Electron environment detected')
    // Electron environment
    if (!sourceId) {
      console.log('No sourceId provided, opening screen source selection')
      await window.electronAPI.openScreenSourceSelection()
      return
    }

    console.debug('Selected sourceId:', sourceId)
    console.log('Attempting to get user media in Electron')
    screenStream = await navigator.mediaDevices.getUserMedia({
      ...(shareAudio ? {
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        }
      }
      : {}),
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080
        }
      }
    })
    console.log('Successfully obtained screen stream in Electron')
  } else {
    console.log('Browser environment detected')
    // Browser environment
    console.log('Attempting to get display media in browser')
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: shareAudio
    })
    console.log('Successfully obtained screen stream in browser')
  }

  const screenTrack = screenStream.getVideoTracks()[0]

  console.debug('Screen track obtained:', screenTrack.label)

  // Log connection state changes
  room.on(RoomEvent.ConnectionStateChanged, (state: any) => {
    console.debug('Room connection state changed:', state)
  })

  // Publish the video track to LiveKit
  console.log('Attempting to publish video track')
  const publishOptions: TrackPublishOptions = {
    //videoCodec: 'h264',
    //simulcast: false,
    source: Track.Source.ScreenShare,
    videoEncoding: {
      maxBitrate: 1500000,
      maxFramerate: 30
    }
  }

  const videoPublication = await room.localParticipant.publishTrack(screenTrack, publishOptions)
  console.log('Video track published successfully', videoPublication)

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
    const audioTrack = screenStream.getAudioTracks()[0]
    if (audioTrack) {
      console.debug('Audio track obtained:', audioTrack.label)
      // Publish the audio track to LiveKit if it exists

      console.log('Attempting to publish audio track')
      try {
        const audioPublication = await room.localParticipant.publishTrack(audioTrack, {
          name: 'screen_audio',
          source: Track.Source.ScreenShareAudio,
        })
        console.debug('Audio track published successfully', audioPublication)
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

  return screenTrack
}

export async function joinRoom(url: string, jwtToken: string) {
  // Initialize a new Room object
  // this is for webcam video
  /*const newRoom = new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h216],
    },
  })*/

  console.log("joinRoom")
  // this is for screen-sharing
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h216],
    },
  })

  try {
    console.log("joinRoom connect", url, jwtToken)
    if (!url.startsWith("http"))
      url = "https://" + url
    
    // Connect to the room with the LiveKit URL and the token
    await room.connect(url, jwtToken)

    room.on(RoomEvent.Disconnected, (e) => {
      console.log("Room was disconnected", e)
    })

    console.log("joinRoom return")
    return room
  } catch (error) {
    console.log("joinRoom error", error)
    await room?.disconnect()
    throw error
  }
}