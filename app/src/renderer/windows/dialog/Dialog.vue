<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import Modal from '../../components/Modal.vue'

import PingWave from '../../../assets/sounds/ping.wav'
import RingtoneWave from '../../../assets/sounds/ringtone.wav'

import { DialogMessage, DialogOptions, DialogType } from '../../../interface'

import ContentCopySvg from '../../../assets/icons/content-copy.svg'
import CheckSvg from '../../../assets/icons/check.svg'

type DialogButton = {
  id: number
  label: string
}

const Sounds: Record<string, string> = {
  ping: PingWave,
  ringtone: RingtoneWave
}

const modalRef = useTemplateRef<InstanceType<typeof Modal>>('modal')

const id = ref<number>()
const title = ref<string>()
const messages = ref<DialogMessage[]>([])
const type = ref<DialogType>()
const buttons = ref<DialogButton[]>([])
const defaultId = ref<number>()
const cancelId = ref<number>()
const windowType = ref<'tray' | 'dialog'>('dialog')

window.electronAPI!.onDialog((options: DialogOptions) => {
  id.value = options.id
  title.value = options.title
  for (let message of options.messages ?? []) {
    if (typeof message === 'string') {
      messages.value.push({ content: message })
    } else {
      messages.value.push(message)
    }
  }
  type.value = options.type
  defaultId.value = options.defaultId
  cancelId.value = options.cancelId
  windowType.value = options.windowType ?? 'dialog'

  buttons.value = []
  let index = 0
  for (let button of options.buttons ?? []) {
    buttons.value.push({
      id: index === 0 && options.defaultId ? options.defaultId : index,
      label: button
    })
    index++
  }

  if (options.type == 'call') {
    var audio = new Audio(RingtoneWave);
    audio.play();

    audio.addEventListener('ended', function () {
      this.currentTime = 0;
      this.play();
    }, false);
  }
  if (options.sound) {
    var audio = new Audio(Sounds[options.sound]);
    audio.play();
  }

  if (options.timeout)
    setTimeout(() => close(), options.timeout)

  window.addEventListener("beforeunload", () => reply(options.cancelId!), false)
});

let replySent = false;
function reply(result: number) {
  if (replySent)
    return
  
  if (id.value !== undefined)
    window.electronAPI!.replyDialog(id.value, result.toString())
  replySent = true
  modalRef.value?.close()
}

const copied = ref<string>()
let copyTimeout: number | undefined
async function copy(text: string) {
  clearTimeout(copyTimeout)
  await navigator.clipboard.writeText(text)
  copied.value = text
  copyTimeout = window.setTimeout(() => copied.value = undefined, 2000);
}

async function select(e: MouseEvent) {
  if (e.target instanceof HTMLInputElement)
    e.target.select()
}
</script>

<template>
  <Modal ref="modal">
    <template v-if="windowType === 'dialog'" #header>
      <a href="#close" class="btn btn-clear float-right" aria-label="Close" @click="reply(cancelId!)"></a>
      <div class="modal-title h5">{{ title }}</div>
    </template>
    <template #default>
      <div v-if="type === 'call'" class="wrapper" style="margin-left: auto">
        <div class="ring">
          <div class="coccoc-alo-phone coccoc-alo-green coccoc-alo-show">
            <div class="coccoc-alo-ph-circle"></div>
            <div class="coccoc-alo-ph-circle-fill"></div>
            <div class="coccoc-alo-ph-img-circle"></div>
          </div>
        </div>
      </div>

      <div v-if="type === 'download'" class="lds-ring">
        <div></div>
        <div></div>
        <div></div>
        <div></div>
      </div>

      <div v-else class="f-modal-alert">
        <div v-if="type === 'error'" class="f-modal-icon f-modal-error animate">
          <span class="f-modal-x-mark">
            <span class="f-modal-line f-modal-left animateXLeft"></span>
            <span class="f-modal-line f-modal-right animateXRight"></span>
          </span>
          <div class="f-modal-placeholder"></div>
          <div class="f-modal-fix"></div>
        </div>
        <div v-else-if="type === 'warning'" class="f-modal-icon f-modal-warning scaleWarning">
          <span class="f-modal-body pulseWarningIns"></span>
          <span class="f-modal-dot pulseWarningIns"></span>
        </div>
        <div v-else-if="type === 'info'" class="f-modal-icon f-modal-info scaleWarning">
          <span class="f-modal-body pulseInfoIns"></span>
          <span class="f-modal-dot pulseInfoIns"></span>
        </div>
        <div v-else-if="type === 'success'" class="f-modal-icon f-modal-success animate">
          <span class="f-modal-line f-modal-tip animateSuccessTip"></span>
          <span class="f-modal-line f-modal-long animateSuccessLong"></span>
          <div class="f-modal-placeholder"></div>
          <div class="f-modal-fix"></div>
        </div>
      </div>
      <div class="content" :class="windowType === 'tray' ? 'tray' : ''">
        
        <template v-for="message in messages">
          <p>
            <b>{{ message.content }}</b>
            <br v-if="message.copyText">
          </p>
          <div v-if="message.copyText" class="copy-text-wrapper">
            <div class="copy-text-container">
              <input
                v-model="message.copyText"
                type="text"
                readonly
                @click="select"
              >
              <button
                class="btn btn-sm btn-secondary" 
                @click="copy(message.copyText)"
              >
                <CheckSvg v-if="copied === message.copyText" />
                <ContentCopySvg v-else />
              </button>
            </div>
          </div>
        </template>
        
        <div class="modal-buttons">
          <button
            v-for="(button, index) in buttons"
            :key="button.id"
            type="submit"
            :value="index === 0 ? defaultId : index + 1"
            :tabindex="index"
            class="btn mt-2"
            :class="[index === 0 ? 'btn-primary' : 'btn-secondary mr-2', windowType === 'tray' ? 'btn-sm' : '']"
            @click="reply(button.id)"
          >
            <span class="button-text">{{ button.label }}</span>
          </button>
        </div>
        
      </div>
      <a v-if="windowType === 'tray'" href="#close" class="btn btn-clear float-right" aria-label="Close" @click="reply(cancelId!)"></a>
    </template>
  </Modal>
</template>

<style>
  @font-face {
    font-family: 'Abel';
    font-style: normal;
    font-weight: 400;
    src: local('Abel Regular'), local('Abel-Regular'), url('../../../assets/fonts/abel-v10-latin-regular.woff2') format('woff2');
  }

  .modal-body {
    display: flex;
    min-width: 0;
  }

  .modal-body .content {
    flex: 1 1 auto;
    margin-top: 1rem;
  }

  .modal-body .content p {
    margin: 0;
  }

  .modal-body .copy-text-wrapper {
    margin: 10px 0;
    padding: 8px;
    background: transparent;
  }

  .modal-body .copy-text-container {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .modal-body .copy-text-container input {
    flex: 1;
    padding: 4px;
    background: #333;
    color: #fff;
    border: 1px solid #bcc3ce;
    border-radius: 2px;
    height: 28px;
    line-height: 20px;
  }

  .modal-body .copy-text-container button {
    margin: 0;
    padding: 5px;
    min-width: 32px;
    transition: all 0.2s ease;
  }

  .modal-body .copy-text-container button svg {
    fill: #ddd;
  }

  .modal-body .modal-buttons {
    display: flex;
    flex-direction: row-reverse;
    flex-wrap: nowrap;
    gap: 10px;
  }

  .modal-body .modal-buttons button {
    flex-grow: 1;
  }
</style>
