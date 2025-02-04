import { TurnCredentials, UserData } from "src/interface"

export type AcceptedRequestData = {
  videoServer: string
  controlServer: string
  roomId: string
  turnCredentials: TurnCredentials
}

export type RemoteControlData = {
  roomid: string
  user: UserData
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