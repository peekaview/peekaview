import i18n from "./i18n"

export type ApiRequestParams = {
  action: "showMeYourScreen"
  email: string
  name: string
  request_id: string
  init: '1' | '0'
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
  const response = await fetch(`${import.meta.env.VITE_API_URL}?${new URLSearchParams({
    lang: i18n.global.locale.value,
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