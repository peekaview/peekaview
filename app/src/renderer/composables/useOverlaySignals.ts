import { reactive, Ref } from 'vue'
import { UserData } from 'src/interface'

type Signal = {
  color: string
  left: number
  top: number
}

export function useOverlaySignals(users: Ref<Record<string, UserData>>) {
  const signals = reactive<Record<string, Signal>>({})

  function send(userId: string, x: number, y: number) {
    const user = users.value[userId]
    if (signals[user.id])
      return
  
    signals[user.id] = {
      color: user.color,
      left: Math.round(x),
      top: Math.round(y),
    }
  
    setTimeout(() => {
      if (signals[user.id])
        delete signals[user.id]
    }, 2000)
  }

  function clear() {
    for (const id in signals)
      delete signals[id]
  }

  return {
    signals,
    send,
    clear
  }
}