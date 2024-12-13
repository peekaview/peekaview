export type AcceptedRequestData = {
  videoServer: string
  controlServer: string
  roomId: string
  turnCredentials: TurnCredentials
}

export type ScreenShareData = {
  userName?: string
  roomName: string
  roomId: string
  serverUrl: string
  controlServer?: string
  turnCredentials?: TurnCredentials
}

export type TurnCredentials = {
  urls: string[]
  username: string
  credential: string
}