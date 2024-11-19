export type AcceptedRequestData = {
  jwt: string
  videoServer: string
  controlServer: string
  roomId: string
}

export type ScreenShareData = {
  roomName: string
  jwtToken: string
  serverUrl: string
}

export type PromiseValue<T extends Promise<any>> = T extends Promise<infer U> ? U : never