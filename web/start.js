// The script of index.html (kept out of the page: the site's Content-Security-Policy allows
// scripts only from files of its own origin – see deploy/_headers).
// Start page: the room of the opened link (preselected) and the last ten permanent rooms this
// browser joined, each with its presenter (user@computer), when it was last used and whether
// it is online right now – asked over the room's encrypted signaling ("ping"), which creates
// no join request.
import { mountViewer } from './viewer.js'
import { mountRooms, openRoom } from './fixed-rooms.js'
import { icon, owl } from './icons.js'
import { mountOwl, startScene } from './home-scene.js'
import './legal.js'
import { Signaling, parseRoom } from './signal.js'
import { displayCode, findByCode, looksLikeCode, parseCode } from './word-code.js'
import { t, translate, mountLanguageSwitch, mountLanguageToggle } from './i18n.js'

// the page's German, or English (before anything below reads or adds to it)
translate()
mountLanguageSwitch(document.getElementById('footer'))
mountLanguageToggle(document.getElementById('topbar'))

const $ = (id) => document.getElementById(id)
// where it runs: the browser starts right here, the desktop apps lead to their download,
// Android is not out yet
for (const [name, label, title, action] of [
  ['globe', 'Browser', t('Im Browser starten – ohne Installation', 'Start in the browser – no installation'), 'share'],
  ['android', 'Android', t('Die Android-App ist bald verfügbar', 'The Android app is coming soon'), 'soon'],
  ['winlogo', 'Windows', t('PeekaView Desktop: teilen und fernsteuern lassen', 'PeekaView Desktop: share and get remote help'), 'download'],
  ['apple', 'macOS', t('PeekaView Desktop: teilen und fernsteuern lassen', 'PeekaView Desktop: share and get remote help'), 'download'],
]) {
  const li = document.createElement('li')
  const item = document.createElement(action === 'download' ? 'a' : action === 'share' ? 'button' : 'span')
  if (action === 'download') item.href = 'download'
  if (action === 'share') { item.type = 'button'; item.addEventListener('click', () => { setHomeView('share'); $('home').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('share-browser').focus({ preventScroll: true }) }) }
  if (action === 'soon') item.className = 'soon'
  item.title = title
  item.innerHTML = icon(name, 18)
  item.append(label)
  if (action === 'soon') item.append(Object.assign(document.createElement('em'), { textContent: t('bald', 'soon') }))
  li.append(item)
  $('platforms').append(li)
}
// what PeekaView does, beside the card
for (const [name, title, text] of [
  ['screen', t('Sofort teilen', 'Share instantly'), t('Link oder Code schicken – zum Ansehen genügt ein Browser.', 'Send a link or code – a browser is all it takes to watch.')],
  ['control', t('Fernsteuerung', 'Remote control'), t('Maus und Tastatur übergeben – mit der Desktop-App.', 'Hand over mouse and keyboard – with the desktop app.')],
  ['draw', t('Zeigen und Markieren', 'Point and mark'), t('Eigene Mauszeiger, Zeichnungen und eine gemeinsame Zwischenablage.', 'Your own cursors, drawings and a shared clipboard.')],
  ['users', t('Ohne Konto', 'No account'), t('Keine Registrierung und keine E-Mail-Adresse nötig.', 'No sign-up and no email address needed.')],
  ['check', t('Kostenlos und offen', 'Free and open'), t('Der Basic-Tarif bleibt kostenlos, der Code ist <a href="https://github.com/peekaview/peekaview" target="_blank" rel="noopener">Open Source</a>. <a href="preise">Tarife</a>', 'The Basic plan stays free, the code is <a href="https://github.com/peekaview/peekaview" target="_blank" rel="noopener">open source</a>. <a href="preise">Plans</a>')],
  ['lock', t('P2P · Ende-zu-Ende verschlüsselt', 'P2P · end-to-end encrypted'), t('Bild und Ton gehen direkt von Gerät zu Gerät. <a href="sicherheit" data-legal>Mehr</a>', 'Picture and sound go directly from device to device. <a href="sicherheit" data-legal>More</a>')],
]) {
  const li = document.createElement('li')
  li.innerHTML = `<i class="feature-icon">${icon(name, 30)}</i><div><strong></strong><span>${text}</span></div>`
  li.querySelector('strong').textContent = title
  $('features').append(li)
}
// "Teilen": from the browser where it can (not on phones); the desktop app for remote control
$('desktop-download').insertAdjacentHTML('afterbegin', icon('download', 16))
if (!navigator.mediaDevices?.getDisplayMedia) {
  $('share-browser').hidden = true
  $('share-unsupported').hidden = false
}
mountRooms($('fixed-rooms'), {profileRoot:$('profile'),onIncoming: call => {
  const notice = document.createElement('button')
  notice.textContent = t(`${call.caller_name} ruft an – Anruf öffnen`, `${call.caller_name} is calling – open the call`)
  notice.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;padding:14px;border:1px solid #ef4444;border-radius:12px;background:#18181b;color:white;cursor:pointer'
  notice.onclick = () => openRoom(call.id)
  document.body.append(notice)
  setTimeout(()=>notice.remove(),45000)
}})
const KEY = 'pv-rooms'
const MAX = 10
$('logo').innerHTML = owl(32)
$('top-logo').innerHTML = owl(34)
// the same on every tab (what holds for calls over contacts: sicherheit.html)
$('trust').innerHTML = icon('lock', 12) + t('<span class="p2p">P2P · </span><span class="long">Ende-zu-Ende </span>verschlüsselt', '<span class="p2p">P2P · </span><span class="long">end-to-end </span>encrypted')
$('contacts-close').innerHTML = icon('close',18)
$('contacts-close').addEventListener('click',()=>$('contacts-dialog').close())
$('contacts-dialog').addEventListener('close',()=>{
  $('fixed-room-entry').append($('fixed-rooms'))
  const profile=$('profile')
  const menu=profile.querySelector('details')
  if(menu)menu.open=false
  document.querySelector('.brand').append(profile)
})
function showContacts(){
  if($('contacts-dialog').open)return
  $('contacts-content').append($('fixed-rooms'))
  $('contacts-close').before($('profile'))
  $('contacts-dialog').showModal()
}

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? []
  } catch {
    return []
  }
}
const store = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {}
}

// the room secret travels in the "#…" part of the link – browsers never send it to a server
// inside the PeekaView app – a viewer window of the desktop app (room from the app) or the
// Android app (?app=1)
const params = new URLSearchParams(location.search)
const inApp = typeof window.__PV_JOIN__ === 'string' || params.get('app') === '1'
if (typeof window.__PV_JOIN__ === 'string') history.replaceState(null, '', `${location.pathname}#${window.__PV_JOIN__}`)
let linkRoom = decodeURIComponent(location.hash.slice(1))
// the views of the card: watching (link or code), sharing, contacts – sharing from the
// browser is no choice inside the apps
const homeViews=inApp ? ['link','contacts'] : ['link','share','contacts']
// remembered: contacts or watching – sharing is no place to come back to (someone opening the
// page again most likely got a link or code)
let homeView=linkRoom ? 'link' : (()=>{try{return localStorage.getItem('pv-start-view')==='contacts'?'contacts':'link'}catch{return 'link'}})()
function showHome(){
  $('home').hidden=!!viewer || !$('opened').hidden
  updateTeaser()
  // not inside the apps, not over a running share
  $('footer').hidden=inApp || !!viewer
  // someone who came with a link has exactly one thing to do: enter a name and join
  document.querySelector('.home-nav').hidden=!!linkRoom
  $('start').hidden=homeView!=='link'
  $('fixed-room-entry').hidden=homeView!=='contacts'
  $('share-entry').hidden=homeView!=='share' || !!linkRoom
  // contacts as a tab only for someone who has them (or is in an app, or looking at them now);
  // everybody else gets one quiet line that explains them first
  const contacts=inApp || homeView==='contacts' || hasAccount()
  document.querySelector('[data-home=contacts]').hidden=!contacts
  $('contacts-offer').hidden=contacts || homeView!=='link' || !!linkRoom
  $('contacts-intro').hidden=hasAccount()
  for(const button of document.querySelectorAll('[data-home]'))button.setAttribute('aria-pressed',String(button.dataset.home===homeView))

}
function hasAccount(){
  try{return !!JSON.parse(localStorage.getItem('pv-fixed-rooms-v1'))?.token}catch{return false}
}
window.addEventListener('storage',e=>{if(e.key==='pv-fixed-rooms-v1')showHome()})
$('contacts-offer').insertAdjacentHTML('afterbegin',icon('users',15))
$('contacts-offer').addEventListener('click',()=>setHomeView('contacts'))
function setHomeView(view){
  homeView=view
  try{localStorage.setItem('pv-start-view',homeView==='contacts'?'contacts':'link')}catch{}
  showHome()
  focusLinkField()
}
for(const button of document.querySelectorAll('[data-home]')){
  button.innerHTML=icon({link:'view',share:'share',contacts:'users'}[button.dataset.home],16)+button.textContent
  button.hidden=!homeViews.includes(button.dataset.home)
  button.addEventListener('click',()=>setHomeView(button.dataset.home))
}
// a code of two words ("Tiger Apfel", read out on the phone): ask the sharer for the link
let codeSearch=null
async function openCode(text){
  const field=$('share-url'),error=$('link-error'),wait=$('code-wait')
  const codes=parseCode(text)
  error.hidden=true
  if(!codes.length){
    error.textContent=t(`„${text.trim()}“ ist kein PeekaView-Code. Ein Code besteht aus zwei Wörtern, z. B. „Tiger Apfel“ – oder füge den ganzen Link ein.`,`“${text.trim()}” is not a PeekaView code. A code has two words, e.g. “Tiger Apfel” – or paste the whole link.`)
    error.hidden=false;field.focus();return
  }
  codeSearch?.abort()
  const search=codeSearch=new AbortController()
  wait.textContent=t(`Suche die Freigabe zu „${displayCode(codes[0])}“ …`,`Looking for the share of “${displayCode(codes[0])}” …`);wait.hidden=false
  $('paste-open').disabled=true
  try{
    const {link}=await findByCode(text,{signal:search.signal})
    if(search!==codeSearch)return
    field.value=''
    openLink(link,true)
  }catch(e){
    if(search!==codeSearch || e.message==='aborted')return
    error.textContent=t(`Zu „${displayCode(codes[0])}“ läuft gerade keine Freigabe. Stimmen die beiden Wörter? Der Code gilt nur, solange geteilt wird.`,`No share is running for “${displayCode(codes[0])}” right now. Are the two words right? A code only works while the screen is shared.`)
    error.hidden=false;field.focus()
  }finally{
    if(search===codeSearch){wait.hidden=true;$('paste-open').disabled=false;codeSearch=null}
  }
}
$('share-url').addEventListener('input',()=>{codeSearch?.abort();$('link-error').hidden=true})
function openPastedLink(){
  const text=$('share-url').value
  if(!text.trim())return $('share-url').focus()
  // no link (nothing like "https://…/#…"): meant as a code
  if(looksLikeCode(text) || !/[:/#.]/.test(text))return openCode(text)
  openLink(text.trim())
}
// a link: pasted, or the one a code brought (which may come from this very site, when it runs elsewhere)
function openLink(text,fromCode=false){
  const field=$('share-url'),error=$('link-error')
  try{
    const url=new URL(text)
    if(!['https://peekaview.de',...(fromCode?[location.origin]:[])].includes(url.origin) || url.username || url.password)throw new Error()
    if(['/fixed-rooms','/fixed-rooms.html'].includes(url.pathname) && new URLSearchParams(url.hash.slice(1)).has('invite')){
      location.href=new URL('fixed-rooms.html'+url.hash,location.href).href;return
    }
    const room=decodeURIComponent(url.hash.slice(1))
    if(!['/','/index.html'].includes(url.pathname) || !/^[A-Za-z0-9_-]{22}(\.[A-Za-z0-9_-]{43})?$/.test(room))throw new Error()
    error.hidden=true;field.value=''
    if(url.searchParams.has('name'))$('name').value=url.searchParams.get('name').slice(0,32)
    location.hash=room
  }catch{
    error.textContent=fromCode?t('Die Freigabe zu diesem Code lässt sich hier nicht öffnen.','The share of this code cannot be opened here.'):t('Das ist kein PeekaView-Link. Bitte den vollständigen Link einfügen – oder die zwei Wörter des Codes.','This is not a PeekaView link. Please paste the complete link – or the two words of the code.');error.hidden=false;field.focus()
  }
}
$('paste-open').addEventListener('click',openPastedLink)
// a pasted link opens right away – no need to find the button
$('share-url').addEventListener('paste',()=>setTimeout(()=>{if(/^\s*https?:/i.test($('share-url').value))openPastedLink()}))
$('other-link').addEventListener('click',()=>{location.hash=''})
let pasteOpen=false,nameEdit=false
// no remembered rooms: the link field is the one thing to do – the cursor already in it
// (not on touch screens, where it would pop up the keyboard unasked)
function focusLinkField(){
  if(homeView==='link' && !linkRoom && !load().length && !matchMedia('(pointer: coarse)').matches)$('share-url').focus()
}
$('name-edit').innerHTML=icon('draw',15)
$('name-edit').addEventListener('click',()=>{nameEdit=true;render();$('name').focus();$('name').select()})
$('new-link').addEventListener('click',()=>{pasteOpen=true;render();$('share-url').focus()})
$('share-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openPastedLink()}})
const savedName = (() => { try { return localStorage.getItem('pv-name') } catch { return null } })()
$('name').value = params.get('name') ?? savedName ?? ''
// remembered as typed
$('name').addEventListener('input', () => {
  try { localStorage.setItem('pv-name', $('name').value.trim()) } catch {}
  showNameError(false)
})
function showNameError(show) {
  $('name-error').hidden = !show
  $('name').classList.toggle('invalid', show)
}

// rooms on the page: the link's room first, then the remembered ones
const status = new Map() // room -> {online, checking, who, room, permanent, name}
let selected = linkRoom || load()[0]?.room || ''
const rooms = () => {
  const list = load()
  const all = linkRoom && !list.some((r) => r.room === linkRoom) ? [{ room: linkRoom, link: true }, ...list] : list
  return all
}

function ago(ms) {
  if (!ms) return t('noch nie', 'never')
  const d = new Date(ms)
  const now = new Date()
  const min = Math.round((now - d) / 60000)
  if (min < 2) return t('gerade eben', 'just now')
  if (min < 60) return t(`vor ${min} Min.`, `${min} min ago`)
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86400000)
  const locale = t('de-DE', 'en-GB')
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (days === 0) return t(`heute, ${time}`, `today, ${time}`)
  if (days === 1) return t(`gestern, ${time}`, `yesterday, ${time}`)
  if (days < 7) return t(`vor ${days} Tagen`, `${days} days ago`)
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: days > 300 ? 'numeric' : undefined })
}

function render() {
  showHome()
  const list = rooms()
  $('name-box').hidden=!selected
  $('connect').hidden=!selected
  // remembered rooms: the link field only on request
  $('paste-link').hidden=!!linkRoom || (list.length>0 && !pasteOpen)
  $('new-link').hidden=!list.length || pasteOpen
  // the field opens where it was asked for: below the rooms
  if(list.length)$('recent-links').after($('paste-link'));else $('recent-links').before($('paste-link'))
  // a name not yet known (or being changed): the field stays until the page is left
  if(!$('name').value.trim())nameEdit=true
  $('name-field').hidden=!nameEdit
  $('name-show').hidden=nameEdit
  $('name-current').textContent=$('name').value.trim()
  $('paste-open').classList.toggle('quiet',!!selected)
  $('other-link').hidden=!linkRoom
  $('recent-links').hidden=!list.length || !!linkRoom
  if (!list.length) {
    $('rooms').innerHTML = `<li class="empty">${t('Öffne den Link, den du von der teilenden Person bekommen hast.', 'Open the link the person sharing sent you.')}</li>`
  } else {
    $('rooms').replaceChildren(
      ...list.map((r) => {
        const st = status.get(r.room) ?? {}
        const li = document.createElement('li')
        li.className = `room${r.room === selected ? ' selected' : ''}${st.online ? ' online' : ''}${st.checking ? ' checking' : ''}`
        li.innerHTML = '<i class="dot"></i><div><strong></strong><span class="sub"></span></div><em></em>'
        const strong = li.querySelector('strong')
        // the tags stay together – on a narrow screen they move below the name as a group
        strong.innerHTML = '<b></b><span class="tags"></span>'
        strong.querySelector('b').textContent = st.room ?? r.name ?? (r.link ? t('Dieser Link', 'This link') : t('Raum', 'Room'))
        // what kind of link: permanent or temporary, PIN, remote access (known once answered)
        const permanent = st.permanent ?? r.permanent ?? (r.link ? undefined : true)
        const pin = st.pin ?? r.pin
        const remote = st.remote ?? r.remote
        const tag = (cls, html, title) => strong.lastChild.insertAdjacentHTML('beforeend', `<small class="tag ${cls}" title="${title}">${html}</small>`)
        // remembered rooms are all permanent – only the exception is worth a word
        if (permanent === false) tag('', t('einmalig', 'one-time'), t('Link nur für diese eine Freigabe', 'Link only for this one share'))
        if (pin) tag('pin', `${icon('lock', 10)}PIN`, t('Eintritt auch mit PIN, ohne Bestätigung', 'Entry also with PIN, without approval'))
        if (remote) tag('remote', t('Fernzugriff', 'Remote access'), t('Fernzugriff: Programme selbst starten', 'Remote access: start programs yourself'))
        const who = st.who ?? r.who
        const last = r.link ? t('neu', 'new') : t(`zuletzt ${ago(r.last)}`, `last ${ago(r.last)}`)
        li.querySelector('.sub').textContent = [who, last].filter(Boolean).join(' · ')
        li.querySelector('em').textContent = st.checking ? '' : st.online ? (st.busy ? t('belegt', 'busy') : 'online') : 'offline'
        if (!r.link) {
          const forget = Object.assign(document.createElement('button'), { type: 'button', className: 'forget', title: t('Raum entfernen', 'Remove room'), innerHTML: icon('trash', 16) })
          forget.setAttribute('aria-label', t(`Raum „${strong.querySelector('b').textContent}“ entfernen`, `Remove room “${strong.querySelector('b').textContent}”`))
          forget.addEventListener('click', (e) => {
            e.stopPropagation()
            store(load().filter((x) => x.room !== r.room))
            if (selected === r.room) selected = rooms()[0]?.room ?? ''
            render()
          })
          li.append(forget)
        }
        li.addEventListener('click', () => {
          selected = r.room
          render()
        })
        li.addEventListener('dblclick', () => connect())
        return li
      }),
    )
  }
  const st = status.get(selected)
  $('title').textContent = linkRoom ? (st?.who ? t(`${st.who} möchte dir den Bildschirm zeigen`, `${st.who} wants to show you their screen`) : t('Du bist zu einer Bildschirmfreigabe eingeladen', 'You are invited to a screen share')) : t('Bildschirm ansehen', 'Watch a screen')
  $('lead').textContent = linkRoom
    ? t('Gib deinen Namen ein und klicke auf „Freigabe ansehen“. Keine Anmeldung, nichts zu installieren.', 'Enter your name and click “Watch the share”. No sign-up, nothing to install.')
    : selected
      ? ''
      : t('Du hast einen Link oder Code bekommen? Gib ihn hier ein.', 'Got a link or code? Enter it here.')
  $('connect').disabled = !selected
  $('lead').hidden = !$('lead').textContent
  $('hint').textContent = !selected
    ? ''
    : openedInApp && selected === linkRoom
      ? t('In der PeekaView-App geöffnet – oder hier im Browser verbinden.', 'Opened in the PeekaView app – or connect here in the browser.')
    : gaveUp === selected && !st?.online
      ? t('Es kam keine Verbindung zustande. Ein Link gilt meist nur, solange die Freigabe läuft – bitte die teilende Person um einen neuen Link.', 'No connection came about. A link usually only works while the share is running – please ask the person sharing for a new link.')
      // (online or not, checking: the room's dot says it)
      : ''
}

// ---------------------------------------------------------------- online check
async function probe(room) {
  const { secret, hostKey } = parseRoom(room)
  if (!secret) return
  status.set(room, { ...status.get(room), checking: !status.get(room)?.seen })
  render()
  // the presenter answers our own key (the only "from" it takes from us)
  let me
  let answered = false
  const signaling = await Signaling.open({
    secret,
    hostKey,
    onMessage: (m) => {
      if (m.type !== 'pong' || m.to !== me || answered) return
      answered = true
      status.set(room, { online: true, seen: true, who: m.who, room: m.room, busy: m.busy, permanent: !!m.permanent, pin: !!m.pin, remote: !!m.remote })
      // permanent rooms are remembered with their presenter
      if (m.permanent) {
        const list = load()
        const entry = list.find((x) => x.room === room)
        if (entry) {
          Object.assign(entry, { who: m.who, name: m.room, seen: Date.now(), permanent: true, pin: !!m.pin, remote: !!m.remote })
          store(list)
        } else if (room === joined) {
          store([{ room, name: m.room, who: m.who, last: Date.now(), seen: Date.now(), permanent: true, pin: !!m.pin, remote: !!m.remote }, ...list])
        }
      }
      render()
    },
  })
  me = signaling.pubkey
  // ask twice while the relays connect (public relays throttle chatty clients)
  for (let i = 0; i < 2 && !answered; i++) {
    signaling.send({ type: 'ping', from: me })
    await new Promise((r) => setTimeout(r, 2500))
  }
  await new Promise((r) => setTimeout(r, 2000))
  signaling.close()
  // a single lost answer (relays) does not make a room offline
  if (!answered) {
    const before = status.get(room) ?? {}
    const misses = (before.misses ?? 0) + 1
    status.set(room, { ...before, online: before.online && misses < 2, misses, checking: false, seen: true })
  } else {
    status.set(room, { ...status.get(room), misses: 0 })
  }
  render()
}

// ---------------------------------------------------------------- teaser
// the globe and the owl only for the start page itself – not for someone who came with a link,
// not inside the apps, not while a share is watched (it would cost the video its frames)
const params0 = new URLSearchParams(location.search)
const teaserWanted = !(typeof window.__PV_JOIN__ === 'string' || params0.get('app') === '1')
let scene = null, owlMounted = false
function updateTeaser() {
  const solo = !teaserWanted || !!linkRoom || !!viewer || !$('opened').hidden
  document.body.classList.toggle('solo', solo)
  // the trust badge: top right of the page – in the card when only the card is shown
  if (!solo) $('topbar').append($('trust'))
  else if (!document.querySelector('.brand #trust')) document.querySelector('.brand .brand-name').after($('trust'))
  if (!teaserWanted) return
  if (viewer || !$('opened').hidden) scene?.stop()
  else if (scene) scene.start()
  else scene = startScene($('scene'))
  // the owl watches the remote mouse while the visitor's own rests
  if (!owlMounted && !solo) { owlMounted = true; mountOwl($('hero-owl'), { watch: () => scene?.cursor() }) }
}
// the headline's last words, one after the other
{
  const words = t(['im Browser.', 'ohne Konto.', 'verschlüsselt.', 'mit Fernsteuerung.'], ['in the browser.', 'without an account.', 'encrypted.', 'with remote control.'])
  let n = 0
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => {
    const el = $('hero-word')
    if (document.hidden || document.body.classList.contains('solo')) return
    el.className = 'hero-word out'
    setTimeout(() => { n = (n + 1) % words.length; el.textContent = words[n]; el.className = 'hero-word in' }, 280)
  }, 2600)
}

let probeTimer
// the room joined from this page (remembered once it turns out to be permanent)
let joined = null
let viewer = null
// no connection after this long: back to the start page
const GIVE_UP = 30000
let giveUpTimer
// the room whose connection did not come about (hint on the start page)
let gaveUp = null
// connected (or waiting for the presenter's approval – a person, not the network)
const CONNECTED = ['live', 'loading', 'paused', 'pick', 'locked', 'admission']
function probeAll() {
  // not while the page is in the background
  if (!document.hidden) for (const r of rooms()) probe(r.room)
  probeTimer = setTimeout(probeAll, 60000)
}

// ---------------------------------------------------------------- connect
function connect() {
  const room = selected
  if (!room) return
  const name = $('name').value.trim()
  if (!name) {
    showNameError(true)
    return $('name').focus()
  }
  try { localStorage.setItem('pv-name', name) } catch {}
  // remember permanent rooms (the newest first)
  const st = status.get(room)
  const list = load()
  const known = list.find((x) => x.room === room)
  if (known || st?.permanent) {
    const entry = { ...(known ?? {}), room, name: st?.room ?? known?.name, who: st?.who ?? known?.who, last: Date.now(), permanent: true, pin: st?.pin ?? known?.pin, remote: st?.remote ?? known?.remote }
    store([entry, ...list.filter((x) => x.room !== room)])
  }
  clearTimeout(probeTimer)
  joined = room
  if (!st) probe(room)
  if (location.hash.slice(1) !== room) history.replaceState(null, '', `${location.pathname}${location.search}#${room}`)
  $('home').hidden = true
  $('footer').hidden = true
  $('viewer').hidden = false
  gaveUp = null
  viewer = mountViewer($('viewer'), {
    onRooms: showContacts,
    room,
    name,
    onStatus: (status) => {
      if (CONNECTED.includes(status)) {
        clearTimeout(giveUpTimer)
        giveUpTimer = undefined
      } else if (!giveUpTimer) {
        giveUpTimer = setTimeout(() => {
          leave()
          gaveUp = room
          render()
        }, GIVE_UP)
      }
    },
  })
  updateTeaser()
}

/** Back to the start page. */
function leave() {
  $('contacts-dialog').close()
  clearTimeout(giveUpTimer)
  giveUpTimer = undefined
  viewer?.destroy()
  viewer = null
  joined = null
  $('viewer').hidden = true
  showHome()
  probeAll()
}

// another room link opened in this tab (only the "#…" changed): join that one
window.addEventListener('hashchange', () => {
  const room = decodeURIComponent(location.hash.slice(1))
  if (!room) {
    linkRoom='';selected=load()[0]?.room || ''
    if(viewer)leave()
    render();focusLinkField();return
  }
  if (room === joined) return
  homeView='link'
  linkRoom = selected = room
  if (viewer) leave()
  if ($('name').value.trim()) connect()
  else {
    render()
    $('name').focus()
  }
})

$('start').addEventListener('submit', (e) => {
  e.preventDefault()
  if(!selected)openPastedLink();else connect()
})

// ---------------------------------------------------------------- open in the PeekaView app
// Installed, it handles "peekaview://join" and shows the share in a window of its own. Whether
// it is installed only shows when the page loses the focus to it – remembered from then on.
const APP_KEY = 'pv-app'
const appKnown = () => { try { return localStorage.getItem(APP_KEY) === '1' } catch { return false } }
let openedInApp = false
function openInApp(room, gesture) {
  const st = status.get(room) ?? {}
  const known = load().find((x) => x.room === room) ?? {}
  const q = new URLSearchParams({ room })
  const name = st.room ?? known.name
  const who = st.who ?? known.who
  if (name) q.set('name', name)
  if (who) q.set('who', who)
  const url = `peekaview://join?${q}`
  // the app took over: this page has nothing more to do
  const onBlur = () => {
    openedInApp = true
    try { localStorage.setItem(APP_KEY, '1') } catch {}
    clearTimeout(probeTimer)
    $('home').hidden = true
    $('opened-text').textContent = /Android/i.test(navigator.userAgent)
      ? t('In der PeekaView-App geöffnet. Du kannst dieses Fenster schließen.', 'Opened in the PeekaView app. You can close this window.')
      : t('In PeekaView Desktop geöffnet. Du kannst dieses Fenster schließen.', 'Opened in PeekaView Desktop. You can close this window.')
    $('opened').hidden = false
    updateTeaser()
  }
  window.addEventListener('blur', onBlur, { once: true })
  setTimeout(() => window.removeEventListener('blur', onBlur), 3000)
  if (/Android/i.test(navigator.userAgent)) {
    // Android: an intent – without the app, Chrome stays on this page
    if (!gesture) return
    location.href = `intent://join?${q}#Intent;scheme=peekaview;package=de.limtec.peekaview;S.browser_fallback_url=${encodeURIComponent(location.href)};end`
  } else if (gesture || appKnown()) {
    location.href = url
  } else {
    // a first try without a click: unknown schemes fail silently in a hidden frame
    const frame = Object.assign(document.createElement('iframe'), { hidden: true, src: url })
    document.body.append(frame)
    setTimeout(() => frame.remove(), 3000)
  }
}
$('opened-logo').innerHTML = owl(40)
$('open-web').addEventListener('click', () => {
  $('opened').hidden = true
  render()
  probeAll()
})
$('open-app').hidden = inApp || !linkRoom
$('open-app').textContent = /Android/i.test(navigator.userAgent) ? t('In der PeekaView-App öffnen', 'Open in the PeekaView app') : t('In PeekaView Desktop öffnen', 'Open in PeekaView Desktop')
// the Android app shares the phone's screen
$('share-phone').hidden = !window.PeekaViewApp
$('share-phone').addEventListener('click', () => window.PeekaViewApp?.share())
$('open-app').addEventListener('click', () => openInApp(selected || linkRoom, true))

render()
// a link with ?name=… (integrations, tests) – or opened in the app with a known name – joins right away
if (linkRoom && (params.has('name') || (inApp && $('name').value.trim()))) connect()
else {
  probeAll()
  if (linkRoom && !$('name').value) $('name').focus()
  focusLinkField()
  if (linkRoom && !inApp) openInApp(linkRoom, false)
}
