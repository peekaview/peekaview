export type ViewerStatus = 'connecting' | 'waiting' | 'loading' | 'live' | 'paused' | 'blocked' | 'error'

export interface Peer {
  id: number
  name: string
  color: string
  /** the participant who is sharing */
  host?: boolean
}

export interface ViewerOptions {
  /**
   * The "#…" part of the share link: "secret.presenterKey" (or just the room secret, e.g. handed
   * over by an integration). The secret addresses the room and end-to-end encrypts the connection
   * setup; the presenter key pins who may act as presenter.
   */
  room: string
  /** label shown next to this participant's cursor */
  name: string
  /** cursor / ink color as "#rrggbb" (default: assigned by the presenter) */
  color?: string
  /** Nostr relays for the connection setup (default: a few public relays) */
  relays?: string[]
  /** show the tool bar (default true) */
  toolbar?: boolean
  /** offer the built-in voice chat (default true; switch off when the host app has its own audio) */
  voice?: boolean
  /** list participants in the tool bar (default true) */
  peers?: boolean
  onStatus?: (status: ViewerStatus) => void
  onPeers?: (peers: Peer[]) => void
}

export interface Viewer {
  setTool(tool: 'point' | 'draw' | 'control'): void
  /** remove this participant's drawings */
  clear(): void
  destroy(): void
}

export function mountViewer(element: HTMLElement, options: ViewerOptions): Viewer

/** Deterministic participant color for an id (e.g. a session id), from the PeekaView palette. */
export function peerColor(seed: string): string
