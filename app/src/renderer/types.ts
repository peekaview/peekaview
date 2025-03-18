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

export type ViewerData = EitherEmailOrCode & {
  name: string
}

export type EitherEmailOrCode = {
  email: string
  code?: undefined
} | {
  email?: undefined
  code: string
}

export type ViewerDataSchema = {
  emailOrCode: string
  name: string
}