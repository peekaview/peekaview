// Join requests – nobody watches without the presenter's OK – and the doorbell that announces
// them. Shown by the toolbar while sharing, otherwise by the PeekaView window.

import { icon } from '../icons.js'

const { invoke } = window.__TAURI__.core

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

let known = new Set()

/** Renders the requests into `box`; a new one rings the doorbell. */
export function renderRequests(box, list) {
  const fresh = list.some((r) => !known.has(r.peer))
  known = new Set(list.map((r) => r.peer))
  if (fresh) dingDong()
  box.hidden = !list.length
  box.replaceChildren(
    ...list.map((r) => {
      const row = document.createElement('div')
      row.className = 'request glass'
      row.innerHTML = '<span class="who"></span><div><strong></strong><span>Möchte deine Freigabe ansehen.</span></div><button class="pill secondary" data-deny>Ablehnen</button><button class="pill primary" data-allow>Zulassen</button>'
      if (r.room) {
        const label = row.querySelector('div span')
        label.textContent = 'möchte in „'
        label.append(Object.assign(document.createElement('b'), { className: 'room', textContent: r.room }), '“ – Fernzugriff')
      }
      const who = row.querySelector('.who')
      who.textContent = initials(r.name || 'Gast')
      who.style.background = /^#[0-9a-f]{6}$/i.test(r.color ?? '') ? r.color : '#52525b'
      row.querySelector('strong').textContent = r.name || 'Gast'
      row.querySelector('[data-allow]').addEventListener('click', () => invoke('admit', { peer: r.peer, allow: true }))
      row.querySelector('[data-deny]').addEventListener('click', () => invoke('admit', { peer: r.peer, allow: false }))
      return row
    }),
  )
  if (list.length > 1) {
    const all = document.createElement('button')
    all.className = 'pill secondary all'
    all.innerHTML = `${icon('check', 14)}Alle ${list.length} zulassen`
    all.addEventListener('click', () => invoke('admit', { allow: true }))
    box.append(all)
  }
}

let audio
/** Ding-dong: two soft bell tones (high, then low), synthesized – no sound file needed. */
export function dingDong() {
  try {
    audio ??= new AudioContext()
    audio.resume()
    const now = audio.currentTime
    const bell = (freq, at) => {
      // a bell: the fundamental plus a quieter, faster fading overtone
      for (const [mult, level, decay] of [[1, 0.32, 1.4], [2.76, 0.07, 0.5]]) {
        const osc = audio.createOscillator()
        const gain = audio.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq * mult
        gain.gain.setValueAtTime(0, now + at)
        gain.gain.linearRampToValueAtTime(level, now + at + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + decay)
        osc.connect(gain).connect(audio.destination)
        osc.start(now + at)
        osc.stop(now + at + decay + 0.05)
      }
    }
    bell(659.25, 0) // E5 – ding
    bell(523.25, 0.42) // C5 – dong
  } catch {}
}
