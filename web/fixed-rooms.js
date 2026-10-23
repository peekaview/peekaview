// Shared room UI for the browser, desktop picker and Android. The PHP service owns membership.
import { mountViewer } from './viewer.js'
import { Voice } from './voice.js'
import { Signaling } from './signal.js'
import { icon, peerColor } from './icons.js'

const KEY = 'pv-fixed-rooms-v1'
export const platform = window.__TAURI__ ? 'desktop' : window.PeekaViewApp || window.PeekaViewHost ? 'android' : 'browser'
export function apiURL(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Die Server-Adresse muss mit https:// beginnen.')
  if (url.username || url.password || url.hash || url.search) throw new Error('Bitte die direkte URL zu api.php ohne Parameter eingeben.')
  return url.href
}
export class RoomClient extends EventTarget {
  constructor(storage = localStorage) {
    super()
    this.storage = storage
    this.session = JSON.parse(storage.getItem(KEY) || '{"api":"https://peekaview.devxpert.de/api.php"}')
    this.state = { contacts: this.session.contactsVersion===2 ? this.session.contacts : [], rooms: this.session.contactsVersion===2 ? this.session.rooms : [], calls: [], invitations: [] }
  }
  save() {
    this.storage.setItem(KEY, JSON.stringify(this.session))
    this.dispatchEvent(new Event('change'))
  }
  async request(action, body, authenticated = true) {
    const url = new URL(this.session.api)
    url.searchParams.set('action', action)
    url.searchParams.set('v','2')
    const headers = { 'Content-Type': 'application/json' }
    if (authenticated && this.session.token) headers.Authorization = `Bearer ${this.session.token}`
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000) })
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unter dieser Adresse antwortet kein PeekaView-Server.')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `PeekaView-Server: HTTP ${response.status}`)
    return data
  }
  async refresh(callId = '') {
    if (!this.session.token || this.busy) return
    this.busy = true
    try {
      this.state = await this.request('state')
      if (callId && this.state.calls.some(c=>c.id===callId && c.status==='joined')) await this.request('calls/heartbeat',{call:callId})
      this.session.contactsVersion=2
      this.session.rooms = this.state.rooms
      this.session.contacts = this.state.contacts
      this.session.device = this.state.device
      this.save()
    } finally { this.busy = false }
  }
}

export async function openRoom(call = '') {
  if (platform === 'desktop') return window.__TAURI__.core.invoke('fixed_room_window', { call })
  if (window.PeekaViewHost) return window.PeekaViewHost.rooms(call)
  location.href = new URL(`fixed-rooms.html${call ? `#call=${encodeURIComponent(call)}` : ''}`, import.meta.url).href
}
async function configureNative(client) {
  if (!client.session.token) return
  const session = JSON.stringify({ api: client.session.api, token: client.session.token })
  if (platform === 'desktop' && !window.__PV_JOIN__) await window.__TAURI__.core.invoke('fixed_room_configure', { session })
  else (window.PeekaViewHost || window.PeekaViewApp)?.configureRooms(session)
}
async function shareCall(call) {
  if (platform === 'desktop') return window.__TAURI__.core.invoke('fixed_share_picker', { call })
  if (platform === 'android') return (window.PeekaViewHost || window.PeekaViewApp).shareInCall(call)
  throw new Error('Zum Bildschirmteilen benötigst du PeekaView Desktop oder die Android-App (kostenlos).')
}

const element = (tag, text, className) => {
  const el = document.createElement(tag)
  if (text !== undefined) el.textContent = text
  if (className) el.className = className
  return el
}
export function mountRooms(root, { callId = '', invitation = '', invitationApi = '', onIncoming, onOpen = openRoom } = {}) {
  const client = new RoomClient()
  root.classList.add('fixed-rooms')
  const content = element('div', undefined, 'fr-content')
  const error = element('p', '', 'fr-error'); error.setAttribute('role', 'alert')
  const notice=element('p','','fr-notice');notice.setAttribute('role','status')
  root.append(content, notice, error)
  let disposed = false, timer, preview = null, active = null, previews = new Map(), voice, signaling, voiceSecret
  let rendered = '', seen = new Set(), polling = false, stoppingAudio = false
  let allContacts = false, allGroups = false
  const openGroups = new Set(), openContacts = new Set()
  let emailSent=client.session.pendingEmail || ''
  let pcmContext, pcmNode, pcmPending=false
  const pcmSources=new Map()
  const fail = e => { error.textContent = e.message || String(e) }
  const action = async task => { error.textContent = '';notice.textContent=''; try { await task(); await refresh() } catch (e) { fail(e) } }
  function button(text, run, className = '') {
    const b = element('button', text, className); b.type = 'button'
    b.addEventListener('click', () => action(async () => { b.disabled = true; try { await run() } finally { b.disabled = false } }))
    return b
  }
  function input(label, type = 'text', value = '') {
    const box = element('label', label); const field = document.createElement('input')
    field.type = type; field.defaultValue = value; field.required = true; field.maxLength = type === 'email' ? 254 : 160
    box.append(field); return { box, field }
  }
  function form(fields, submit, run) {
    const f = document.createElement('form'); const inputs = fields.map(([name,type,value]) => input(name,type,value))
    f.append(...inputs.map(i=>i.box)); const b = element('button', submit,'fr-primary'); f.append(b)
    f.addEventListener('submit', e => { e.preventDefault(); action(async()=>{ b.disabled=true; try { await run(...inputs.map(i=>i.field.value.trim()));for(const i of inputs)i.field.defaultValue=i.field.value } finally { b.disabled=false } }) })
    return f
  }
  async function callContact(person) {
    const existing=client.state.calls.find(c=>c.kind==='contact' && c.status==='joined' && c.contact_id===person)
    if(existing)return onOpen(existing.id)
    const call=await client.request('calls/direct',{person})
    await onOpen(call.id)
    if (platform!=='browser') await shareCall(call.id)
  }
  function pinDialog(name) {
    return new Promise(resolve=>{
      const dialog=element('dialog',undefined,'fr-pin-dialog')
      const f=document.createElement('form');f.method='dialog'
      const pin=input(`PIN für „${name}“`,'password')
      pin.field.minLength=6;pin.field.maxLength=128;pin.field.autocomplete='current-password'
      const buttons=element('div',undefined,'fr-dialog-buttons')
      const cancel=element('button','Abbrechen');cancel.type='button';cancel.onclick=()=>dialog.close()
      buttons.append(cancel,element('button','Beitreten','fr-primary'));f.append(pin.box,buttons);dialog.append(f)
      let value=null
      f.addEventListener('submit',()=>{value=pin.field.value})
      dialog.addEventListener('close',()=>{pin.field.value='';dialog.remove();resolve(value)},{once:true})
      document.body.append(dialog);dialog.showModal();pin.field.focus()
    })
  }
  async function groupCall(room) {
    const existing=client.state.calls.find(c=>c.room===room.id && c.status==='joined')
    if(existing)return onOpen(existing.id)
    const pin=room.pin ? await pinDialog(room.name) : ''
    if (pin===null) return
    const call=await client.request('calls/start',{room:room.id,pin});await onOpen(call.id)
    if (platform!=='browser') await shareCall(call.id)
  }
  function collection(title, items, expanded, toggle, renderItem, empty) {
    const section=element('section',undefined,'fr-collection')
    section.append(element('h3',title))
    if (!items.length) section.append(element('p',empty,'fr-muted'))
    for (const item of expanded ? items : items.slice(0,5)) section.append(renderItem(item))
    if (items.length>5) section.append(button(expanded?'Weniger anzeigen':`Alle ${items.length} anzeigen`,()=>{toggle();rendered='';render()},'fr-expand'))
    return section
  }
  function beginConnection(nextAction){client.session.nextAction=nextAction;client.save();rendered='';render()}
  function personDetails(person){
    const details=element('details',undefined,'fr-person-details')
    details.append(element('summary',`${person.name} · ${person.email}`))
    for(const device of person.devices || []){
      const row=element('div',undefined,'fr-member')
      const kind={desktop:'Computer',android:'Android',browser:'Browser'}[device.platform] || 'Gerät'
      row.append(element('span',device.name),badge(kind));details.append(row)
    }
    return details
  }
  function contactCard(contact){
    const card=element('section',undefined,'fr-person')
    const row=element('div',undefined,'fr-room-row')
    const call=button('',()=>callContact(contact.id),'fr-contact')
    const text=element('span',undefined,'fr-person-text');text.append(element('strong',contact.name),element('small',contact.email))
    const joined=client.state.calls.some(c=>c.kind==='contact' && c.status==='joined' && c.contact_id===contact.id)
    call.append(avatar(contact),text,element('span',joined?'Öffnen':'Anrufen','fr-call-action'))
    call.setAttribute('aria-label',`${contact.name}: ${joined?'Gespräch öffnen':'Anrufen'}`)
    const details=personDetails(contact);details.open=true;details.hidden=!openContacts.has(contact.id)
    const toggle=button('',()=>{details.hidden=!details.hidden;if(details.hidden)openContacts.delete(contact.id);else openContacts.add(contact.id);toggle.setAttribute('aria-expanded',String(!details.hidden))},'fr-group-toggle')
    toggle.innerHTML=icon('settings',17);toggle.setAttribute('aria-label',`${contact.name}: Details`);toggle.setAttribute('aria-expanded',String(!details.hidden))
    row.append(call,toggle);card.append(row,details);return card
  }
  function avatar(person, group = false) {
    const el=element('span',undefined,'fr-avatar')
    const color=peerColor(person.id)
    el.style.color=color; el.style.backgroundColor=color+'24'
    el.setAttribute('aria-hidden','true')
    if (group) el.innerHTML=icon('users',18)
    else el.textContent=person.email.split('@')[0].split(/[._\s-]+/).map(p=>p[0]).join('').slice(0,2).toUpperCase()
    return el
  }
  function badge(text, kind = '') { return element('span',text,`fr-badge ${kind}`) }
  function groupCard(room) {
    const card=element('section',undefined,'fr-room')
    const row=element('div',undefined,'fr-room-row')
    const call=button('',()=>groupCall(room),'fr-room-name')
    const text=element('span',undefined,'fr-person-text')
    text.append(element('strong',room.name))
    const count=(room.people || []).length
    text.append(element('small',`${count} ${count===1?'Person':'Personen'}`))
    call.append(avatar(room,true),text)
    const badges=element('span',undefined,'fr-badges')
    if (room.active_call) badges.append(badge('Gespräch läuft','fr-badge-live'))
    if (room.pin) badges.append(badge('PIN'))
    if (room.unattended) badges.append(badge('Zugriff bereit'))
    const joined=client.state.calls.some(c=>c.room===room.id && c.status==='joined')
    const pending=client.state.calls.find(c=>c.room===room.id && ['requested','rejected'].includes(c.status))
    const label=pending?(pending.status==='requested'?'Wartet':'Nicht zugelassen'):joined?'Öffnen':room.active_call?'Beitreten':'Anrufen'
    call.append(element('span',label,'fr-call-action'));call.disabled=!!pending
    call.setAttribute('aria-label',`${room.name}: ${label}`)
    const details=element('div',undefined,'fr-group-details')
    details.hidden=!openGroups.has(room.id)
    const toggle=button('',()=>{
      if (openGroups.has(room.id)) openGroups.delete(room.id); else openGroups.add(room.id)
      details.hidden=!openGroups.has(room.id);toggle.setAttribute('aria-expanded',String(!details.hidden))
    },'fr-group-toggle')
    toggle.innerHTML=icon('settings',17)
    toggle.title=`${room.name}: Mitglieder und Einstellungen`
    toggle.setAttribute('aria-label',toggle.title)
    toggle.setAttribute('aria-expanded',String(!details.hidden))
    row.append(call,badges,toggle);card.append(row,details)
    const members=element('div',undefined,'fr-members')
    for (const person of room.people || []) members.append(personDetails(person))
    for (const invitation of room.invitations || []) members.append(element('div',`${invitation.email} · Einladung offen`,'fr-muted'))
    details.append(members)
    if (room.can_manage) details.append(memberEditor(room))
    details.append(accessSettings(room))
    return card
  }
  function memberEditor(room) {
      const editor=element('div',undefined,'fr-member-editor')
      const others=(client.state.contacts || []).filter(d=>!(room.people || []).some(p=>p.id===d.id))
      if (others.length) {
        const add=element('div',undefined,'fr-add-contact')
        const select=document.createElement('select');select.setAttribute('aria-label','Kontakt zur Gruppe hinzufügen')
        const placeholder=element('option','Kontakt auswählen …');placeholder.value='';placeholder.disabled=true;placeholder.selected=true;select.append(placeholder)
        for (const d of others) {const option=element('option',`${d.name} · ${d.email}`);option.value=d.id;select.append(option)}
        const submit=button(room.active_call?'Hinzufügen & anrufen':'Zur Gruppe hinzufügen',()=>client.request('rooms/add-contact',{room:room.id,person:select.value}))
        submit.disabled=true;select.addEventListener('change',()=>{submit.disabled=!select.value})
        add.append(select,submit)
        editor.append(add)
      }
      const invite=element('details');invite.append(element('summary','Per E-Mail einladen'))
      invite.append(form([['E-Mail-Adresse','email','']],'Einladung senden',async email=>{
        await client.request('rooms/invite',{room:room.id,email});notice.textContent=`Einladung an ${email} gesendet.`
      }))
      editor.append(invite)
      return editor
  }
  function accessSettings(room) {
    const box=element('div',undefined,'fr-access-settings')
    let pinEnabled, pinField, pendingAccess=false
    if (room.can_manage) {
      const f=document.createElement('form')
      const label=element('label',undefined,'fr-check')
      pinEnabled=document.createElement('input');pinEnabled.type='checkbox';pinEnabled.checked=!!room.pin;pinEnabled.disabled=!!room.pin_required
      label.append(pinEnabled,document.createTextNode('Gruppen-PIN'))
      pinField=document.createElement('input');pinField.type='password';pinField.minLength=6;pinField.maxLength=128;pinField.autocomplete='new-password'
      pinField.setAttribute('aria-label','Gruppen-PIN');pinField.placeholder=room.pin?'Neue PIN (leer lassen zum Beibehalten)':'PIN · mindestens 6 Zeichen'
      const sync=()=>{pinField.hidden=!pinEnabled.checked;pinField.required=pinEnabled.checked && !room.pin}
      pinEnabled.addEventListener('change',sync);sync()
      const save=element('button','PIN speichern')
      f.append(label,pinField,save)
      if (room.pin_required) f.append(element('small','Für unbeaufsichtigten Zugriff erforderlich.','fr-muted'))
      if (room.active_call) f.append(element('small','Eine PIN-Änderung beendet den Gruppenanruf.','fr-muted'))
      f.addEventListener('submit',e=>{e.preventDefault();action(async()=>{
        save.disabled=true
        try {
          await client.request('rooms/settings',{room:room.id,pin_enabled:pinEnabled.checked,pin:pinEnabled.checked?pinField.value:''});pinField.value='';room.pin=pinEnabled.checked
          if(pendingAccess && room.pin){pendingAccess=false;await choose()}
          else notice.textContent='Gruppen-PIN gespeichert.'
        }
        finally {save.disabled=false}
      })})
      box.append(f)
    }
    if (platform==='browser') return box
    const label=element('label',undefined,'fr-check')
    const unattended=document.createElement('input');unattended.type='checkbox';unattended.checked=!!room.unattended
    label.append(unattended,document.createTextNode('Unbeaufsichtigter Zugriff auf diesem Gerät'))
    const selection=element('div',undefined,'fr-access-selection')
    const native=window.PeekaViewHost || window.PeekaViewApp
    const configure=async value=>{
      if (platform==='desktop') await window.__TAURI__.core.invoke('fixed_access_configure',{room:room.id,selection:value})
      else {const result=JSON.parse(native.configureRoomAccess(room.id,JSON.stringify(value)));if(result.error)throw new Error(result.error)}
    }
    async function choose() {
      if (!room.pin) {
        unattended.checked=false
        if (pinEnabled) {
          pendingAccess=true;pinEnabled.checked=true;pinEnabled.dispatchEvent(new Event('change'));pinField.focus()
          notice.textContent='Lege zuerst eine Gruppen-PIN mit mindestens 6 Zeichen fest. Danach wählst du aus, was freigegeben werden darf.';return
        }
        throw new Error('Bitte den Gruppenersteller, zuerst eine Gruppen-PIN festzulegen.')
      }
      const options=platform==='desktop' ? await window.__TAURI__.core.invoke('fixed_access_options',{room:room.id}) : JSON.parse(native.roomAccessOptions(room.id))
      if (options.error) throw new Error(options.error)
      unattended.checked=true
      selection.replaceChildren(element('strong','Was darf ohne Rückfrage geteilt werden?'),element('small','Nur auf diesem Gerät. Gespeichert wird erst mit „Zugriff aktivieren“.','fr-muted'))
      const choices=[]
      const targets=element('div',undefined,'fr-access-targets')
      for (const [kind,items] of [['screens',options.screens],['apps',options.apps]]) {
        const group=element('div',undefined,'fr-access-group');group.append(element('strong',kind==='screens'?'Bildschirme':'Anwendungen'))
        for (const item of items) {
          const line=element('label',undefined,'fr-check')
          const check=document.createElement('input');check.type='checkbox';check.value=item.id;check.checked=(options.selection?.[kind] || []).includes(item.id)
          line.append(check,document.createTextNode(item.name));group.append(line);choices.push({check,kind,line,name:item.name.toLocaleLowerCase()})
        }
        targets.append(group)
      }
      const search=document.createElement('input');search.type='search';search.placeholder='Anwendungen suchen';search.setAttribute('aria-label','Anwendungen suchen')
      search.addEventListener('input',()=>{for(const choice of choices)if(choice.kind==='apps')choice.line.hidden=!choice.name.includes(search.value.toLocaleLowerCase())})
      selection.append(search,targets)
      const buttons=element('div',undefined,'fr-dialog-buttons')
      const activate=button('Zugriff aktivieren',async()=>{
        const value={enabled:true,screens:[],apps:[]}
        for (const {check,kind} of choices) if (check.checked) value[kind].push(check.value)
        if (!value.screens.length && !value.apps.length) throw new Error('Wähle mindestens einen Bildschirm oder eine Anwendung.')
        await configure(value);selection.replaceChildren();notice.textContent='Unbeaufsichtigter Zugriff ist für die ausgewählten Inhalte bereit.'
      },'fr-primary')
      const sync=()=>{activate.disabled=!choices.some(c=>c.check.checked)}
      for(const choice of choices)choice.check.addEventListener('change',sync)
      sync();buttons.append(button('Abbrechen',()=>{selection.replaceChildren();unattended.checked=!!room.unattended}),activate);selection.append(buttons)
    }
    unattended.addEventListener('change',()=>action(async()=>{
      unattended.disabled=true
      try {if(unattended.checked) await choose();else {pendingAccess=false;await configure({enabled:false,screens:[],apps:[]});selection.replaceChildren();notice.textContent='Unbeaufsichtigter Zugriff ist aus.'}}
      catch(e){unattended.checked=!!room.unattended;throw e}
      finally{unattended.disabled=false}
    }))
    box.append(label)
    if (room.unattended) box.append(button('Auswahl ändern',choose))
    box.append(selection)
    return box
  }
  function render() {
    if (active) return renderCall()
    if (rendered && (content.querySelector('.fr-access-selection > *') || content.querySelector('.fr-new-group input[type=checkbox]:checked') || [...content.querySelectorAll('input:not([type="checkbox"])')].some(input=>input.value!==input.defaultValue))) return
    const key = JSON.stringify([client.session, client.state, preview, invitation, emailSent, callId])
    if (key === rendered) return
    rendered = key; content.replaceChildren()
    if (invitation) {
      if (!preview) { content.append(button('Einladung prüfen', loadInvitation)); return }
      const kind=preview.kind
      const title=kind==='group' ? `Einladung zu „${preview.name}“` : kind==='contact' ? `${preview.sender_name} möchte dich als Kontakt hinzufügen` : 'Deine E-Mail bestätigen'
      const next=preview.next_action==='contact'?'Danach lädst du die andere Person ein.':preview.next_action==='group'?'Danach erstellst du deine Gruppe.':'Danach sind deine Kontakte und Gruppen hier verfügbar.'
      content.append(element('h3',title),element('p',kind==='device'?next:`${preview.sender_email} lädt dich ein.`,'fr-muted'),element('p',kind==='device'?preview.email:`Du nimmst als ${preview.email} teil.`))
      const acceptance=form([['Name dieses Geräts','text',client.session.device?.name || (platform==='android'?'Mein Handy':platform==='desktop'?'Mein Computer':'Mein Browser')]],kind==='group'?'Gruppe beitreten':kind==='contact'?'Kontakt hinzufügen':'Bestätigen und weiter',async name=>{
        const result = await client.request('invitation/accept',{invitation,name,platform})
        if (result.token) client.session.token=result.token
        client.session.device=result.device
        if(result.next_action && result.next_action!=='login')client.session.nextAction=result.next_action
        else delete client.session.nextAction
        delete client.session.pendingEmail;client.save();invitation='';preview=null;emailSent=''
        history.replaceState(null,'',location.pathname+location.search)
        await configureNative(client)
        notice.textContent=kind==='group'?'Einladung angenommen.':kind==='contact'?'Kontakt hinzugefügt. Ihr könnt euch jetzt anrufen.':'E-Mail-Adresse bestätigt.'
        if(result.request_call){
          if(platform==='browser'){callId=result.request_call;history.replaceState(null,'',`${location.pathname}${location.search}#call=${callId}`)}
          else await onOpen(result.request_call)
        }
      })
      const deviceDetails=element('details');deviceDetails.append(element('summary','Gerätedetails'),acceptance.firstElementChild);acceptance.prepend(deviceDetails)
      if (platform==='browser') content.append(button('In PeekaView öffnen',()=>{ location.href=`peekaview://rooms#${new URLSearchParams({api:client.session.api,invite:invitation})}` }))
      content.append(acceptance)
      return
    }
    if (!client.session.api) {
      content.append(element('h3','Eigener Server'))
      content.append(form([['Server-Adresse','url','']],'Verbinden',async api=>{
        client.session.api=apiURL(api); await client.request('config',undefined,false); client.save()
      }))
      return
    }
    if (!client.session.token) {
      if(!client.session.nextAction){
        content.append(element('p','Speichere Personen, die du direkt anrufen möchtest.','fr-muted'),button('Person einladen',()=>beginConnection('contact'),'fr-primary'),button('Neue Gruppe',()=>beginConnection('group')),button('Schon dabei? Anmelden',()=>beginConnection('login'),'fr-text-button'))
      }else if(emailSent){
        const next=client.session.nextAction==='contact'?'Danach gibst du die E-Mail-Adresse der Person ein, die du einladen möchtest.':client.session.nextAction==='group'?'Danach erstellst du deine Gruppe.':'Danach öffnen sich deine Kontakte.'
        content.append(element('h3','Prüfe deine E-Mails'),element('p',`Bestätigungslink an ${emailSent} gesendet.`),element('p',`Öffne den Link in deiner E-Mail. ${next}`,'fr-muted'),button('Andere E-Mail-Adresse',()=>{emailSent='';delete client.session.pendingEmail;client.save();rendered='';render()},'fr-text-button'))
      }else{
        if(client.session.nextAction!=='login')content.append(element('small',`${client.session.nextAction==='group'?'Gruppe erstellen':'Person einladen'} · Schritt 1 von 2`,'fr-muted'))
        const explanation=client.session.nextAction==='login'?'Bestätige deine E-Mail-Adresse, um deine Kontakte und Gruppen hier zu öffnen.':client.session.nextAction==='contact'?'Bestätige zuerst deine eigene E-Mail-Adresse. Danach lädst du die andere Person ein.':'Bestätige zuerst deine eigene E-Mail-Adresse. Danach erstellst du deine Gruppe.'
        content.append(element('h3',client.session.nextAction==='login'?'Kontakte öffnen':'Deine E-Mail bestätigen'),element('p',explanation,'fr-muted'))
        content.append(form([['Deine E-Mail-Adresse','email','']],'Bestätigungslink senden',async email=>{
          await client.request('device/request',{email,next_action:client.session.nextAction},false);emailSent=email;client.session.pendingEmail=email;client.save()
        }))
      }
      if(client.session.nextAction)content.append(button('Zurück',()=>{delete client.session.nextAction;delete client.session.pendingEmail;client.save();emailSent='';rendered='';render()}))
      if(platform==='browser' && !client.session.nextAction)content.append(element('p','Zum Bildschirmteilen PeekaView Desktop oder die Android-App öffnen.','fr-muted'))
      const connection=element('details',undefined,'fr-advanced');connection.append(element('summary','Erweitert'),button('Eigenen Server verwenden',()=>{client.session={};emailSent='';client.save()}));content.append(connection);return
    }
    const pending=client.state.calls.find(c=>c.id===callId && ['requested','rejected'].includes(c.status))
    if(pending){
      content.append(element('h3',pending.name),element('p',pending.status==='requested'?'Warte auf Zulassung …':'Du wurdest für dieses Gespräch nicht zugelassen.'),element('p',pending.status==='requested'?'Sobald du zugelassen wirst, öffnet sich das Gespräch. Dein Mikrofon bleibt zunächst aus.':'Du bleibst Mitglied der Gruppe.','fr-muted'),button('Zu den Kontakten',()=>{callId='';history.replaceState(null,'',location.pathname+location.search);render()}));return
    }
    const heading=element('div',undefined,'fr-heading')
    const identity=element('details');identity.append(element('summary',client.session.device.email),personDetails({name:'Dieses Gerät',email:client.session.device.email,devices:[client.session.device]}),element('p','Weiteres Gerät verbinden: Dort „Anmelden“ wählen und dieselbe E-Mail-Adresse bestätigen.','fr-muted'))
    const reload=button('',()=>refresh(),'fr-icon-button');reload.innerHTML=icon('refresh',16);reload.title='Neu laden';reload.setAttribute('aria-label','Neu laden')
    heading.append(identity,reload)
    content.append(heading)
    for(const call of client.state.calls.filter(c=>c.status==='joined')){
      content.append(button(`${call.name} · Gespräch öffnen`,()=>onOpen(call.id),'fr-resume'))
    }
    for (const call of client.state.calls.filter(c=>c.status==='ringing')) {
      const ring=element('section',undefined,'fr-ring')
      ring.append(element('strong',call.kind==='contact'?`${call.caller_name} ruft an`:`${call.caller_name} ruft die Gruppe „${call.name}“ an`),button('Annehmen',()=>join(call.id),'fr-primary'),button('Ablehnen',()=>client.request('calls/decline',{call:call.id})))
      content.append(ring)
    }
    for (const call of client.state.calls.filter(c=>['requested','rejected'].includes(c.status))) {
      content.append(element('p',call.status==='requested'?`„${call.name}“: Zulassung ausstehend.`:`„${call.name}“: Für dieses Gespräch nicht zugelassen.`,'fr-muted'))
    }
    const inviteContact=element('details',undefined,'fr-invite-contact');inviteContact.open=client.session.nextAction==='contact'
    inviteContact.append(element('summary','Person einladen'))
    if(client.session.nextAction==='contact')inviteContact.append(element('small','Schritt 2 von 2 · Wen möchtest du einladen?','fr-muted'))
    inviteContact.append(form([['E-Mail-Adresse der Person','email','']],'Einladung senden',async email=>{
      await client.request('contacts/invite',{email});delete client.session.nextAction;client.save();notice.textContent=`Einladung an ${email} gesendet.`
    }))
    content.append(inviteContact)
    content.append(collection('Kontakte',client.state.contacts || [],allContacts,()=>{allContacts=!allContacts},contactCard,'Noch keine Kontakte. Lade eine Person ein, um sie direkt anzurufen.'))
    for(const pending of client.state.invitations || [])content.append(element('p',`${pending.email} · Einladung offen`,'fr-muted'))
    if(client.state.rooms.length)content.append(collection('Gruppen',client.state.rooms,allGroups,()=>{allGroups=!allGroups},groupCard,''))
    const add=element('details',undefined,'fr-new-group');add.open=client.session.nextAction==='group';add.append(element('summary','Neue Gruppe'))
    if(client.session.nextAction==='group')add.append(element('small','Schritt 2 von 2 · Wie soll die Gruppe heißen?','fr-muted'))
    const createGroup=form([['Gruppenname','text','']],'Gruppe erstellen',async name=>{
      const people=[...createGroup.querySelectorAll('input[type=checkbox]:checked')].map(i=>i.value)
      const group=await client.request('rooms/create',{name,people});createGroup.reset();delete client.session.nextAction;client.save();openGroups.add(group.id);if(client.state.rooms.length>=5)allGroups=true;notice.textContent=`„${name}“ erstellt.`
    })
    if(client.state.contacts.length){
      const choices=element('div',undefined,'fr-members');choices.append(element('strong','Wer soll dabei sein?'))
      for(const person of client.state.contacts){const label=element('label',undefined,'fr-check');const check=document.createElement('input');check.type='checkbox';check.value=person.id;label.append(check,document.createTextNode(person.name));choices.append(label)}
      createGroup.insertBefore(choices,createGroup.lastElementChild)
    }
    add.append(createGroup);content.append(add)
    if(!client.state.contacts.length && !client.state.rooms.length)return
    if (platform==='browser') {
      content.append(element('p','Zum Bildschirmteilen benötigst du PeekaView Desktop oder die Android-App (kostenlos).','fr-muted'))
      if ('serviceWorker' in navigator && 'PushManager' in window && (!client.session.pushEnabled || Notification.permission!=='granted')) content.append(button('Auch bei geschlossener Seite erreichbar sein',enablePush))
    } else if (platform==='android') content.append(button('Anrufe im Hintergrund empfangen',()=> (window.PeekaViewHost||window.PeekaViewApp).enableRoomCalls()))
  }
  async function loadInvitation() {
    const api=apiURL(invitationApi || client.session.api)
    if (client.session.api && api!==client.session.api) throw new Error('Diese Einladung gehört zu einem anderen PeekaView-Server. Öffne sie in einem eigenen Browserprofil.')
    client.session.api=api
    preview=await client.request('invitation/preview',{invitation},false); client.save(); render()
  }
  async function join(id) {
    const call=client.state.calls.find(c=>c.id===id)
    const pin=call?.pin ? await pinDialog(call.name) : ''
    if (pin===null) return
    await client.request('calls/join',{call:id,pin}); await onOpen(id)
    if (platform!=='browser') await shareCall(id)
  }
  async function enablePush() {
    if (await Notification.requestPermission()!=='granted') throw new Error('Benachrichtigungen wurden nicht erlaubt. Du kannst weiter bei geöffneter Seite teilnehmen.')
    const config=await client.request('config',undefined,false)
    if (!config.vapidPublicKey) throw new Error('Der PeekaView-Server ist noch nicht für Benachrichtigungen eingerichtet.')
    const registration=await navigator.serviceWorker.register(new URL('room-sw.js',import.meta.url),{scope:new URL('.',import.meta.url).pathname})
    await navigator.serviceWorker.ready
    const key=Uint8Array.from(atob(config.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(config.vapidPublicKey.length/4)*4,'=')),c=>c.charCodeAt(0))
    const sub=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key})
    await client.request('push/save',{subscription:sub.toJSON()});client.session.pushEnabled=true;client.save();notice.textContent='Benachrichtigungen für Anrufe sind an.'
  }
  function renderCall() {
    if (!content.querySelector('.fr-call')) {
      content.replaceChildren()
      const call=element('section',undefined,'fr-call')
      const bar=element('header',undefined,'fr-call-bar')
      bar.append(element('strong',active.name),button('Mikrofon aus',async()=>{
        if (voice.on) voice.stop(); else await voice.start()
      },'fr-mic'),button('Auflegen',leave,'fr-leave'))
      if (platform!=='browser') bar.append(button('Bildschirm teilen',()=>shareCall(active.id)))
      call.append(bar,element('div',undefined,'fr-admissions'),element('div',undefined,'fr-call-invite'),element('p','','fr-call-people'),element('div',undefined,'fr-streams'))
      content.append(call)
      if (platform==='browser') content.append(element('p','Zum Bildschirmteilen benötigst du PeekaView Desktop oder die Android-App (kostenlos).','fr-muted'))
    }
    const admissions=content.querySelector('.fr-admissions')
    const requests=active.requests || []
    const requestsKey=JSON.stringify(requests)
    if(admissions.dataset.requests!==requestsKey){
      admissions.dataset.requests=requestsKey;admissions.replaceChildren()
      for(const person of requests){
        const row=element('section',undefined,'fr-ring')
        row.append(element('strong',person.person_name),element('span','Zu diesem Gespräch zulassen?'),
          button('Ablehnen',()=>client.request('calls/admit',{call:active.id,device:person.id,allow:false})),
          button('Zulassen',()=>client.request('calls/admit',{call:active.id,device:person.id,allow:true}),'fr-primary'))
        const device=element('details');device.append(element('summary',person.email),element('small',person.name));row.append(device)
        admissions.append(row)
      }
    }
    const room=client.state.rooms.find(r=>r.id===active.room)
    const invite=content.querySelector('.fr-call-invite')
    const membersKey=JSON.stringify(room)
    if(invite.dataset.members!==membersKey && ![...invite.querySelectorAll('input')].some(i=>i.value!==i.defaultValue)){
      invite.dataset.members=membersKey;invite.replaceChildren()
      if(room?.can_manage){
        const details=element('details');details.append(element('summary','Personen einladen'),element('small','Neue Personen werden zur Gruppe hinzugefügt.','fr-muted'),memberEditor(room));invite.append(details)
      }
    }
    content.querySelector('.fr-call-people').textContent=[...new Map(active.participants.map(p=>[p.person_id,p.person_name])).values()].join(' · ')
    const wanted=new Map(active.participants.filter(p=>p.id!==client.session.device.id && p.stream).map(p=>[p.id,p]))
    for (const [id,preview] of previews) if (!wanted.has(id) || preview.stream!==wanted.get(id).stream) { preview.viewer.destroy();preview.el.remove();previews.delete(id) }
    const streams=content.querySelector('.fr-streams')
    for (const p of wanted.values()) if (!previews.has(p.id)) {
      const panel=element('section',undefined,'fr-stream'); const label=element('h3',p.person_name);const stage=element('div',undefined,'fr-viewer')
      panel.append(label,stage);streams.append(panel)
      previews.set(p.id,{el:panel,stream:p.stream,viewer:mountViewer(stage,{room:p.stream,name:client.session.device.name,peerId:client.session.device.id,voice:false,peers:false})})
    }
    if (!wanted.size) {
      let wait=streams.querySelector('.fr-wait');if(!wait){wait=element('p','','fr-wait');streams.append(wait)}
      wait.textContent=active.participants.length<2?'Warte auf weitere Teilnehmende …':'Verbunden. Noch keine Bildschirmfreigabe.'
    } else streams.querySelector('.fr-wait')?.remove()
    renderMicrophone()
    if (voice) {
      voice.setSelf(Number(active.voice_id))
      voice.setPeers(active.participants.map(p=>({id:Number(p.voice_id),voice:!!Number(p.voice)})))
    }
  }
  function renderMicrophone(){
    const b=content.querySelector('.fr-mic');if(!b)return
    b.innerHTML=icon(voice?.on?'mic':'micOff',16)+(voice?.on?'Mikrofon an':'Mikrofon aus')
    b.disabled=!voice || voice.starting
    b.setAttribute('aria-label',voice?.on?'Mikrofon ausschalten':'Mikrofon einschalten')
    b.setAttribute('aria-pressed',String(!!voice?.on))
  }
  async function audio(call) {
    if (voiceSecret===call.secret) return
    stopAudio(); voiceSecret=call.secret
    signaling=await Signaling.open({secret:call.secret,onMessage:message=>{
      if (!voice || !active?.participants.some(p=>Number(p.voice_id)===message.from)) return
      if (message.t==='rtc') voice.handle(message)
      if (message.t==='voice') { const p=active.participants.find(p=>Number(p.voice_id)===message.from);if(p)p.voice=message.on?1:0;renderCall() }
    }})
    voice=new Voice({send:msg=>{
      if (stoppingAudio) return
      signaling.send({...msg,from:Number(call.voice_id)})
      if(msg.t==='voice') client.request('calls/voice',{call:call.id,on:msg.on}).catch(fail)
    },onChange:()=>{
      renderMicrophone()
      syncTranscriptAudio().catch(fail)
    }})
    voice.setEnabled(true); renderCall()
  }
  function stopAudio() { stoppingAudio=true;stopTranscriptAudio();voice?.setEnabled(false);voice=null;signaling?.close();signaling=null;voiceSecret=null;stoppingAudio=false }
  function stopTranscriptAudio() {
    for(const source of pcmSources.values()) source.disconnect()
    pcmSources.clear();pcmNode?.disconnect();pcmNode=null
    pcmContext?.close().catch(()=>{});pcmContext=null
  }
  async function syncTranscriptAudio() {
    if(platform!=='desktop' || pcmPending || stoppingAudio) return
    pcmPending=true
    try {
      const id=active?.id
      const enabled=id && voice && await window.__TAURI__.core.invoke('fixed_recording_enabled',{call:id})
      if(!enabled || disposed || active?.id!==id || !voice){stopTranscriptAudio();return}
      if(!pcmContext){
        const ctx=new AudioContext({sampleRate:16000});pcmContext=ctx
        await ctx.audioWorklet.addModule(new URL('room-pcm-worklet.js',import.meta.url))
        if(pcmContext!==ctx || disposed)return
        pcmNode=new AudioWorkletNode(ctx,'peekaview-room-pcm')
        pcmNode.port.onmessage=({data})=>window.__TAURI__.core.invoke('fixed_recording_audio',new Uint8Array(data),{headers:{'x-peekaview-call':id}}).catch(fail)
        pcmNode.connect(ctx.destination)
      }
      const streams=[voice.local,...voice.remoteStreams()].filter(s=>s?.getAudioTracks().length)
      for(const [stream,node]of pcmSources)if(!streams.includes(stream)){node.disconnect();pcmSources.delete(stream)}
      for(const stream of streams)if(!pcmSources.has(stream)){const source=pcmContext.createMediaStreamSource(stream);source.connect(pcmNode);pcmSources.set(stream,source)}
      if(streams.length && pcmContext.state==='suspended')await pcmContext.resume()
    }finally{pcmPending=false}
  }
  async function leave(ended = false) {
    const id=active?.id
    if (!id) return
    stopAudio()
    if (!ended) await client.request('calls/leave',{call:id})
    if(platform==='desktop') await window.__TAURI__.core.invoke('fixed_stop_share',{call:id})
    else (window.PeekaViewApp||window.PeekaViewHost)?.leaveRoom(id)
    callId=''; active=null
    for (const p of previews.values()) p.viewer.destroy()
    previews.clear(); rendered=''; content.replaceChildren(); history.replaceState(null,'',location.pathname+location.search)
  }
  async function refresh() {
    if (disposed || polling) return
    polling=true
    try {
      await client.refresh(callId)
      for (const c of client.state.calls.filter(c=>c.status==='ringing')) if(!seen.has(c.id)){ seen.add(c.id);onIncoming?.(c) }
      if(callId) {
        const c=client.state.calls.find(c=>c.id===callId)
        if(c?.status==='joined'){ active=c;await audio(c) }
        else if(active){await leave(true)}
      }
      render()
      await syncTranscriptAudio()
    } finally { polling=false }
  }
  const focus=()=>refresh().catch(fail)
  const changed=()=>{ client.session=JSON.parse(client.storage.getItem(KEY)||'{}');if(client.session.token)emailSent='';configureNative(client).catch(fail);rendered='';focus() }
  window.addEventListener('storage',changed)
  window.addEventListener('focus',focus)
  const unload=()=>{
    if(platform!=='browser' || !active)return
    stopAudio()
    const url=new URL(client.session.api);url.searchParams.set('action','calls/leave')
    fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${client.session.token}`},body:JSON.stringify({call:active.id}),keepalive:true,credentials:'omit',redirect:'error'}).catch(()=>{})
  }
  window.addEventListener('pagehide',unload)
  const recordingListener=platform==='desktop' ? window.__TAURI__.event.listen('fixed-recording',()=>syncTranscriptAudio().catch(fail)) : null
  render(); configureNative(client).catch(fail)
  if(invitation) loadInvitation().catch(fail)
  refresh().catch(fail)
  timer=setInterval(focus,4000)
  return { client, refresh, destroy(){ disposed=true;clearInterval(timer);window.removeEventListener('storage',changed);window.removeEventListener('focus',focus);window.removeEventListener('pagehide',unload);recordingListener?.then(unlisten=>unlisten());stopAudio();for(const p of previews.values())p.viewer.destroy() } }
}
