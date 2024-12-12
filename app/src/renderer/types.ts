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