import { computed, reactive, ref, watch } from 'vue'

export enum Action {
  Login = 'login',
  Share = 'share',
  View = 'view'
}

export function useParamsData() {
  const action = ref<Action>(Action.View)
  const token = ref<string | undefined>(localStorage.getItem('token') ?? undefined)
  const email = ref<string | undefined>(localStorage.getItem('email') ?? undefined)
  const name = ref<string | undefined>(localStorage.getItem('name') ?? undefined)
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
    name.value = params.get('name') ?? name.value
    target.value = params.get('target') ?? target.value
    viewEmail.value = params.get('viewEmail')?.toLowerCase() ?? viewEmail.value
  
    if (params.get('discardSession') === 'true') {
      email.value = undefined
      token.value = undefined
      localStorage.removeItem('email')
      localStorage.removeItem('token')
    }
    
    email.value && localStorage.setItem('email', email.value)
    token.value && localStorage.setItem('token', token.value)
    name.value && localStorage.setItem('name', name.value)
  }

  return reactive({
    action: computed(() => action.value),
    token: computed(() => token.value),
    email: computed(() => email.value),
    name: computed(() => name.value),
    target: computed(() => target.value),
    viewEmail: computed(() => viewEmail.value),
  })
}
