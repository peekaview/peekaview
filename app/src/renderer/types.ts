import { ScreenPeerData } from "src/composables/useScreenPeer"
import { TurnCredentials } from "src/interface"

export type AcceptedRequestData = {
  videoServer: string
  controlServer: string
  roomId: string
  turnCredentials: TurnCredentials
}

export type ScreenShareData = ScreenPeerData & {
  userName: string
  roomName: string
  serverUrl: string
  controlServer: string
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
