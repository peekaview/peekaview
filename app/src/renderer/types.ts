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

export type ViewerData = {
  name: string
} & ({
  email: string
  code?: undefined
} | {
  email?: undefined
  code: string
})
