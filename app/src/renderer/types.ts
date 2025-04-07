import { TurnCredentials, UserData } from "src/interface"

export type RoomData = {
  videoServer: string
  controlServer: string
  roomId: string
  turnCredentials: TurnCredentials
}

export type RequestStatus = "request_accepted" | "request_denied" | "request_notified" | "request_not_answered" | "request_open"
export type RequestUserStatus = "online" | "away" | "offline" | "unknown"

export type RemoteControlData = {
  roomid: string
  user: UserData
  hostname: string
}

export type ViewerData = EitherEmailOrCodeOrUuid & {
  name: string
}

export type EitherEmailOrCodeOrUuid = {
  email: string
  code?: undefined
  uuid?: undefined
} | {
  email?: undefined
  code: string
  uuid?: undefined
} | {
  email?: undefined
  code?: undefined
  uuid: string
}

export type ViewerDataSchema = {
  emailOrCode: string
  name: string
}