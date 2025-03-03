import { RemoteData, RemoteEvent, SendRemoteOptions, SendRemote } from "src/interface"
import { Ref } from "vue"

type ReceiveEventHandlers = {
  [K in RemoteEvent]: (data: RemoteData<K>) => void
}

export type SendOptions = SendRemoteOptions & {
  receiveSelf?: boolean
}

type SendRemoteHost = Ref<{
  sendRemote?: SendRemote | undefined
} | undefined>

export function useRemoteHandlers(sendRemoteHost: SendRemoteHost) {
  const receiveEvents: Partial<ReceiveEventHandlers> = {}

  function send<T extends RemoteEvent>(event: T, data: RemoteData<T>, options: SendOptions = {}) {
    sendRemoteHost.value?.sendRemote?.(event, data)//, volatile: options.volatile ?? false)
    if (options.receiveSelf)
      receive(event, data)
  }

  function receive<T extends RemoteEvent>(event: T, data: RemoteData<T>) {
    receiveEvents[event]?.(data)
  }

  function onReceive<T extends RemoteEvent>(event: T, handler: (data: RemoteData<T>) => void) {
    receiveEvents[event] = handler as ReceiveEventHandlers[T]
  }

  return {
    send,
    receive,
    onReceive
  }
}