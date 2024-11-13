import 'bootstrap/dist/css/bootstrap.css'
import '@/assets/css/styles.css'

window.addEventListener('DOMContentLoaded', async () => {
  if (!window.electronAPI)
    return

  document.getElementById('login')?.addEventListener('click', () => {
    window.electronAPI!.loginViaBrowser()
    {(document.getElementById('login-via-browser') as HTMLDivElement).style.display = 'none'}
    {(document.getElementById('wait-for-login') as HTMLDivElement).style.display = 'block'}
  })

  document.getElementById('login-with-code')?.addEventListener('click', () => {
    const code = (document.getElementById('code-input') as HTMLInputElement).value
    window.electronAPI!.loginWithCode(code)
  })
})