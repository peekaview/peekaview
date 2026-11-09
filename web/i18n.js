// The public website in German (as written in the pages) or English. The browser's language
// decides; the switch in the footer overrides it and is remembered. Elements carry their English
// beside the German: data-en (text), data-en-html (markup), data-en-placeholder, data-en-title,
// data-en-aria-label. Scripts use t('Deutsch', 'English').
// Only the website itself speaks English so far: the start page, download, prices and about –
// not yet the viewer, sharing from the browser, contacts or the legal pages.
const KEY = 'pv-lang'

export const lang = (() => {
  // inside the apps (desktop viewer windows, Android): German, like the rest of the apps
  if (typeof window.__PV_JOIN__ === 'string' || window.__TAURI__ || window.PeekaViewApp || new URLSearchParams(location.search).get('app') === '1') return 'de'
  try {
    const chosen = localStorage.getItem(KEY)
    if (chosen === 'de' || chosen === 'en') return chosen
  } catch {}
  const wanted = (navigator.languages?.[0] ?? navigator.language ?? 'de').toLowerCase()
  return wanted.startsWith('de') ? 'de' : 'en'
})()

export const t = (de, en) => (lang === 'en' ? en : de)

export function translate(root = document) {
  if (root === document) document.documentElement.lang = lang
  if (lang !== 'en') return
  for (const el of root.querySelectorAll('[data-en]')) el.textContent = el.dataset.en
  for (const el of root.querySelectorAll('[data-en-html]')) el.innerHTML = el.dataset.enHtml
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const key = 'en' + attr.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())
    for (const el of root.querySelectorAll(`[data-en-${attr}]`)) el.setAttribute(attr, el.dataset[key])
  }
}

function switchLanguage() {
  try { localStorage.setItem(KEY, lang === 'en' ? 'de' : 'en') } catch {}
  location.reload()
}

/** "English" / "Deutsch" at the end of the footer: switches and reloads the page. */
export function mountLanguageSwitch(footer = document.querySelector('.pv-footer')) {
  if (!footer) return
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'pv-lang', textContent: lang === 'en' ? 'Deutsch' : 'English' })
  button.lang = lang === 'en' ? 'de' : 'en'
  button.addEventListener('click', switchLanguage)
  const owner = footer.querySelector('.pv-footer-owner')
  if (owner) owner.before(button)
  else footer.append(button)
}

const GLOBE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z"/></svg>'

/** The small switch top right: a globe and the other language ("EN" / "DE"). */
export function mountLanguageToggle(place) {
  if (!place) return
  const other = lang === 'en' ? 'de' : 'en'
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'pv-lang-toggle', innerHTML: GLOBE + other.toUpperCase() })
  button.title = lang === 'en' ? 'Auf Deutsch anzeigen' : 'Show in English'
  button.setAttribute('aria-label', button.title)
  button.lang = other
  button.addEventListener('click', switchLanguage)
  place.append(button)
}
