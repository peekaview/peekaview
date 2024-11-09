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
  action: "register"
  email: string
}

export async function callApi<TResponse = void>(params: ApiRequestParams) {
  const response = await fetch(`${API_URL}?${new URLSearchParams(params).toString()}`)
  return (await response.json()) as TResponse
}