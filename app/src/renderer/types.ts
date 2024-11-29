import { Reactive, Ref } from "vue"

export type AcceptedRequestData = {
  jwt: string
  videoServer: string
  controlServer: string
  roomId: string
}

export type ScreenShareData = {
  userName?: string
  roomName: string
  roomId: string
  jwtToken: string
  serverUrl: string
  controlServer?: string
}

export type ScreenPresent = Reactive<{
  participants: Ref<Record<string, ViewingParticipant>>
  addStream: (stream: MediaStream, shareAudio: boolean) => Promise<void>
}>

export type ScreenView = Reactive<{
  sharingParticipant: Ref<SharingParticipant | undefined>
  trackElement: Ref<HTMLMediaElement | undefined>
}>

export type ViewingParticipant = {
  name: string | undefined
}

export type SharingParticipant = {
  name: string | undefined
}