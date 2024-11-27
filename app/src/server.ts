import WebSocket from 'ws'

type Client = {
  ws: WebSocket
  isPresenter: boolean
}

const wss = new WebSocket.Server({ port: 8080 })
const rooms: Record<string, Client[]> = {}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const data = JSON.parse(message.toString())
    const room = data.room

    if (!rooms[room])
      rooms[room] = []

    switch (data.type) {
      case 'join': {
        const client = { ws, isPresenter: data.isPresenter }
        rooms[room].push(client)
  
        if (client.isPresenter)
          break

        rooms[room].forEach(client => {
          if (client.isPresenter)
            client.ws.send(JSON.stringify({ type: 'joined' }))
        })
        break
      }
      case 'signal': {
        for (const client of rooms[room]) {
          if (client.ws === ws)
            continue

          client.ws.send(JSON.stringify({
            type: 'signal',
            data: data.data,
            isPresenter: client.isPresenter
          }))
        }
        break
      }
    }
  })

  ws.on('close', () => {
    for (const room in rooms) {
      const index = rooms[room].findIndex(c => c.ws === ws)
      const client = rooms[room].splice(index, 1)[0] ?? undefined
      if (!client)
          continue

      if (client.isPresenter) {
        for (const c of rooms[room])
          c.ws.send(JSON.stringify({
            type: 'end',
            isPresenter: true
          }))
      }

      if (rooms[room].length === 0)
        delete rooms[room]
    }
  })
})