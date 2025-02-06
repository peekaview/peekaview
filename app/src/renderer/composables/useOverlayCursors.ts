import { UserData } from "src/interface"
import { reactive, Ref } from "vue"

type Cursor = {
  name?: string
  color: string
  left: number
  top: number
  lastAction: number
}

export function useOverlayCursors(users: Ref<Record<string, UserData>>) {
  const cursors = reactive<Record<string, Cursor>>({})

  function move(userId: string, x: number, y: number) {
    const user = users.value[userId]
    if (!cursors[userId]) {
      cursors[userId] = {
        name: user.name,
        color: user.color,
        left: 0,
        top: 0,
        lastAction: 0
      }
    }

    cursors[userId].left = Math.round(x)
    cursors[userId].top = Math.round(y)
    cursors[userId].lastAction = Date.now()
  }

  function clear(instant = false) {
    for (const id in cursors) {
      if (instant || cursors[id].lastAction < (Date.now() - 10000))
        delete cursors[id]
    }
  }

  return {
    cursors,
    move,
    clear
  }
}