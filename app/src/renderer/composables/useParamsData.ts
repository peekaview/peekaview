import { computed, ref, watch } from 'vue'
import { parseCode } from '../../util'
import { getStoredItem, setStoredItem } from '../util'
import { callApi } from '@renderer/api'

export enum Action {
  Login = 'login',
  Share = 'share',
  View = 'view'
}

export function useParamsData() {
  const action = ref<Action>()
  
  const email = ref<string | undefined>()
  const token = ref<string | undefined>()

  const target = ref<string | undefined>()
  const viewEmail = ref<string | undefined>()

  const inviteCode = window.location.pathname.replaceAll('/', '')
  if (inviteCode) {
    getStoredItem('viewCodeCache').then(async (cache) => {
      if (!cache)
        cache = {}
      else if (cache[inviteCode]) {
        action.value = Action.View
        viewEmail.value = cache[inviteCode]
        return
      }

      try {
        const data = await callApi<{ data: string }>({
          action: 'getTempData',
          code: inviteCode,
        })
        cache[inviteCode] = data.data
        setStoredItem('viewCodeCache', cache)

        action.value = Action.View
        viewEmail.value = data.data
      } catch (error) {
        console.error('Error using invite code', error)
      }
    })
  } else {
    const code = localStorage.getItem('code')
    const { email: e, token: t } = parseCode(code ? JSON.parse(code) : undefined)
    email.value = e
    token.value = t

    const params = new URLSearchParams(window.location.search)
    handleParams(params)

    for (const a of Object.values(Action)) {
      if (!params.has(a))
        continue

      action.value = a
      const value = params.get(a)
      if (value)
        handleParams(new URLSearchParams(atob(value)))

      break
    }

    watch(action, (action) => {
      if (action === Action.Share && (!email.value || !token.value))
        window.location.search = 'login'
    })
  }

  function handleParams(params: URLSearchParams) {
    token.value = params.get('token') ?? token.value
    email.value = params.get('email')?.toLowerCase() ?? email.value
    target.value = params.get('target') ?? target.value
    viewEmail.value = params.get('viewEmail')?.toLowerCase() ?? viewEmail.value
  
    if (params.get('discardSession') === 'true') {
      email.value = undefined
      token.value = undefined
      localStorage.removeItem('email')
      localStorage.removeItem('token')
    }
    
    if (email.value && token.value) {
      const code = btoa(`email=${email.value}&token=${token.value}`)
      setStoredItem('code', code)
    }
  }

  return {
    action: computed(() => action.value),
    token: computed(() => token.value),
    email: computed(() => email.value),
    target: computed(() => target.value),
    viewEmail: computed(() => viewEmail.value),
  }
}
