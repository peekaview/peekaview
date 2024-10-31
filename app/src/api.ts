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
  action: "youAreAllowedToSeeMyScreen"
  email: string
  token: string
  request_id: string
}

export async function callApi<TResponse = void>(params: ApiRequestParams) {
  const response = await fetch(`api.php?${new URLSearchParams(params).toString()}`)
  return (await response.json()) as TResponse
}