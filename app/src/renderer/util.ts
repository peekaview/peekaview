import Swal from 'sweetalert2'

interface DialogOptions {
  type?: 'success' | 'info' | 'error' | 'question'
  title?: string
  text?: string
  html?: string
  confirmButtonText?: string
  cancelButtonText?: string
  sound?: string | null
}

interface NotifyOptions extends DialogOptions {
  showButtons?: boolean
}

let increment = 0
const promiseHandlers: {
  [id: number]: [(value: string) => void, () => void]
} = {}

window.electronAPI?.onReplyDialog((dialogId, result) => {
  if (promiseHandlers[dialogId]) {
    promiseHandlers[dialogId][0](result)
    delete promiseHandlers[dialogId]
  }
})

export async function notify({ type, title, text, html, confirmButtonText, cancelButtonText }: NotifyOptions) {
  if (window.electronAPI) {
    const id = increment++

    const buttons: string[] = []
    if (confirmButtonText)
      buttons.push(confirmButtonText)
    if (cancelButtonText)
      buttons.push(cancelButtonText)

    window.electronAPI.dialog({
      id,
      type,
      title,
      message: text ?? html,
      buttons,
    })
  } else {
    Swal.fire({
      icon: type,
      title,
      text,
      html,
      showCancelButton: !!cancelButtonText,
      showConfirmButton: !!confirmButtonText,
      confirmButtonText,
      cancelButtonText,
      customClass: {
        popup: 'animate__animated animate__fadeIn'
      }
    });
  }
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

export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (((hash >> (i * 8)) & 0xFF) % 120) + 60;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color.substring(1); // Remove # prefix to match existing format
}

export function uuidv4() {
  return `${1e7}-${1e3}-${4e3}-${8e3}-${1e11}`.replace(/[018]/g, c =>
    (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16)
  )
}

export function b64DecodeUnicode(str: string) {
  // Going backwards: from bytestream, to percent-encoding, to original string.
  return decodeURIComponent(atob(str).split('').map((c) => 
    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
  ).join(''))
}

export function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}