export type AcceptedRequestData = {
  videoServer: string
  controlServer: string
  roomId: string
  turnCredentials: TurnCredentials
}

export type ScreenShareData = {
  userName: string
  roomName: string
  roomId: string
  serverUrl: string
  controlServer: string
  turnCredentials: TurnCredentials
}

export type TurnCredentials = {
  urls?: string[]
  username: string
  credential: string
}

export type RemoteControlData = {
  roomid: string
  username: string
  userid: string
  color: string
  hostname: string
}

export type ScaleInfo = {
  height: number
  width: number
  scale: number
  x: number
  y: number
}

export type VideoTransform = {
  x: number
  y: number
  width: number
  height: number
  fullwidth: number
  fullheight: number
}
