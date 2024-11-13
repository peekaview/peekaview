import 'bootstrap/dist/css/bootstrap.css'
import '@/assets/css/sources.css'

window.addEventListener('DOMContentLoaded', async () => {
  if (!window.electronAPI)
    return

  try {
    let sourceId: string
    const sources = await window.electronAPI.getScreenSources()
    const sourceList = document.getElementById('sourceList') as HTMLDivElement
    const submit = document.getElementById('select') as HTMLButtonElement

    sources.forEach(source => {
      const item = document.createElement('div')
      item.className = 'source-item'
      item.innerHTML = `<img src="${source.thumbnail}" alt="${source.name}" width="150"><p>${source.name}</p>`

      sourceList.appendChild(item)
      item.addEventListener('click', async (event) => {
        const sourceItems = document.querySelectorAll('.source-item')
        for (const item of sourceItems)
          item.classList.remove('selected')

        sourceId = source.id
        {(event.currentTarget as HTMLElement).classList.add('selected')}
        submit.disabled = false
      })
    })

    submit.onclick = () => sourceId && window.electronAPI!.selectScreenSourceId(sourceId)
  } catch (error) {
    console.error('Error getting screen sources:', error)
  }
})