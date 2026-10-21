// React wrapper:  <PeekaViewer room={roomSecret} name={me.name} color={me.color} />
import { createElement, useEffect, useRef } from 'react'
import { mountViewer } from './viewer.js'

export { peerColor } from './icons.js'

export function PeekaViewer({ room, name, color, relays, toolbar = true, peers = false, voice = true, onStatus, onPeers, className, style }) {
  const ref = useRef(null)
  // callbacks may change identity on every render without reconnecting
  const latest = useRef({ onStatus, onPeers })
  latest.current = { onStatus, onPeers }
  const relayKey = (relays ?? []).join(',')

  useEffect(() => {
    const viewer = mountViewer(ref.current, {
      room,
      name,
      color,
      relays,
      toolbar,
      peers,
      voice,
      onStatus: (s) => latest.current.onStatus?.(s),
      onPeers: (l) => latest.current.onPeers?.(l),
    })
    return () => viewer.destroy()
  }, [room, name, color, relayKey, toolbar, peers, voice])

  return createElement('div', { ref, className, style: { width: '100%', height: '100%', ...style } })
}
