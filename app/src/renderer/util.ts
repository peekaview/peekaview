import { Platform, UserData } from '../interface'
import { StorageSchema, schema } from '../store'
import Swal from 'sweetalert2'

export type DialogOptions = {
  type?: 'success' | 'info' | 'error' | 'question'
  title?: string
  text?: string
  html?: string
  confirmButtonText: string
  sound?: string | null
}

export type NotifyOptions = DialogOptions & {
  showButtons?: boolean
}

export type PromptOptions = DialogOptions & {
  cancelButtonText: string
}

export const LOGOUT_URL = `/?login=&target=web&discardSession=true`

let increment = 0
const promiseHandlers: {
  [id: number]: [(value: string) => void, () => void]
} = {}

window.electronAPI?.onReplyDialog?.((dialogId, result) => {
  if (promiseHandlers[dialogId]) {
    promiseHandlers[dialogId][0](result)
    delete promiseHandlers[dialogId]
  }
})

export async function notify({ type, title, text, html, confirmButtonText }: NotifyOptions) {
  if (window.electronAPI) {
    const id = increment++

    const buttons: string[] = []
    if (confirmButtonText)
      buttons.push(confirmButtonText)

    const promise = new Promise<string>((resolve, reject) => promiseHandlers[id] = [resolve, reject])
    window.electronAPI.dialog({
      id,
      type,
      title,
      messages: [text ?? html],
      buttons,
    })

    return promise.then(() => {})
  }

  const result = Swal.fire({
    icon: type,
    title,
    text,
    html,
    showCancelButton: false,
    showConfirmButton: !!confirmButtonText,
    confirmButtonText,
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  });

  return result.then(() => {})
}

export async function prompt({ type, title, text, html, confirmButtonText, cancelButtonText, sound = null }: PromptOptions) {
  if (window.electronAPI) {
    const id = increment++

    const promise = new Promise<string>((resolve, reject) => promiseHandlers[id] = [resolve, reject])
    window.electronAPI.dialog({
      id,
      type,
      title,
      sound,
      messages: [text ?? html],
      buttons: [
        confirmButtonText, // result === '0'
        cancelButtonText, // result === '1'
      ],
    })

    return promise
  }
  
  const result = await Swal.fire({
    icon: type ?? 'question',
    title,
    text,
    html,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  })

  return result.isConfirmed ? '0' : '1'
}

export function isTouchEnabled() {
  return window.matchMedia("(pointer: coarse)").matches
}

export function getPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase()
  return userAgent.indexOf('mac') >= 0
    ? 'mac'
    : userAgent.indexOf('win') >= 0
      ? 'win'
      : userAgent.indexOf('linux') >= 0
        ? 'linux'
        : userAgent.indexOf('android') >= 0
          ? 'android'
          : userAgent.indexOf('ios') >= 0
            ? 'ios'
            : 'other'
}

export async function getStaticResourcesPath() {
  let prefix = ''
  if (window.electronAPI && process.env.NODE_ENV !== 'development') {
    prefix = await window.electronAPI.getResourcesPath()
  }
  return prefix ? `${prefix}/static` : ''
}

export function logout() {
  if (window.electronAPI)
    window.electronAPI!.logout(true)
  else
    window.location.href = LOGOUT_URL
}

export function getStoredItem<K extends keyof StorageSchema>(key: K, defaultValue?: StorageSchema[K]) {
  if (window.electronAPI)
    return window.electronAPI.getStoredItem(key, defaultValue)

  let value: StorageSchema[K] | undefined = defaultValue
  const item = localStorage.getItem(key)
  if (item)
    try {
      value = JSON.parse<StorageSchema[K]>(item)
    }
    catch (error) {
      console.warn('Store values are not JSON-formatted! Store will be cleared.')
      localStorage.clear()
    }
 
  return Promise.resolve(value)
}

export function setStoredItem<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]) {
  if (!schema[key])
    throw new Error(`Key ${key} is not defined in schema`)

  if (window.electronAPI) {
    window.electronAPI.setStoredItem(key, value)
    return
  }

  if (value === undefined) {
    removeStoredItem(key)
    return
  }

  localStorage.setItem(key, JSON.stringify(value))
}

export function removeStoredItem<K extends keyof StorageSchema>(key: K) {
  if (window.electronAPI) {
    window.electronAPI.removeStoredItem(key)
    return
  }

  localStorage.removeItem(key)
}

export async function incrementRecentContacts(users: UserData[]) {
  const recentContacts = (await getStoredItem('recentContacts') ?? {})
  for (const user of users) {
    const contact = recentContacts[user.id] ?? {}
    contact.id = user.id

    if (user.name)
      contact.name = user.name
    
    if (user.email)
      contact.email = user.email

    contact.lastActive = Date.now()

    recentContacts[user.id] = contact
  }
  setStoredItem('recentContacts', recentContacts)
}