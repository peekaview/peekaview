import { icon, owl } from '../icons.js'
const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event
const $ = id => document.getElementById(id)
$('logo').innerHTML = owl(22)
$('refresh').innerHTML = icon('refresh', 17)
const fail = error => {
  $('archive').hidden = false
  $('error').hidden = false
  $('error').textContent = String(error)
}

async function load() {
  try {
    const entries = await invoke('transcripts_list')
    const selected=$('conversation').value
    const conversations=new Map()
    for(const {conversation} of entries)if(conversation && !conversations.has(conversation.id))conversations.set(conversation.id,conversation)
    $('conversation').replaceChildren(new Option('Alle Kontakte und Gruppen',''),...Array.from(conversations.values(),c=>new Option(`${c.kind==='contact'?'Kontakt':'Gruppe'} · ${c.name}`,c.id)))
    if(entries.some(e=>!e.conversation))$('conversation').append(new Option('Ältere Transkripte ohne Zuordnung','legacy'))
    if([...$('conversation').options].some(o=>o.value===selected))$('conversation').value=selected
    const filter=$('conversation').value
    const filtered=entries.filter(e=>!filter || (filter==='legacy'?!e.conversation:e.conversation?.id===filter))
    $('error').hidden = true
    $('empty').hidden = filtered.length > 0
    $('list').replaceChildren()
    let day
    let grid
    for (const entry of filtered) {
      if (entry.day !== day) {
        day = entry.day
        const heading = document.createElement('h3')
        heading.textContent = entry.date.split(' um ')[0]
        grid = Object.assign(document.createElement('div'), { className: 'transcript-grid' })
        $('list').append(heading, grid)
      }
      const card = document.createElement('button')
      card.className = 'transcript-card'
      card.setAttribute('aria-label', `${entry.conversation?.name || 'Ohne Zuordnung'} · ${entry.title} – ${entry.date}`)
      const preview = Object.assign(document.createElement('span'), { className: 'transcript-preview' })
      if (entry.thumbnail) {
        const image = Object.assign(document.createElement('img'), { src: entry.thumbnail, alt: '', loading: 'lazy' })
        preview.append(image)
      } else preview.innerHTML = icon('record', 28)
      const title = Object.assign(document.createElement('strong'), { textContent: !filter && entry.conversation?entry.conversation.name:entry.title })
      const date = Object.assign(document.createElement('span'), { className: 'muted', textContent: entry.date })
      const conversation=Object.assign(document.createElement('span'),{className:'muted',textContent:entry.conversation?(!filter?entry.title:entry.conversation.name):'Ohne Zuordnung'})
      card.append(preview, title, conversation, date)
      card.addEventListener('click', () => invoke('transcripts_window', { id: entry.id }).catch(fail))
      grid.append(card)
    }
  } catch (error) { fail(error) }
}

const id = new URLSearchParams(location.search).get('id')
if (id) {
  $('archive').hidden = true
  $('refresh').hidden = true
  $('title').textContent = document.title = 'Transkript'
  try {
    const html = await invoke('transcript_read', { id })
    // Saved reports get the settings window's colors and cannot run scripts or load remote resources.
    const head = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`
    const style = `<style>:root{--fg:#fafafa;--muted:#a1a1aa;--line:rgba(255,255,255,.08);color-scheme:dark}body{background:#09090b}article,dl{background:#18181b}.speech{background:#27272a}</style>`
    const report = new DOMParser().parseFromString(html, 'text/html')
    report.head.insertAdjacentHTML('afterbegin', head)
    report.head.insertAdjacentHTML('beforeend', style)
    $('report').srcdoc = '<!doctype html>' + report.documentElement.outerHTML
    $('report').hidden = false
  } catch (error) { fail(error) }
} else {
  $('conversation').addEventListener('change',load)
  $('refresh').addEventListener('click', async () => {
    $('refresh').classList.add('busy')
    $('refresh').disabled = true
    try { await load() } finally { $('refresh').classList.remove('busy'); $('refresh').disabled = false }
  })
  await listen('transcripts-changed', load)
  await load()
}
