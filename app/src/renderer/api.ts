import i18n from "./i18n"
import { EitherEmailOrCode } from "./types"
import { notify } from "./util"

export type NotificationPayload = {
  title: string
  body: string
  icon?: string
  data?: {
    url?: string
    type?: 'share' | 'view'
    code?: string
  }
}

export type ShowMeYourScreenParams = {
  action: "showMeYourScreen"
  name: string
  request_id: string
  init: '1' | '0'
} & EitherEmailOrCode

export type ApiRequestParams = ShowMeYourScreenParams | {
  action: "iAmOnline" | "doesAnyoneWantToSeeMyScreen" | "createScreenShareRoom"
  email: string
  token: string
} | {
  action: "youAreAllowedToSeeMyScreen" | "youAreNotAllowedToSeeMyScreen"
  email: string
  token: string
  request_id: string
} | {
  action: "registerMyEmail"
  email: string
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
  action: "saveTempData"
  data: string
} | {
  action: "getTempData"
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

  if (response.status === 500)
    notify({
      title: 'Server Error',
      text: response.statusText,
      confirmButtonText: 'OK',
      type: 'error',
    })

  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`)

  return (await response.json()) as TResponse
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
  }
}