import { useI18n } from "vue-i18n"
    
declare const API_URL: string

export type ApiRequestParams = {
  action: "showMeYourScreen"
  email: string;
  name: string;
  request_id: string;
} | {
  action: "doesAnyoneWantToSeeMyScreen" | "createScreenShareRoom"
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
}

export async function callApi<TResponse = void>(params: ApiRequestParams) {
  const i18nLocale = useI18n()
  const response = await fetch(`${API_URL}?${new URLSearchParams({
    lang: i18nLocale.locale.value,
    ...params,
  }).toString()}`)
  if (response.status === 401)
    throw new UnauthorizedError(`${response.status} ${response.statusText}`)

  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`)

  return (await response.json()) as TResponse
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
  }
}