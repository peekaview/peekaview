import { Reactive, Ref } from "vue"

export type AcceptedRequestData = {
  jwt: string
  videoServer: string
  controlServer: string
  roomId: string
}

export type ScreenShareData = {
  roomName: string
  jwtToken: string
  serverUrl: string
}

export type ScreenShare = Reactive<{
  participants: Ref<Record<string, ViewingParticipant>>
  addStream: (stream: MediaStream, shareAudio: boolean) => Promise<void>
}>

export type ScreenView = Reactive<{
  participants: Ref<Record<string, ViewingParticipant>>
  sharingParticipant: Ref<SharingParticipant | undefined>
  getTrackElement: () => HTMLMediaElement | undefined
}>

export type ViewingParticipant = {
  name: string | undefined
}

export type SharingParticipant = {
  name: string | undefined
}