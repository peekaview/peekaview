import { NotificationPayload } from "src/interface"
import i18n from "./i18n"
import { EitherEmailOrCodeOrUuid } from "./types"
import { notify } from "./util"

export type ShowMeYourScreenParams = {
  action: "showMeYourScreen"
  name: string
  requestId: string
  init: '1' | '0'
} & EitherEmailOrCodeOrUuid

export type ApiRequestParams = ShowMeYourScreenParams | {
  action: "doesAnyoneWantToSeeMyScreen" | "createScreenShareRoom"
  email: string
  token: string
} | {
  action: "iAmOnline"
  email: string
  token: string
  inviteCode: string
} | {
  action: "youAreAllowedToSeeMyScreen" | "youAreNotAllowedToSeeMyScreen"
  email: string
  token: string
  requestId: string
} | {
  action: "registerMyEmail"
  email: string
  uuid: string
  target: 'web' | 'app'
} | {
  action: "registerPushToken"
  uuid: string
  token: string
} | {
  action: "sendPushNotification"
  email: string
  token: string
  uuid: string
  notification: JsonString<NotificationPayload>
} | {
  action: "useInviteCode"
  code: string
}

export async function callApi<TResponse = void>(params: ApiRequestParams) {
  const filteredParams = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined))
  const response = await fetch(`${import.meta.env.VITE_API_URL}?${new URLSearchParams({
    lang: i18n.global.locale.value,
    ...filteredParams,
  }).toString()}`)
  if (response.status === 401)
    throw new UnauthorizedError(response.statusText)

  let responseBody: TResponse
  try {
    responseBody = await response.json() as TResponse
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

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
  }
}