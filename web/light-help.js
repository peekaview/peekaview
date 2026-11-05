// "Bildschirmfreigabe light": while the browser asks what to share, a small card right beside its
// dialog says where to click – the dialog drawn as it looks (Firefox: its panel below the address
// bar, on a Mac or on Windows; Chrome, Edge: the dialog in the middle at the top).
// Safari asks differently (it lets you click the screen itself): no card there.

/** Which browser's dialog: 'firefox' | 'chrome' | 'edge' | null (no card). */
export function dialogKind(ua = navigator.userAgent) {
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Edg\//.test(ua)) return 'edge'
  if (/Chrome\//.test(ua)) return 'chrome'
  return null
}

/** Mac or Windows (Linux looks like Windows here: the buttons on the right). */
export function platformKind(platform = navigator.platform, ua = navigator.userAgent) {
  return /Mac/.test(platform) || /Mac OS X/.test(ua) ? 'mac' : 'windows'
}

/**
 * Shows the card (beside where the browser's dialog opens); returns a function that hides it.
 * @param {HTMLElement} card an empty element, position: fixed by CSS
 */
export function showScreenHelp(card, { kind = dialogKind(), platform = platformKind(), host = location.hostname || 'diese Seite' } = {}) {
  if (!kind) return () => {}
  card.dataset.kind = kind
  card.dataset.platform = platform
  card.innerHTML = kind === 'firefox' ? firefoxCard(platform, host) : chromeCard(kind)
  card.hidden = false
  const hide = () => {
    card.hidden = true
    card.replaceChildren()
  }
  card.querySelector('.screen-help-close')?.addEventListener('click', hide)
  return hide
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function firefoxCard(platform, host) {
  const mac = platform === 'mac'
  return `
    <button class="screen-help-close" type="button" aria-label="Schließen">×</button>
    <p class="screen-help-warn" role="alert">Die Bedienung mit Firefox ist stark eingeschränkt. Verwende wenn möglich Chrome.</p>
    <p class="screen-help-title"><span class="screen-help-arrow" aria-hidden="true">←</span> So teilst du deinen Bildschirm</p>
    ${firefoxFigure(mac, host)}
    <ol class="screen-help-steps">
      <li>Im Feld links oben <b>„Gesamter Bildschirm“</b> wählen – bei mehreren Bildschirmen den, auf dem dein Fenster liegt (<b>„Bildschirm 1“</b>, <b>„Bildschirm 2“</b>).</li>
      <li><b>„Erlauben“</b> klicken.</li>
    </ol>
    ${mac ? '<p class="screen-help-note">Fragt dein Mac nach „Bildschirmaufnahme“: in den Systemeinstellungen für Firefox einschalten, Firefox neu starten.</p>' : ''}`
}

function chromeCard(kind) {
  const tab = kind === 'edge' ? 'Microsoft Edge-Tab' : 'Chrome-Tab'
  return `
    <button class="screen-help-close" type="button" aria-label="Schließen">×</button>
    <p class="screen-help-title"><span class="screen-help-arrow" aria-hidden="true">←</span> So teilst du deinen Bildschirm</p>
    ${chromeFigure(tab)}
    <ol class="screen-help-steps">
      <li>Oben <b>„Gesamter Bildschirm“</b> wählen.</li>
      <li>Den Bildschirm anklicken (bei mehreren: den, auf dem dein Fenster liegt).</li>
      <li><b>„Teilen“</b> klicken.</li>
    </ol>`
}

// Firefox: a browser window's top (Mac: the three buttons on the left; Windows: on the right), its
// panel hanging from the address bar – the list of screens open, "Gesamter Bildschirm" marked
function firefoxFigure(mac, host) {
  const urlX = mac ? 66 : 12
  const icon = urlX + 8
  const allow = mac
    ? { x: 196, other: 104 } // Mac: "Erlauben" on the right
    : { x: 30, other: 122 } // Windows: "Erlauben" first
  return `
    <svg class="screen-help-figure" viewBox="0 0 300 236" role="img" aria-label="Firefox: im Feld „Gesamter Bildschirm“ wählen, dann „Erlauben“">
      <rect x="0.5" y="0.5" width="299" height="235" rx="10" fill="#e4e4e7" stroke="#d4d4d8"/>
      ${mac
        ? '<circle cx="14" cy="16" r="4.5" fill="#ff5f57"/><circle cx="28" cy="16" r="4.5" fill="#febc2e"/><circle cx="42" cy="16" r="4.5" fill="#28c840"/>'
        : '<text x="232" y="20" font-size="12" fill="#52525b">—</text><rect x="254" y="10" width="9" height="9" fill="none" stroke="#52525b"/><text x="276" y="20" font-size="13" fill="#52525b">✕</text>'}
      <rect x="${urlX}" y="6" width="${mac ? 220 : 200}" height="20" rx="6" fill="#fff"/>
      <rect x="${icon - 3}" y="10" width="12" height="12" rx="3" fill="#ef4444" opacity=".25"/>
      <rect x="${icon}" y="13" width="6" height="5" rx="1" fill="#52525b"/>
      <text x="${icon + 16}" y="20" font-size="10.5" fill="#71717a">${esc(host)}</text>
      <path d="M${icon - 2} 40 L${icon + 3} 31 L${icon + 8} 40" fill="#fff" stroke="#d4d4d8"/>
      <rect x="6" y="40" width="288" height="190" rx="8" fill="#fff" stroke="#d4d4d8"/>
      <rect x="${icon - 1}" y="39" width="8" height="3" fill="#fff"/>
      <text x="18" y="62" font-size="12" font-weight="700" fill="#18181b">Darf ${esc(host)} deinen Bildschirm sehen?</text>
      <text x="18" y="82" font-size="10.5" fill="#52525b">Fenster oder Bildschirm zum Freigeben:</text>
      <rect x="18" y="90" width="264" height="92" rx="5" fill="#fff" stroke="#a1a1aa"/>
      <text x="26" y="106" font-size="10.5" fill="#a1a1aa">Fenster oder Bildschirm auswählen …</text>
      <rect x="20" y="113" width="260" height="22" rx="3" fill="#0061e0"/>
      <text x="28" y="128" font-size="11" font-weight="700" fill="#fff">Gesamter Bildschirm</text>
      <rect x="17" y="110" width="266" height="28" rx="5" fill="none" stroke="#ef4444" stroke-width="2.5"/>
      <circle cx="270" cy="124" r="8" fill="#ef4444"/><text x="270" y="128" font-size="10.5" font-weight="800" fill="#fff" text-anchor="middle">1</text>
      <text x="28" y="152" font-size="10.5" fill="#52525b">Firefox – PeekaView</text>
      <text x="28" y="172" font-size="10.5" fill="#52525b">${mac ? 'Finder' : 'Explorer'}</text>
      <rect x="${allow.other}" y="194" width="84" height="26" rx="5" fill="#e4e4e7"/>
      <text x="${allow.other + 42}" y="211" font-size="10.5" font-weight="600" fill="#18181b" text-anchor="middle">Nicht erlauben</text>
      <rect x="${allow.x}" y="194" width="84" height="26" rx="5" fill="#0061e0"/>
      <text x="${allow.x + 42}" y="211" font-size="10.5" font-weight="700" fill="#fff" text-anchor="middle">Erlauben</text>
      <rect x="${allow.x - 3}" y="191" width="90" height="32" rx="7" fill="none" stroke="#ef4444" stroke-width="2.5"/>
      <circle cx="${allow.x + 84}" cy="193" r="8" fill="#ef4444"/><text x="${allow.x + 84}" y="197" font-size="10.5" font-weight="800" fill="#fff" text-anchor="middle">2</text>
    </svg>`
}

// Chrome, Edge: the dialog's tabs at its top, "Gesamter Bildschirm" marked; a screen below, the button
function chromeFigure(tab) {
  // ("Microsoft Edge-Tab" is longer: the other tabs further right)
  const d = tab.length > 12 ? 12 : 0
  return `
    <svg class="screen-help-figure" viewBox="0 0 300 196" role="img" aria-label="Oben „Gesamter Bildschirm“ wählen, den Bildschirm anklicken, „Teilen“">
      <rect x="0.5" y="0.5" width="299" height="195" rx="10" fill="#fff" stroke="#d4d4d8"/>
      <text x="16" y="26" font-size="12" font-weight="700" fill="#18181b">Inhalte zum Teilen auswählen</text>
      <text x="16" y="54" font-size="${d ? 9 : 10.5}" fill="#52525b">${esc(tab)}</text>
      <text x="${96 + d + (d ? 4 : 0)}" y="54" font-size="10.5" fill="#52525b">Fenster</text>
      <text x="${146 + d}" y="54" font-size="10.5" font-weight="700" fill="#0b57d0">Gesamter Bildschirm</text>
      <rect x="${144 + d}" y="59" width="112" height="2.5" fill="#0b57d0"/>
      <rect x="${140 + d}" y="40" width="120" height="26" rx="6" fill="none" stroke="#ef4444" stroke-width="2.5"/>
      <circle cx="${258 + d}" cy="42" r="8" fill="#ef4444"/><text x="${258 + d}" y="46" font-size="10.5" font-weight="800" fill="#fff" text-anchor="middle">1</text>
      <rect x="16" y="76" width="112" height="70" rx="6" fill="#dbeafe" stroke="#0b57d0" stroke-width="2"/>
      <rect x="24" y="84" width="60" height="38" rx="3" fill="#93c5fd"/><rect x="62" y="98" width="56" height="38" rx="3" fill="#bfdbfe"/>
      <rect x="12" y="72" width="120" height="78" rx="8" fill="none" stroke="#ef4444" stroke-width="2.5"/>
      <circle cx="132" cy="74" r="8" fill="#ef4444"/><text x="132" y="78" font-size="10.5" font-weight="800" fill="#fff" text-anchor="middle">2</text>
      <text x="16" y="164" font-size="10" fill="#52525b">Gesamter Bildschirm</text>
      <rect x="140" y="160" width="68" height="26" rx="13" fill="#e4e4e7"/><text x="174" y="177" font-size="10.5" font-weight="600" fill="#18181b" text-anchor="middle">Abbrechen</text>
      <rect x="216" y="160" width="68" height="26" rx="13" fill="#0b57d0"/><text x="250" y="177" font-size="10.5" font-weight="700" fill="#fff" text-anchor="middle">Teilen</text>
      <rect x="212" y="156" width="76" height="34" rx="16" fill="none" stroke="#ef4444" stroke-width="2.5"/>
      <circle cx="288" cy="158" r="8" fill="#ef4444"/><text x="288" y="162" font-size="10.5" font-weight="800" fill="#fff" text-anchor="middle">3</text>
    </svg>`
}
