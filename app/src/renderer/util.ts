import { Platform } from 'src/interface'
import Swal from 'sweetalert2'

export type DialogOptions = {
  type?: 'success' | 'info' | 'error' | 'question'
  title?: string
  text?: string
  html?: string
  confirmButtonText?: string
  cancelButtonText?: string
  sound?: string | null
}

export type NotifyOptions = DialogOptions & {
  showButtons?: boolean
}

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
      message: text ?? html,
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

export async function prompt({ type, title, text, html, confirmButtonText, cancelButtonText, sound = null }: DialogOptions) {
  if (window.electronAPI) {
    const id = increment++

    const promise = new Promise<string>((resolve, reject) => promiseHandlers[id] = [resolve, reject])
    window.electronAPI.dialog({
      id,
      type,
      title,
      sound,
      message: text ?? html,
      buttons: [
        confirmButtonText ?? 'Yes', // result === '0'
        cancelButtonText ?? 'No', // result === '1'
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

export async function getUuid() {
  if (window.electronAPI)
    return window.electronAPI.getUuid()

  return localStorage.getItem('uuid')!
}