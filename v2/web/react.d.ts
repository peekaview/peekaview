import type { CSSProperties, ReactElement } from 'react'
import type { ViewerOptions } from './index'

export { peerColor } from './index'

export interface PeekaViewerProps extends ViewerOptions {
  className?: string
  style?: CSSProperties
}

/** Embeds the PeekaView viewer. Changing room/name/color/relays reconnects. */
export function PeekaViewer(props: PeekaViewerProps): ReactElement
