// Footer links (Impressum, Datenschutz, Sicherheit) open in a dialog over the page instead of
// leaving it – a running sign-up or the link someone was about to open stays where it is. The
// pages themselves stay reachable on their own address.
import { icon } from './icons.js'

const cache = new Map()

async function content(href) {
  if (!cache.has(href)) {
    cache.set(href, fetch(href, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(r.status)
      return r.text()
    }).catch((e) => { cache.delete(href); throw e }))
  }
  const doc = new DOMParser().parseFromString(await cache.get(href), 'text/html')
  const main = doc.querySelector('main.pv-legal')
  main.querySelector('.back')?.remove()
  return { main: document.importNode(main, true), title: doc.querySelector('h1')?.textContent ?? '' }
}

function dialog() {
  let box = document.querySelector('.pv-legal-dialog')
  if (box) return box
  box = document.createElement('dialog')
  box.className = 'pv-legal-dialog'
  const bar = document.createElement('div')
  bar.className = 'pv-legal-bar'
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'pv-legal-close', title: 'Schließen', innerHTML: icon('close', 18) })
  close.setAttribute('aria-label', 'Schließen')
  close.addEventListener('click', () => box.close())
  bar.append(close)
  box.append(bar)
  // a click beside the text (on the dimmed page) closes it, too
  box.addEventListener('click', (e) => { if (e.target === box) box.close() })
  document.body.append(box)
  return box
}

export function mountLegalLinks(root = document) {
  for (const link of root.querySelectorAll('.pv-footer a')) {
    link.addEventListener('click', async (e) => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      let page
      try {
        page = await content(link.href)
      } catch {
        location.href = link.href
        return
      }
      const box = dialog()
      box.querySelector('main')?.remove()
      box.append(page.main)
      box.setAttribute('aria-label', page.title)
      if (!box.open) box.showModal()
      page.main.scrollTop = 0
      box.querySelector('.pv-legal-close').focus()
    })
  }
}

mountLegalLinks()
