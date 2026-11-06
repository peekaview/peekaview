// "Bildschirmfreigabe light": the window "Freigabe läuft" as a Picture-in-Picture document window
// (Chrome, Edge) – it floats above every other app, which a normal browser window cannot (macOS
// never lets a program in the background bring its windows to the front). The share page moves
// its own controls into it. Browsers without it use a popup instead (share.html?panel).
//
// Limits: it opens only in a click, grows or shrinks only in a click in it, and never moves (opened
// anew, it goes back to the browser's corner); it closes with the tab that opened it.

// (Chrome, Edge only: Firefox has begun to offer it, as a second window beside the small one –
// there everything stays in the one small window)
export const documentPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window && !/Firefox\//.test(navigator.userAgent)

/**
 * Opens it (right in a click), with this page's styles. initial: at the browser's own place for it
 * (its corner), not where the last one was left – it cannot be moved otherwise.
 */
export async function openPip(size, { initial = false } = {}) {
  const win = await window.documentPictureInPicture.requestWindow({ ...size, preferInitialWindowPlacement: initial })
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) win.document.head.append(node.cloneNode(true))
  win.document.title = 'Freigabe läuft – PeekaView'
  return win
}

/** Larger or smaller (only in a click in it; the browser keeps it within its own limits). */
export function resizePip(win, size) {
  const width = Math.min(size.width, win.screen.availWidth)
  const height = Math.min(size.height, win.screen.availHeight)
  try {
    win.resizeTo(width + win.outerWidth - win.innerWidth, height + win.outerHeight - win.innerHeight)
  } catch {}
}
