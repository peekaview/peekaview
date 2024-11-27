import Swal from 'sweetalert2'

interface DialogOptions {
  type?: 'success' | 'info' | 'error' | 'question'
  title?: string
  text?: string
  html?: string
  confirmButtonText?: string
  cancelButtonText?: string
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

export async function notify({ type, title, text, html, showButtons, confirmButtonText, cancelButtonText }: NotifyOptions) {
  if (window.electronAPI) {
    const id = increment++

    window.electronAPI.dialog({
      id,
      type,
      title,
      message: text ?? html,
      buttons: showButtons ? [
        confirmButtonText ?? 'OK',
      ] : [],
    })
  } else {
    Swal.fire({
      icon: type,
      title,
      text,
      html,
      showCancelButton: showButtons ?? true,
      showConfirmButton: showButtons ?? true,
      confirmButtonText,
      cancelButtonText,
      customClass: {
        popup: 'animate__animated animate__fadeIn'
      }
    });
  }
}

export async function prompt({ type, title, text, html, confirmButtonText, cancelButtonText }: DialogOptions) {
  if (window.electronAPI) {
    const id = increment++

    const promise = new Promise<string>((resolve, reject) => promiseHandlers[id] = [resolve, reject])
    window.electronAPI.dialog({
      id,
      type,
      title,
      message: text ?? html,
      buttons: [
        confirmButtonText ?? 'Yes', // result === '0'
        cancelButtonText ?? 'No', // result === '1'
      ],
    })

    return promise
  }
  
  return Swal.fire({
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
}