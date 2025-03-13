import { computed, reactive, ref, watch } from 'vue'
import { parseCode } from '../../util'
import { setStoredItem } from '../util'

export enum Action {
  Login = 'login',
  Share = 'share',
  View = 'view'
}

export function useParamsData() {
  const action = ref<Action>()
  const code = localStorage.getItem('code')
  const { email: e, token: t } = parseCode(code ? JSON.parse(code) : undefined)

  const email = ref<string | undefined>(e)
  const token = ref<string | undefined>(t)
  
  const target = ref<string | undefined>()
  const viewEmail = ref<string | undefined>()

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

  return reactive({
    action: computed(() => action.value),
    token: computed(() => token.value),
    email: computed(() => email.value),
    target: computed(() => target.value),
    viewEmail: computed(() => viewEmail.value),
  })
}
