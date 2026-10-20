// PeekaView icon set – 24×24, 1.75px strokes, currentColor. Shared by viewer and desktop app.

const paths = {
  logo: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/><circle cx="13.2" cy="10.8" r=".6" fill="currentColor" stroke="none"/>',
  point: '<path d="M5 3.5 18.5 9l-5.6 2.1-2.1 5.6L5 3.5Z"/><path d="m13.2 13.2 5.3 5.3"/>',
  draw: '<path d="M15.2 4.8a2.1 2.1 0 0 1 3 3L8.5 17.5 4.5 18.5l1-4 9.7-9.7Z"/><path d="M13.5 6.5l3 3"/><path d="M14 19.5h6"/>',
  control: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v6.5"/><path d="M6.5 9.5h11"/>',
  view: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  erase: '<path d="m7.5 19.5-3.6-3.6a1.5 1.5 0 0 1 0-2.1l9.4-9.4a1.5 1.5 0 0 1 2.1 0l4.1 4.1a1.5 1.5 0 0 1 0 2.1l-7.9 7.9"/><path d="m9 9.5 6 6"/><path d="M7.5 19.5h12"/>',
  screen: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 20.5h7"/><path d="M12 17v3.5"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18"/><circle cx="6" cy="6.3" r=".5" fill="currentColor"/><circle cx="8" cy="6.3" r=".5" fill="currentColor"/>',
  share: '<path d="M3 9V6.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-5.5"/><path d="M3 13a7.5 7.5 0 0 1 7 7"/><path d="M3 16.8a3.7 3.7 0 0 1 3.2 3.2"/><circle cx="3.4" cy="20" r=".5" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 17.7 17"/><path d="M20 5v6.5h-6.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m4.5 12.5 4.8 4.8L19.5 7"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.3"/>',
  settings: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>',
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
  micOff: '<path d="M15 9.5V6a3 3 0 0 0-5.6-1.5"/><path d="M9 9v2.5a3 3 0 0 0 4.9 2.3"/><path d="M18.5 11.5a6.5 6.5 0 0 1-1 3.4"/><path d="M5.5 11.5a6.5 6.5 0 0 0 10 5.5"/><path d="M12 18v3"/><path d="m3.5 3.5 17 17"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  switch: '<rect x="2.5" y="4" width="11" height="8" rx="1.5"/><rect x="10.5" y="12" width="11" height="8" rx="1.5"/><path d="M17 4.5h1.5a2 2 0 0 1 2 2V8"/><path d="m22 6.5-1.5 1.5L19 6.5"/><path d="M7 19.5H5.5a2 2 0 0 1-2-2V16"/><path d="m2 17.5 1.5-1.5 1.5 1.5"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2.5"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 4.5Z"/><path d="M9 11h6"/><path d="M9 15h4"/>',
  paste: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2.5"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 4.5Z"/><path d="M12 10v7"/><path d="m9 14 3 3 3-3"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6.5 7l.9 11.6A2 2 0 0 0 9.4 20.5h5.2a2 2 0 0 0 2-1.9L17.5 7"/>',
  file: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z"/><path d="M14 3.5V8h4.5"/>',
  grip: '<circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
  collapse: '<path d="m14.5 6-6 6 6 6"/>',
  expand: '<path d="m9.5 6 6 6-6 6"/>',
}

/** SVG markup for an icon. */
export function icon(name, size = 18) {
  return `<svg class="pv-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`
}

/** Deterministic, well distinguishable color for a participant id (e.g. a session id). */
export function peerColor(seed) {
  const palette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899']
  let h = 2166136261
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return palette[(h >>> 0) % palette.length]
}
