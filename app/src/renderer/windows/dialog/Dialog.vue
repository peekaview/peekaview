<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import Modal from '../../components/Modal.vue'

import PingWave from '../../../assets/sounds/ping.wav'
import RingtoneWave from '../../../assets/sounds/ringtone.wav'

import { DialogOptions, DialogType } from '../../../interface'

import ContentCopySvg from '../../../assets/icons/content-copy.svg'
import CheckSvg from '../../../assets/icons/check.svg'

export type DialogButton = {
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
const message = ref<string>()
const copyText = ref<string>()
const type = ref<DialogType>()
const buttons = ref<DialogButton[]>([])
const defaultId = ref<number>()
const cancelId = ref<number>()
const windowType = ref<'tray' | 'dialog'>('dialog')

window.electronAPI!.onDialog((options: DialogOptions) => {
  id.value = options.id
  title.value = options.title
  message.value = options.message
  copyText.value = options.copyText
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

const copied = ref(false)
async function copy() {
  if (!copyText.value)
    return

  await navigator.clipboard.writeText(copyText.value)
  copied.value = true
  setTimeout(() => copied.value = false, 2000);
}
</script>

<template>
  <Modal ref="modal">
    <template v-if="windowType === 'dialog'" #header>
      <a href="#close" class="btn btn-clear float-right" aria-label="Close" @click="reply(cancelId!)"></a>
      <div class="modal-title h5">{{ title }}</div>
    </template>
    <template #default>
      <a v-if="windowType === 'tray'" href="#close" class="btn btn-clear float-right" aria-label="Close" @click="reply(cancelId!)"></a>
      <div class="content" :class="windowType === 'tray' ? 'tray' : ''">
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

        <div class="f-modal-alert">
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
        
        <p>
          <b v-if="message">{{ message }}</b>
          <br v-if="message && copyText">
          <div v-if="copyText" class="copy-text-wrapper">
            <div class="copy-text-container">
              <input
                v-model="copyText"
                type="text"
                readonly
              >
              <button
                class="btn btn-sm btn-secondary" 
                @click="copy"
              >
                <CheckSvg v-if="copied" />
                <ContentCopySvg v-else />
              </button>
            </div>
          </div>
        </p>

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

  .modal-body .content .f-modal-alert {
    margin-top: -40px;
  }

  .modal-body .content.tray .f-modal-alert {
    margin-top: 0px;
    margin-bottom: -40px;
    transform: scale(0.4);
    margin-right: 10px;
    margin-left: -10px;
  }

  .modal-body .copy-text-wrapper {
    margin: 10px 0;
    width: 80vw;
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
