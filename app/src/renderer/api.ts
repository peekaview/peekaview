import { NotificationPayload } from "src/interface"
import i18n from "./i18n"
import { EitherEmailOrCodeOrUuid, RequestStatus, RequestUserStatus, RoomData } from "./types"
import { logout, notify } from "./util"

type AcceptedRequestData = RoomData & {
  inviteCode: string
  accessToken: string
}

type UnacceptedRequestResponse = {
  status: Exclude<RequestStatus, "request_accepted">
  user_status: RequestUserStatus
  last_seen: number
  videoServer: undefined
  controlServer: undefined
  roomId: undefined
}

type AcceptedRequestResponse = {
  status: "request_accepted"
  user_status: RequestUserStatus
  last_seen: number
} & AcceptedRequestData

export type ApiAction = "showMeYourScreen" | "doesAnyoneWantToSeeMyScreen" | "createScreenShareRoom" | "iAmOnline" | "handleIfAllowedToSeeMyScreen" | "registerMyEmail" | "generateLoginCode" | "login" | "registerPushToken" | "sendPushNotification" | "useInviteCode" | "wipeAllData"

export type ApiParams<T extends ApiAction> =
  T extends "showMeYourScreen" ? {
    name: string
    requestId: string
    init: '1' | '0'
  } & EitherEmailOrCodeOrUuid
  : T extends "doesAnyoneWantToSeeMyScreen" ? {
    email: string
    token: string
  }
  : T extends "createScreenShareRoom" ? {
    email: string
    token: string
  }
  : T extends "iAmOnline" ? {
    email: string
    token: string
    inviteCode: string
  }
  : T extends "handleIfAllowedToSeeMyScreen" ? {
    allowed: boolean
    email: string
    token: string
    requestId: string
  }
  : T extends "registerMyEmail" ? {
    email: string
    uuid: string
    target: 'web' | 'app'
  }
  : T extends "generateLoginCode" ? {
    email: string
    token: string
    target: 'web' | 'app'
  }
  : T extends "login" ? {
    code: string
  }
  : T extends "registerPushToken" ? {
    uuid: string
    token: string
  }
  : T extends "sendPushNotification" ? {
    email: string
    token: string
    uuid: string
    notification: JsonString<NotificationPayload>
  }
  : T extends "useInviteCode" ? {
    code: string
  }
  : T extends "wipeAllData" ? {}
  : never

export type ApiResponse<T extends ApiAction> =
  T extends "showMeYourScreen" ? UnacceptedRequestResponse | AcceptedRequestResponse
  : T extends "doesAnyoneWantToSeeMyScreen" ? {
    requestId: string
    accessToken?: string | undefined
    name: string
  }[]
  : T extends "createScreenShareRoom" ? AcceptedRequestData
  : T extends "iAmOnline" ? {}
  : T extends "handleIfAllowedToSeeMyScreen" ? {}
  : T extends "registerMyEmail" ? {
    success: boolean
    error?: string
  }
  : T extends "generateLoginCode" ? {
    code: string
  }
  : T extends "login" ? {
    email: string
    token: string
    target: 'web' | 'app'
  }
  : T extends "registerPushToken" ? {}
  : T extends "sendPushNotification" ? {}
  : T extends "useInviteCode" ? {
    email: string
    accessToken: string
  }
  : T extends "wipeAllData" ? {}
  : never

export async function callApi<TAction extends ApiAction>(action: TAction, params: ApiParams<TAction>) {
  const filteredParams = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined))
  const response = await fetch(`${import.meta.env.VITE_API_URL}?${new URLSearchParams({
    lang: i18n.global.locale.value,
    action,
    ...filteredParams,
  }).toString()}`)
  if (response.status === 401)
    throw new UnauthorizedError(response.statusText)

  let responseBody: ApiResponse<TAction>
  try {
    responseBody = await response.json() as ApiResponse<TAction>
  } catch (e) {
    notify({
      title: 'Server Error',
      text: response.statusText,
      confirmButtonText: 'OK',
      type: 'error',
    })
    throw new Error(`${response.status} ${response.statusText} ${e instanceof Error ? e.message : ''}`)
  }

  if (response.status === 500) {
    notify({
      title: 'Server Error',
      text: responseBody ? JSON.stringify(responseBody) : response.statusText,
      confirmButtonText: 'OK',
      type: 'error',
    })
  }

  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`)

  return responseBody
}

export function handleApiError(error: Error, requestData: any) {
  window.electronAPI?.log("presenter error", error, JSON.stringify(requestData))
  if (error instanceof UnauthorizedError) {
    logout()
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
  }
}