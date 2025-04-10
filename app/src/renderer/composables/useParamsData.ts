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
  
  const loginCode = ref<string | undefined>()
  const authCode = ref<string | undefined>()
  const email = ref<string | undefined>()
  const token = ref<string | undefined>()

  const target = ref<string | undefined>()
  const viewEmail = ref<string | undefined>()
  const accessToken = ref<string | undefined>()

  const inviteCode = window.location.pathname.replaceAll('/', '')
  if (inviteCode)
    getStoredItem('inviteCodeCache').then(async (cache) => {
      try {
        if (!cache)
          cache = {}
        
        if (!cache[inviteCode]) {
          const data = await callApi('useInviteCode', {
            code: inviteCode,
          })

          cache[inviteCode] = { viewEmail: data.email, accessToken: data.accessToken }
        } else if (typeof cache[inviteCode] === 'string') {
          cache[inviteCode] = { viewEmail: cache[inviteCode], accessToken: '' }
        }

        for (const code in cache) {
          if (code === inviteCode || cache[code].viewEmail !== cache[inviteCode].viewEmail)
            continue

          delete cache[code]
        }
        setStoredItem('inviteCodeCache', cache)

        action.value = Action.View
        viewEmail.value = cache[inviteCode].viewEmail
        accessToken.value = cache[inviteCode].accessToken
      } catch (error) {
        console.error('Error using invite code', error)
      }
    })
  
  if (!action.value)
    (async () => {
      const code = localStorage.getItem('code') ?? undefined
      authCode.value = code ? JSON.parse(code) : undefined
      const { email: e, token: t } = parseCode(authCode.value)
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

      if (loginCode.value) {
        try {
          const data = await callApi('login', {
            code: loginCode.value,
          })

          email.value = data.email
          token.value = data.token
          target.value = data.target
            
        } catch (e) {
          // TODO: Handle error
        }
      } else if (target.value === 'app' && email.value && token.value) {
        const data = await callApi('generateLoginCode', {
          email: email.value,
          token: token.value,
          target: target.value,
        })
        loginCode.value = data.code
      }
      
      if (email.value && token.value) {
        const code = btoa(`email=${email.value}&token=${token.value}`)
        setStoredItem('code', code)
      }

      watch(action, (action) => {
        if (action === Action.Share && (!email.value || !token.value))
          window.location.search = 'login'
      })
    })()

  function handleParams(params: URLSearchParams) {
    loginCode.value = params.get('login') ?? loginCode.value
    email.value = params.get('email')?.toLowerCase() ?? email.value
    token.value = params.get('token') ?? token.value
    target.value = params.get('target') ?? target.value
    viewEmail.value = params.get('viewEmail')?.toLowerCase() ?? viewEmail.value
  
    if (params.get('discardSession') === 'true') {
      email.value = undefined
      token.value = undefined
      localStorage.removeItem('code')
      localStorage.removeItem('name')
      localStorage.removeItem('recentContacts')
      localStorage.removeItem('inviteCodeCache')
    }
  }

  return {
    action: computed(() => action.value),
    loginCode: computed(() => loginCode.value),
    authCode: computed(() => authCode.value),
    email: computed(() => email.value),
    token: computed(() => token.value),
    target: computed(() => target.value),
    viewEmail: computed(() => viewEmail.value),
    accessToken: computed(() => accessToken.value),
  }
}
